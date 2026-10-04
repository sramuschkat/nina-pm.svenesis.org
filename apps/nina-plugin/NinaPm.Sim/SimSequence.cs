using System.Globalization;
using NinaPm.Core.Execution;
using NinaPm.Core.Planning;
using NinaPm.Core.Time;

namespace NinaPm.Sim;

/// <summary>
/// Die Beispielsequenz „Eine Nacht mit Safety“ (sample-sequences.md, execution.md §1/§4.6) nachgebaut: Start (Unpark) →
/// Zielcontainer mit <em>Loop While Safe</em> und <em>Nachtschleife</em>, darin <em>NINA-PM-Anweisungen</em> (ein
/// <c>RunOnceAsync</c> je Aufruf) → bei unsicher Sicherung (Park, <em>Warten bis sicher oder Nachtende</em>) und zurück
/// zum Ziel → Ende (Park). Wie NINAs Safety-Bedingung unterbricht „unsicher“ den Zielcontainer sofort.
/// Mit <see cref="SimDayLoop"/> „Mehrere Nächte“ (AP-52): je Runde <em>Warten auf Zeit</em> → Entparken → Nacht → Parken,
/// die <em>Tagesschleife</em> entscheidet an Anfang und Ende jeder Runde (wie <c>DayLoopCondition</c> im Adapter).
/// </summary>
public sealed class SimSequence(SimRuntime rt, SimWorld world, TextWriter logWriter, SimDayLoop? dayLoop = null)
{
    private CancellationTokenSource? target;

    /// <summary>Safety-Monitor meldet unsicher oder ist getrennt: laufenden Zielcontainer unterbrechen (Watchdog der Bedingung).</summary>
    public void Interrupt() => target?.Cancel();

    public async Task RunAsync(CancellationToken stop)
    {
        if (dayLoop is not null)
        {
            await DaysAsync(dayLoop, stop).ConfigureAwait(false);
            return;
        }
        FileLogSink.Sim(logWriter, rt.Clock, "sequence start; unpark");
        world.Parked = false;
        if (!await NightAsync(stop).ConfigureAwait(false)) return;
        world.Parked = true;
        FileLogSink.Sim(logWriter, rt.Clock, "sequence end; park");
    }

    private async Task DaysAsync(SimDayLoop d, CancellationToken stop)
    {
        var clock = rt.Clock;
        var settings = new DayLoopSettings(string.IsNullOrEmpty(d.EndNight) ? null : d.EndNight, d.MaxNights);
        var spec = new WaitForTimeSpec(Enum.Parse<WaitSource>(d.Source), TimeOnly.Parse(d.Time, CultureInfo.InvariantCulture), d.OffsetMin,
            TimeOnly.Parse(d.Rollover, CultureInfo.InvariantCulture));
        var state = new DayLoopState();
        FileLogSink.Sim(logWriter, clock, "sequence start (day loop)");
        while (DayCycle.Boundary(rt.Runner, state, settings, clock.UtcNow, starting: true, rt.Log) == DayLoopDecision.Continue)
        {
            FileLogSink.Sim(logWriter, clock, "day loop: wait for time");
            try
            {
                await DayCycle.WaitAsync(rt.Runner, spec, clock, rt.Log, (until, t) => clock.AdvanceToAsync(until, t), null, stop)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                FileLogSink.Sim(logWriter, clock, rt.Dead ? "sequence gone (crash)" : "sequence stopped by user");
                return;
            }
            FileLogSink.Sim(logWriter, clock, "day loop: unpark");
            world.Parked = false;
            if (!await NightAsync(stop).ConfigureAwait(false)) return;
            world.Parked = true;
            FileLogSink.Sim(logWriter, clock, "day loop: morning; park");
            if (DayCycle.Boundary(rt.Runner, state, settings, clock.UtcNow, starting: false, rt.Log) != DayLoopDecision.Continue) break;
        }
        world.Parked = true;
        FileLogSink.Sim(logWriter, clock, "sequence end; park");
    }

    /// <summary>Äußere Schleife mit Ziel- und Sicherungscontainer; <c>false</c>, wenn die Sequenz abbricht (Stopp, Absturz).</summary>
    private async Task<bool> NightAsync(CancellationToken stop)
    {
        var clock = rt.Clock;
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
                    return false;
                }
                finally
                {
                    target = null;
                }
            }
            if (rt.Dead || stop.IsCancellationRequested) return false;
            if (world.SafeNow) return true;

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
                return false;
            }
            if (r == SafetyWaitResult.CloseNight) return true;
            FileLogSink.Sim(logWriter, clock, "safe again: unpark, back to target");
            world.Parked = false;
        }
    }
}
