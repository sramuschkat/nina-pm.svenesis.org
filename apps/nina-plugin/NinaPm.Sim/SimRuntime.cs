using NinaPm.Core.Api;
using NinaPm.Core.Execution;
using NinaPm.Core.Logging;
using NinaPm.Core.Planning;
using NinaPm.Core.Session;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;

namespace NinaPm.Sim;

/// <summary>Logzeilen mit virtueller Zeit in eine Datei (Form wie NINAs Log: Zeit|Stufe|Text); nach einem Absturz still.</summary>
public sealed class FileLogSink(TextWriter writer, IClock clock, Func<bool> dead) : ILogSink
{
    public void Info(string line) => Write("INFO", line);
    public void Warning(string line) => Write("WARNING", line);
    public void Error(string line) => Write("ERROR", line);

    private void Write(string level, string line)
    {
        if (dead()) return;
        lock (writer) writer.WriteLine($"{UtcText.Format(clock.UtcNow)}|{level}|{line}");
    }

    /// <summary>Zeile des Simulators (Schritte, Sequenzablauf) – kein <c>NINA-PM |</c>-Präfix, die Prüfung liest sie nicht.</summary>
    public static void Sim(TextWriter writer, IClock clock, string text)
    {
        lock (writer) writer.WriteLine($"{UtcText.Format(clock.UtcNow)}|INFO|SIM | {text}");
    }
}

/// <summary>Jede Anfrage trägt die virtuelle Zeit (<c>x-npm-sim-now</c>); Netz aus → sofort Netzfehler.</summary>
public sealed class SimHttpHandler(IClock clock, SimWorld world, Func<bool> dead) : DelegatingHandler(new HttpClientHandler())
{
    public const string ClockHeader = "x-npm-sim-now";

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (dead() || world.NetworkDown) throw new HttpRequestException("Netz aus (Simulation)");
        request.Headers.Remove(ClockHeader);
        request.Headers.Add(ClockHeader, UtcText.Format(clock.UtcNow));
        return base.SendAsync(request, cancellationToken);
    }
}

/// <summary>
/// Ein simulierter NINA-Prozess mit Plugin – wie <c>NinaPmRuntime</c>: <c>ninapm.db</c>, API, Nachtlauf, Outbox und
/// Heartbeat im 60-s-Takt ab dem Laden. Ein Absturz (<see cref="Crash"/>) lässt ihn verstummen; ein Neustart baut einen
/// neuen Prozess auf derselben Datenbank.
/// </summary>
public sealed class SimRuntime : IDisposable
{
    private readonly NinaApi api;
    private readonly VirtualClock.Timer heartbeatTimer;

    public SimRuntime(VirtualClock clock, SimWorld world, Uri apiBase, string dbPath, TextWriter logWriter)
    {
        Clock = clock;
        Store = LocalStore.Open(dbPath, clock);
        Log = new NinaPmLog(new FileLogSink(logWriter, clock, () => Dead));
        api = new NinaApi(apiBase, "npm_test", "0.0.0-sim", new SimHttpHandler(clock, world, () => Dead), TimeSpan.FromSeconds(30));
        var sessionApi = new NinaSessionApi(api.Client);
        Host = new SimNina(clock, world, () => Runner, Log, () => Dead, logWriter);
        Runner = new NightRunner(new NinaPlanApi(api.Client), sessionApi, Store, Host, Host, clock, Log)
        {
            Executor = new BlockExecutor(Host, clock, Log) { Mode = PlaybackMode.Sequential },
        };
        Outbox = new OutboxSender(Store, sessionApi, Log) { Listener = Runner };
        // Profil-Standort = Rig-Standort des Test-Servers (Starfront, rig.json).
        Heartbeat = new HeartbeatService(sessionApi, Runner, new SimSettings(world, 31.5471, -99.3823), Outbox, clock, Log, "0.0.0-sim");
        heartbeatTimer = clock.At(clock.UtcNow, () => Dead ? Task.CompletedTask : Heartbeat.TickAsync(CancellationToken.None),
            HeartbeatService.Interval);
    }

    public VirtualClock Clock { get; }
    public LocalStore Store { get; }
    public NinaPmLog Log { get; }
    public SimNina Host { get; }
    public NightRunner Runner { get; }
    public OutboxSender Outbox { get; }
    public HeartbeatService Heartbeat { get; }
    public bool Dead { get; private set; }

    /// <summary>NINA hart beendet: keine Zeile, keine Anfrage, kein Heartbeat mehr.</summary>
    public void Crash()
    {
        Dead = true;
        heartbeatTimer.Cancelled = true;
    }

    public void Dispose()
    {
        heartbeatTimer.Cancelled = true;
        api.Dispose();
        Store.Dispose();
    }
}
