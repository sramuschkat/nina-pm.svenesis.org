// AP-S2a (TK 10.4): Laufzeit, Speicher und Grenzen von planNight unter Jint.
// Eingaben und Node-Vergleich: `pnpm engine:bundle && pnpm engine:bench` → packages/engine/build/.
// Aufruf: dotnet run -c Release --project spikes/jint-runtime [-- --runs 5 --quick]
// --quick: nur Stufen bis zur Richtgröße (90 Einheiten), ohne die langsame Suche nach LimitMemory (CI).
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jint;
using Jint.Runtime;

var runs = 5;
var quick = false;
for (var i = 0; i < args.Length; i++)
{
    if (args[i] == "--runs") runs = int.Parse(args[++i]);
    if (args[i] == "--quick") quick = true;
}

var build = FindBuildDir();
var code = File.ReadAllText(Path.Combine(build, "engine.iife.js"));
var bench = JsonNode.Parse(File.ReadAllText(Path.Combine(build, "jint-bench.json")))!;
var cases = bench["cases"]!.AsArray().Select(c => c!).Where(c => !quick || (int)c["units"]! <= 90).ToList();
var report = new JsonObject
{
    ["engineVersion"] = (string?)bench["engineVersion"],
    ["machine"] = $"{RuntimeInformation.OSDescription}, {RuntimeInformation.ProcessArchitecture}, {Environment.ProcessorCount} Kerne, .NET {Environment.Version}",
    ["jint"] = typeof(Engine).Assembly.GetName().Version?.ToString(),
};
Console.WriteLine($"Maschine: {report["machine"]}; Jint {report["jint"]}; Engine {report["engineVersion"]}");

// 1. Bundle laden (erste Engine inkl. JIT von Jint, dann eine zweite).
var sw = Stopwatch.StartNew();
var engine = NewEngine();
var loadColdMs = sw.Elapsed.TotalMilliseconds;
sw.Restart();
_ = NewEngine();
var loadWarmMs = sw.Elapsed.TotalMilliseconds;
report["bundleKiB"] = code.Length / 1024;
report["loadColdMs"] = Math.Round(loadColdMs);
report["loadWarmMs"] = Math.Round(loadWarmMs);
Console.WriteLine($"Bundle {code.Length / 1024} KiB laden: erste Engine {loadColdMs:F0} ms, zweite {loadWarmMs:F0} ms");

// 2. planNight je Laststufe: erster Aufruf, Median warm, Hash gegen Node, Speicher.
Console.WriteLine();
Console.WriteLine("Stufe                  Einheiten   Node ms   Jint 1. ms   Jint warm ms   Faktor   Hash   Speicher MiB");
var rows = new JsonArray();
foreach (var c in cases)
{
    var name = (string)c["name"]!;
    var input = c["input"]!.ToJsonString();
    var e = NewEngine();
    e.SetValue("__input", input);
    GC.Collect();
    var before = GC.GetTotalMemory(true);
    var allocBefore = GC.GetAllocatedBytesForCurrentThread();
    sw.Restart();
    var hash = Plan(e);
    var firstMs = sw.Elapsed.TotalMilliseconds;
    var allocMiB = (GC.GetAllocatedBytesForCurrentThread() - allocBefore) / 1048576.0;
    var times = new List<double>();
    for (var r = 0; r < runs; r++)
    {
        sw.Restart();
        Plan(e);
        times.Add(sw.Elapsed.TotalMilliseconds);
    }
    var retainedMiB = (GC.GetTotalMemory(true) - before) / 1048576.0;
    times.Sort();
    var warm = times[times.Count / 2];
    var nodeMs = (double)c["nodeMs"]!;
    var ok = hash == (string?)c["outputHash"];
    Console.WriteLine($"{name,-22} {(int)c["units"]!,9} {nodeMs,9:F0} {firstMs,12:F0} {warm,14:F0} {warm / Math.Max(1, nodeMs),8:F0}×   {(ok ? "ok" : "ABW"),4}   {allocMiB,6:F0} alloc / {retainedMiB,4:F1} gehalten");
    rows.Add(new JsonObject
    {
        ["name"] = name, ["units"] = (int)c["units"]!, ["nodeMs"] = nodeMs, ["jintFirstMs"] = Math.Round(firstMs),
        ["jintWarmMs"] = Math.Round(warm), ["hashEqual"] = ok, ["allocMiB"] = Math.Round(allocMiB), ["retainedMiB"] = Math.Round(retainedMiB, 1),
    });
    if (!ok) Environment.ExitCode = 1;
}
report["cases"] = rows;

