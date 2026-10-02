using NinaPm.Core.Logging;
using NinaPm.Core.Time;

namespace NinaPm.Core.Execution;

/// <summary>
/// Ablauf von <em>NINA-PM Warten bis sicher oder Nachtende</em> (execution.md §1, §4.6, H2) – im Kern, damit die
/// NINA-Anweisung und der kopflose Nachtlauf dasselbe tun: im 10-s-Takt warten, bis der Safety-Monitor verbunden und
/// sicher ist oder das Nachtende erreicht ist; am Nachtende die Nacht ohne Wiederaufnahme abschließen. Ein getrennter
/// Monitor zählt wie unsicher (<c>WARNING code=safety_monitor_not_connected</c> einmal je Wartephase).
/// </summary>
public static class SafetyWait
{
    public static readonly TimeSpan Tick = TimeSpan.FromSeconds(10);

    /// <param name="monitor">Safety-Monitor jetzt: verbunden, sicher.</param>
    /// <param name="delay">Ein Takt warten (NINA: <c>Task.Delay</c> mit Fortschrittsanzeige; Simulation: virtuelle Uhr).</param>
    public static async Task<SafetyWaitResult> RunAsync(NightRunner runner, NinaPmLog log, IClock clock,
        Func<(bool Connected, bool Safe)> monitor, Func<TimeSpan, CancellationToken, Task> delay, CancellationToken token)
    {
        var warned = false;
        while (true)
        {
            var (connected, safe) = monitor();
            if (!connected && !warned)
            {
                log.Warning("WARNING", ("code", "safety_monitor_not_connected"));
                warned = true;
            }
            var nightEnd = runner.NightEndUtc() ?? DateTimeOffset.MaxValue;
            switch (Interruption.SafetyWaitStep(clock.UtcNow, nightEnd, connected, safe))
            {
                case SafetyWaitResult.Safe:
                    return SafetyWaitResult.Safe;
                case SafetyWaitResult.CloseNight:
                    await runner.CloseNightUnsafeAsync(token).ConfigureAwait(false);
                    return SafetyWaitResult.CloseNight;
                default:
                    await delay(Tick, token).ConfigureAwait(false);
                    break;
            }
        }
    }
}
