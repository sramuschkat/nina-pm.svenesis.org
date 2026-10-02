using NinaPm.Core.Execution;

namespace NinaPm.Sim;

/// <summary>
/// Die Beispielsequenz „Eine Nacht mit Safety“ (sample-sequences.md, execution.md §1/§4.6) nachgebaut: Start (Unpark) →
/// Zielcontainer mit <em>Loop While Safe</em> und <em>Nachtschleife</em>, darin <em>NINA-PM-Anweisungen</em> (ein
/// <c>RunOnceAsync</c> je Aufruf) → bei unsicher Sicherung (Park, <em>Warten bis sicher oder Nachtende</em>) und zurück
/// zum Ziel → Ende (Park). Wie NINAs Safety-Bedingung unterbricht „unsicher“ den Zielcontainer sofort.
/// </summary>
public sealed class SimSequence(SimRuntime rt, SimWorld world, TextWriter logWriter)
{
    private CancellationTokenSource? target;

    /// <summary>Safety-Monitor meldet unsicher oder ist getrennt: laufenden Zielcontainer unterbrechen (Watchdog der Bedingung).</summary>
    public void Interrupt() => target?.Cancel();

    public async Task RunAsync(CancellationToken stop)
    {
        var clock = rt.Clock;
        FileLogSink.Sim(logWriter, clock, "sequence start; unpark");
        world.Parked = false;
        while (true)
        {
            using (target = CancellationTokenSource.CreateLinkedTokenSource(stop))
            {
                try
                {
                    // Bedingungen werden vor jedem Aufruf geprüft (SequentialStrategy).
                    while (world.SafeNow && rt.Runner.HasBlocksRemaining && !rt.Dead)
                        await rt.Runner.RunOnceAsync(target.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (!stop.IsCancellationRequested)
                {
                    // unterbrochen – unten in die Sicherung
                }
                catch (OperationCanceledException)
                {
                    FileLogSink.Sim(logWriter, clock, rt.Dead ? "sequence gone (crash)" : "sequence stopped by user");
                    return;
                }
                finally
                {
                    target = null;
                }
            }
            if (rt.Dead || stop.IsCancellationRequested) return;
            if (world.SafeNow) break;

            FileLogSink.Sim(logWriter, clock, "unsafe: park; wait until safe or night end");
            world.Parked = true;
            SafetyWaitResult r;
            try
            {
                r = await SafetyWait.RunAsync(rt.Runner, rt.Log, clock, () => (world.MonitorConnected, world.MonitorSafe),
                    (tick, t) => clock.AdvanceToAsync(clock.UtcNow + tick, t), stop).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                FileLogSink.Sim(logWriter, clock, rt.Dead ? "sequence gone (crash)" : "sequence stopped by user");
                return;
            }
            if (r == SafetyWaitResult.CloseNight) break;
            FileLogSink.Sim(logWriter, clock, "safe again: unpark, back to target");
            world.Parked = false;
        }
        world.Parked = true;
        FileLogSink.Sim(logWriter, clock, "sequence end; park");
    }
}
