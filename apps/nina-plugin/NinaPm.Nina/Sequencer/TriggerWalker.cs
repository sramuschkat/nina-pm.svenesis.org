using NINA.Core.Enum;
using NINA.Core.Model;
using NINA.Core.Utility;
using NINA.Sequencer.Container;
using NINA.Sequencer.SequenceItem;

namespace NinaPm.Nina.Sequencer;

/// <summary>
/// Trigger aller Vorfahren über die eigene Iteration (execution.md §4.3, M1, NIN5-3): <c>GetTriggersSnapshot</c> je
/// Vorfahren-Container statt <c>RunTriggers</c>, Kontext = der NINA-PM-Container. Dither-Trigger werden immer
/// unterdrückt – das Dithern steuert allein der Plan (NT-23); deaktivierte überspringt der Walk selbst (P-01). Wie im
/// Probe-Plugin (AP-S2b); Typfilter je Lage (Transit) und Prüfung des Trigger-Status folgen mit AP-16d.
/// </summary>
internal static class TriggerWalker
{
    public static async Task RunAsync(NinaPmContainer box, bool after, ISequenceItem? previous, ISequenceItem next,
        IProgress<ApplicationStatus> progress, NinaPmRuntime? runtime, CancellationToken token)
    {
        for (var c = box.Parent; c is not null; c = c.Parent)
        {
            if (c is not SequenceContainer container) continue;
            foreach (var trigger in container.GetTriggersSnapshot())
            {
                if (trigger.Status == SequenceEntityStatus.DISABLED) continue;
                var type = trigger.GetType().Name;
                if (type.Contains("dither", StringComparison.OrdinalIgnoreCase))
                {
                    if (box.SuppressedLogged.Add(type)) runtime?.Log.Event("TRIGGER_SUPPRESSED", ("type", type));
                    continue;
                }
                bool should;
                try
                {
                    should = after ? trigger.ShouldTriggerAfter(previous ?? box, box) : trigger.ShouldTrigger(previous ?? box, next);
                }
                catch (Exception ex)
                {
                    Logger.Warning($"NINA-PM: ShouldTrigger {type}: {ex.Message}");
                    continue;
                }
                if (!should) continue;
                runtime?.Log.Event("TRIGGER", ("type", type));
                try
                {
                    await trigger.Run(box, progress, token);
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    runtime?.Log.Warning("WARNING", ("code", "trigger_failed"), ("type", type));
                    Logger.Warning($"NINA-PM: Trigger {type}: {ex.Message}");
                }
            }
        }
    }
}