// 3. Grenzen an der Richtgröße (30 × 3 × 5) und der größten gemessenen Stufe.
Console.WriteLine();
var reference = cases.First(c => (string)c["name"]! == "richtwert")["input"]!.ToJsonString();
var largest = cases.Last()["input"]!.ToJsonString();
var minDepth = MinimalPasses(1, quick ? 256 : 4096, n => TryPlan(largest, o => o.LimitRecursion(n)));
Console.WriteLine($"Rekursion: kleinste LimitRecursion für „{cases.Last()["name"]}“ = {minDepth}");
// Jints LimitMemory zählt die im Aufruf allokierten Bytes (GC.GetAllocatedBytesForCurrentThread), nicht den
// belegten Speicher – deshalb an der Richtgröße gemessen und mit der Allokation oben verglichen.
var minMemMiB = quick ? -1 : MinimalPasses(1, 16384, mib => TryPlan(reference, o => o.LimitMemory(mib * 1048576L)));
Console.WriteLine($"Speicher: kleinstes LimitMemory für „richtwert“ ≈ {minMemMiB} MiB (zählt Allokation, nicht Belegung)");
report["minRecursion"] = minDepth;
report["minMemoryMiB"] = minMemMiB;

// Zeitlimit: TimeoutInterval greift (1 ms) und wirft TimeoutException.
sw.Restart();
var timeoutKind = Outcome(reference, o => o.TimeoutInterval(TimeSpan.FromMilliseconds(1)));
Console.WriteLine($"TimeoutInterval 1 ms: {timeoutKind} nach {sw.Elapsed.TotalMilliseconds:F0} ms");
report["timeoutOutcome"] = timeoutKind;

// Abbruch: CancellationToken nach 20 ms – Reaktionszeit bis zum Ende des Aufrufs.
using (var cts = new CancellationTokenSource())
{
    var e = NewEngine(o => o.CancellationToken(cts.Token));
    e.SetValue("__input", largest);
    cts.CancelAfter(20);
    sw.Restart();
    string kind;
    try { Plan(e); kind = "fertig ohne Abbruch"; }
    catch (ExecutionCanceledException) { kind = "ExecutionCanceledException"; }
    var reactMs = sw.Elapsed.TotalMilliseconds - 20;
    Console.WriteLine($"Abbruch per CancellationToken nach 20 ms: {kind}, Reaktion {Math.Max(0, reactMs):F0} ms");
    report["cancelOutcome"] = kind;
    report["cancelReactionMs"] = Math.Round(Math.Max(0, reactMs));
}

// Eigener Thread mit kleinem Stack (256 KiB) und der gemessenen Rekursionsgrenze × 2: läuft durch?
var threadResult = "";
var t = new Thread(() => threadResult = TryPlan(largest, o => o.LimitRecursion(minDepth * 2)) ? "ok" : "Fehler", 256 * 1024);
t.Start();
t.Join();
Console.WriteLine($"Eigener Thread, Stack 256 KiB, LimitRecursion {minDepth * 2}: {threadResult}");
report["thread256KiB"] = threadResult;

GC.Collect();
report["workingSetMiB"] = Math.Round(Environment.WorkingSet / 1048576.0);
report["gcHeapMiB"] = Math.Round(GC.GetGCMemoryInfo().HeapSizeBytes / 1048576.0);
Console.WriteLine($"Prozess am Ende: Arbeitsspeicher {report["workingSetMiB"]} MiB, GC-Heap {report["gcHeapMiB"]} MiB");
File.WriteAllText(Path.Combine(build, "jint-bench-result.json"), report.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"✓ {Path.Combine(build, "jint-bench-result.json")}");
return;

Engine NewEngine(Action<Options>? configure = null)
{
    var e = new Engine(o => { o.Strict(); configure?.Invoke(o); });
    e.Execute(code);
    return e;
}

static string Plan(Engine e) =>
    e.Evaluate("NinaPmEngine.planNight(JSON.parse(__input)).outputHash").AsString();

bool TryPlan(string input, Action<Options> configure) => Outcome(input, configure) == "ok";

string Outcome(string input, Action<Options> configure)
{
    try
    {
        var e = NewEngine(configure);
        e.SetValue("__input", input);
        Plan(e);
        return "ok";
    }
    catch (Exception ex) when (ex is RecursionDepthOverflowException or MemoryLimitExceededException or TimeoutException
                               or ExecutionCanceledException or JavaScriptException or StatementsCountOverflowException)
    {
        return ex.GetType().Name;
    }
}

// Kleinster Wert in [lo, hi], für den ok(x) gilt (ok monoton angenommen); hi, falls nie.
static int MinimalPasses(int lo, int hi, Func<int, bool> ok)
{
    if (!ok(hi)) return -1;
    while (lo < hi)
    {
        var mid = lo + (hi - lo) / 2;
        if (ok(mid)) hi = mid; else lo = mid + 1;
    }
    return lo;
}

static string FindBuildDir()
{
    for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        if (File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml")))
            return Path.Combine(dir.FullName, "packages", "engine", "build");
    throw new DirectoryNotFoundException("Repository-Wurzel nicht gefunden");
}
