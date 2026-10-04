using System.Reflection;
using System.Runtime.InteropServices;
using NINA.Profile.Interfaces;
using NinaPm.Core.Api;
using NinaPm.Core.Execution;
using NinaPm.Core.Logging;
using NinaPm.Core.Options;
using NinaPm.Core.Planning;
using NinaPm.Core.Session;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;
using NinaPm.Nina.Adapters;

namespace NinaPm.Nina.Sequencer;

/// <summary>
/// Eine Laufzeit je NINA-Prozess für die Sequenz-Bausteine (execution.md §1): <c>ninapm.db</c>, API-Zugang aus den
/// Plugin-Optionen des aktiven Profils, <see cref="NightRunner"/> mit dem NINA-Adapter. Container, Bedingung
/// <em>Nachtschleife</em> und Anweisung <em>Warten bis sicher oder Nachtende</em> teilen sie. Neu aufgebaut, wenn sich
/// Server-URL oder Token ändern. Der Heartbeat läuft im Hintergrund, solange die Laufzeit besteht – unabhängig von der
/// Sequenz (execution.md §6, AP-16e); nach jedem Takt sendet die Outbox.
/// </summary>
internal sealed class NinaPmRuntime : IDisposable
{
    private static readonly object Gate = new();
    private static NinaPmRuntime? current;

    private readonly NinaApi api;
    private readonly CancellationTokenSource heartbeatStop = new();

    private NinaPmRuntime(PluginOptions options, Uri apiBase, string token, NinaHost host)
        : this(options, new NinaApi(apiBase, token, NinaPmPlugin.PluginVersion), LocalStore.Open(LocalStore.DefaultPath(), SystemClock.Instance),
            host, NinaLogSink.Instance, startHeartbeat: true)
    {
    }

    /// <summary>Laufzeit mit eigener API, eigenem Speicher und Log (Adapter-Tests: ohne Netz, ohne Heartbeat-Takt).</summary>
    internal NinaPmRuntime(PluginOptions options, NinaApi api, LocalStore store, NinaHost host, ILogSink sink, bool startHeartbeat)
    {
        Options = options;
        Host = host;
        var clock = SystemClock.Instance;
        Log = new NinaPmLog(sink);
        Store = store;
        this.api = api;
        var sessionApi = new NinaSessionApi(api.Client);
        Runner = new NightRunner(new NinaPlanApi(api.Client), sessionApi, Store, host, host, clock, Log)
        {
            Executor = new BlockExecutor(host, clock, Log) { Mode = PlaybackModeSequential },
            Flats = new NinaPm.Core.Flats.FlatExecutor(host, Store, clock, Log),
        };
        host.Runtime = this;
        Outbox = new OutboxSender(Store, sessionApi, Log, clock) { Listener = Runner };
        Runner.OfflineMode = options.OfflineMode;
        Heartbeat = new HeartbeatService(sessionApi, Runner, new NinaSettingsSource(host.Mediators, host.CurrentTriggers), Outbox,
            clock, Log, NinaPmPlugin.PluginVersion);
        if (startHeartbeat) _ = Task.Run(() => HeartbeatLoopAsync(heartbeatStop.Token));
    }

    public OutboxSender Outbox { get; }

    public HeartbeatService Heartbeat { get; }

    /// <summary>60-s-Takt; ein Fehler beendet den Takt nie (TickAsync wirft nicht, hier nur zur Sicherheit).</summary>
    private async Task HeartbeatLoopAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                await Heartbeat.TickAsync(token).ConfigureAwait(false);
                await Task.Delay(HeartbeatService.Interval, token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                NINA.Core.Utility.Logger.Warning($"NINA-PM: Heartbeat: {ex.Message}");
                try
                {
                    await Task.Delay(HeartbeatService.Interval, token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }

    // AP-16c: Playback sequenziell (Brief); zeitgeführt mit gemessenem Verzug folgt mit AP-16f.
    private const PlaybackMode PlaybackModeSequential = PlaybackMode.Sequential;

    public static NinaPmRuntime? Current
    {
        get
        {
            lock (Gate) return current;
        }
    }

    public PluginOptions Options { get; }

    public NinaHost Host { get; }

    public NinaPmLog Log { get; }

    public LocalStore Store { get; }

    public NightRunner Runner { get; }

    /// <summary>Testbetrieb nur mit allen drei Bedingungen (NIN-17): Schalter, lokale URL, Antwort mit <c>X-NPM-Test: 1</c>.</summary>
    public bool TestModeActive => Options.SafetyChecksOff(api.LastResponseWasTestServer);

    /// <summary>Laufzeit für die aktuellen Optionen holen oder neu aufbauen; <c>null</c>, wenn URL oder Token fehlen.</summary>
    public static NinaPmRuntime? Ensure(IProfileService profileService, Func<NinaHost> hostFactory)
    {
        var options = ReadOptions(profileService);
        lock (Gate)
        {
            if (current is not null && current.Options.ServerUrl == options.ServerUrl && current.Options.ProtectedToken == options.ProtectedToken
                && current.Options.TestMode == options.TestMode)
                return current;
            current?.Dispose();
            current = null;
            if (options.ApiBase is not { } apiBase || options.ProtectedToken.Length == 0) return null;
            var token = new DpapiTokenProtector().Unprotect(options.ProtectedToken);
            if (token is null) return null;
            current = new NinaPmRuntime(options, apiBase, token, hostFactory());
            return current;
        }
    }

    /// <summary>Server-URL und Token eingetragen (Bedingung <em>Nachtschleife</em> vor dem ersten Container-Aufruf).</summary>
    public static bool IsConfigured(IProfileService profileService)
    {
        var o = ReadOptions(profileService);
        return o.ApiBase is not null && o.ProtectedToken.Length > 0;
    }

    private static PluginOptions ReadOptions(IProfileService profileService)
    {
        var accessor = new NINA.Profile.PluginOptionsAccessor(profileService, PluginId);
        return new PluginOptions
        {
            ServerUrl = accessor.GetValueString(nameof(PluginOptions.ServerUrl), PluginOptions.DefaultServerUrl),
            ProtectedToken = accessor.GetValueString(nameof(PluginOptions.ProtectedToken), ""),
            TestMode = accessor.GetValueBoolean(nameof(PluginOptions.TestMode), false),
            OfflineMode = accessor.GetValueBoolean(nameof(PluginOptions.OfflineMode), false),
        };
    }

    /// <summary>Plugin-ID aus dem Manifest (Guid-Attribut der Assembly, ADR-S2b).</summary>
    public static Guid PluginId { get; } =
        Guid.Parse(typeof(NinaPmRuntime).Assembly.GetCustomAttribute<GuidAttribute>()!.Value);

    public void Dispose()
    {
        heartbeatStop.Cancel();
        api.Dispose();
        Store.Dispose();
        heartbeatStop.Dispose();
    }
}
