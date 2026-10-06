using System.Globalization;
using System.Text;
using Newtonsoft.Json;
using NinaPm.Core.Time;
using NinaPm.Sim;

// Kopfloser Nachtlauf (tools/nina-sim): dotnet run --project apps/nina-plugin/NinaPm.Sim -- \
//   --server http://127.0.0.1:<port>/api --run tools/nina-sim/runs/P-17.json --out <ordner> --start <ISO-Zeit des Serverstarts>
//   [--keep-db]
// Schreibt <ordner>/nina.log (Logzeilen mit virtueller Zeit) und <ordner>/ninapm.db.

string Arg(string name) =>
    args.SkipWhile(a => a != $"--{name}").Skip(1).FirstOrDefault() ?? throw new ArgumentException($"--{name} missing");

var apiBase = new Uri(Arg("server"));
var run = JsonConvert.DeserializeObject<SimRun>(File.ReadAllText(Arg("run")),
    new JsonSerializerSettings { ObjectCreationHandling = ObjectCreationHandling.Replace }) ?? throw new InvalidOperationException("Lauf leer");
var outDir = Arg("out");
Directory.CreateDirectory(outDir);
var start = DateTimeOffset.Parse(Arg("start"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
var dbPath = Path.Combine(outDir, "ninapm.db");
// --keep-db: vorhandene ninapm.db weiterverwenden (Plugin-Update über die Datenbank einer älteren Version, real-upgrade).
if (!args.Contains("--keep-db") && File.Exists(dbPath)) File.Delete(dbPath);

using var logWriter = new StreamWriter(Path.Combine(outDir, "nina.log"), false, new UTF8Encoding(false)) { AutoFlush = true };
var clock = new VirtualClock(start);
var world = new SimWorld(run.Setup);
var end = start.AddMinutes(run.UntilMin);
using var control = new HttpClient { BaseAddress = new Uri(NinaPm.Core.Api.NinaApi.Origin(apiBase) + "/") };

SimRuntime? runtime = null;
SimSequence? sequence = null;
CancellationTokenSource? sequenceStop = null;
var pendingStart = run.Setup.AutoStart;
var retired = new List<SimRuntime>();

async Task ApplyAsync(SimStep step)
{
    if (step.Server is { } action)
    {
        FileLogSink.Sim(logWriter, clock, $"server action {action}{(step.Project is { } pr ? $" project={pr}" : "")}");
        using var req = new HttpRequestMessage(HttpMethod.Post, "test/actions")
        {
            Content = new StringContent(JsonConvert.SerializeObject(new { action, seconds = step.Seconds, project = step.Project },
                new JsonSerializerSettings { NullValueHandling = NullValueHandling.Ignore }), Encoding.UTF8, "application/json"),
        };
        req.Headers.Add(SimHttpHandler.ClockHeader, UtcText.Format(clock.UtcNow));
        using var res = await control.SendAsync(req).ConfigureAwait(false);
        res.EnsureSuccessStatusCode();
        return;
    }
    FileLogSink.Sim(logWriter, clock, $"{step.Sim}{(step.Value is { } v ? $" {v.ToString(CultureInfo.InvariantCulture)}" : "")}{(step.Names is { } n ? $" [{string.Join(", ", n)}]" : "")}");
    switch (step.Sim)
    {
        case "start":
            pendingStart = true;
            break;
        case "stop":
            sequenceStop?.Cancel();
            break;
        case "crash":
            if (runtime is not null)
            {
                runtime.Crash();
                retired.Add(runtime);
                runtime = null;
            }
            sequenceStop?.Cancel();
            break;
        case "unsafe":
            world.MonitorSafe = false;
            sequence?.Interrupt();
            break;
        case "safe":
            world.MonitorSafe = true;
            break;
        case "monitor_off":
            world.MonitorConnected = false;
            sequence?.Interrupt();
            break;
        case "monitor_on":
            world.MonitorConnected = true;
            break;
        case "setpoint":
            world.CameraSetpointC = step.Value ?? world.CameraSetpointC;
            break;
        case "filters":
            world.ProfileFilters = step.Names ?? [];
            break;
        case "readout_modes":
            world.ReadoutModes = step.Names ?? [];
            break;
        case "network_down":
            world.NetworkDown = true;
            break;
        case "network_up":
            world.NetworkDown = false;
            break;
        case "offline_on":
            world.OfflineMode = true;
            if (runtime is not null) runtime.Runner.OfflineMode = true;
            break;
        case "offline_off":
            world.OfflineMode = false;
            if (runtime is not null) runtime.Runner.OfflineMode = false;
            break;
        default:
            throw new InvalidOperationException($"Unbekannter Schritt {step.Sim}");
    }
}

foreach (var step in run.Steps)
{
    var s = step;
    clock.At(start.AddMinutes(s.AtMin), () => ApplyAsync(s));
}

// Laufende: alles verstummt (wie ein Absturz, ohne Session-Abschluss) – eine laufende Sequenz endet hier spätestens.
var finished = false;
clock.At(end, () =>
{
    finished = true;
    runtime?.Crash();
    sequenceStop?.Cancel();
    return Task.CompletedTask;
});

FileLogSink.Sim(logWriter, clock, $"run {run.Protocol} scenario={run.Scenario} until={UtcText.Format(end)}");
while (!finished && clock.UtcNow < end)
{
    if (pendingStart)
    {
        pendingStart = false;
        runtime ??= new SimRuntime(clock, world, apiBase, dbPath, logWriter);
        sequenceStop = new CancellationTokenSource();
        sequence = new SimSequence(runtime, world, logWriter, run.DayLoop);
        var seqTask = sequence.RunAsync(sequenceStop.Token);
        // Die Sequenz treibt die Uhr, bis sie endet (Nachtende, Benutzer-Stopp, Absturz).
        try
        {
            await seqTask.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            FileLogSink.Sim(logWriter, clock, $"sequence failed: {ex.GetType().Name}: {ex.Message}");
            throw;
        }
        sequence = null;
        sequenceStop.Dispose();
        sequenceStop = null;
        continue;
    }
    var next = clock.NextDue();
    var target = next is { } n && n < end ? n : end;
    if (target <= clock.UtcNow && next is null) break;
    await clock.AdvanceToAsync(target <= clock.UtcNow ? clock.UtcNow : target, CancellationToken.None, () => pendingStart || finished)
        .ConfigureAwait(false);
}
FileLogSink.Sim(logWriter, clock, "run end");
runtime?.Dispose();
foreach (var r in retired) r.Dispose();
