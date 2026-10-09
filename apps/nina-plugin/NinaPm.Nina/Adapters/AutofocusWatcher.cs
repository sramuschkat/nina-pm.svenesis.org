using NINA.Core.Utility;
using NINA.Equipment.Equipment.MyFocuser;
using NINA.Equipment.Interfaces.Mediator;
using NINA.Equipment.Model;
using NinaPm.Core.Execution;

namespace NinaPm.Nina.Adapters;

/// <summary>
/// Autofokus-Läufe aus NINAs Fokussierer-Mediator (AP-65, execution.md §10.2): <c>AutoFocusRunStarting</c> zu Beginn,
/// <c>NewAutoFocusPoint</c> je Messpunkt, <c>UpdateEndAutoFocusRun</c> nur nach Erfolg – ein gescheiterter oder
/// abgebrochener Lauf meldet kein Ende, den schließt <see cref="AutofocusTracker.Settle"/>. NINA meldet jeden Lauf, egal wer
/// ihn startet (Trigger nach Zeit/HFR/Filterwechsel/Temperatur, Autofokus nach dem Flip, Anweisung in der Sequenz, Hand).
/// Registriert, solange die Laufzeit besteht. Eine Ausnahme hier darf NINAs Autofokus nie stören.
/// </summary>
internal sealed class AutofocusWatcher(AutofocusTracker tracker, Func<string?> currentFilter) : IFocuserConsumer
{
    public void AutoFocusRunStarting() => Safe(() => tracker.Starting(Filter()));

    public void NewAutoFocusPoint(OxyPlot.DataPoint dataPoint) => Safe(tracker.Point);

    public void UpdateEndAutoFocusRun(AutoFocusInfo info) =>
        Safe(() => tracker.Completed(info?.Filter ?? Filter(), info?.Position, info?.Temperature));

    public void UpdateUserFocused(FocuserInfo info)
    {
    }

    public void UpdateDeviceInfo(FocuserInfo deviceInfo)
    {
    }

    public void Dispose()
    {
    }

    private string? Filter()
    {
        try
        {
            return currentFilter();
        }
        catch (Exception ex)
        {
            Logger.Warning($"NINA-PM: autofocus filter: {ex.Message}");
            return null;
        }
    }

    private static void Safe(Action action)
    {
        try
        {
            action();
        }
        catch (Exception ex)
        {
            Logger.Warning($"NINA-PM: autofocus report: {ex.GetType().Name}: {ex.Message}");
        }
    }
}
