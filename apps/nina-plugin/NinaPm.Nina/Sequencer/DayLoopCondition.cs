using System.ComponentModel.Composition;
using System.Globalization;
using Newtonsoft.Json;
using NINA.Core.Enum;
using NINA.Core.Utility;
using NINA.Profile.Interfaces;
using NINA.Sequencer.Conditions;
using NINA.Sequencer.SequenceItem;
using NinaPm.Core.Execution;
using NinaPm.Core.Planning;
using NinaPm.Core.Time;

namespace NinaPm.Nina.Sequencer;

// Muster nach dem Astro-PM-NINA-Plugin (MIT), Instructions/AstroPMDailyLoopCondition.cs, Commit 5dd621d;
// Hinweis in THIRD_PARTY_NOTICES.md.

/// <summary>
/// <em>NINA-PM Tagesschleife</em> (FA-NIN-07, execution.md §1, AP-52): Bedingung am äußeren Container der Sequenz
/// „Mehrere Nächte“. Wahr, solange die Auslieferungsmenge für mindestens eine der nächsten 3 Nächte nicht leer ist,
/// höchstens bis zum Enddatum (letzter Nacht-Schlüssel einschließlich, Standortzeit) bzw. zur Höchstzahl Nächte.
/// Entscheidet **nur an der Rundengrenze**: NINA prüft die Bedingungen aller Vorfahren vor jeder Anweisung
/// (<c>SequentialStrategy.CanContinue</c>) – mitten in der Nacht bleibt sie wahr, sonst bräche die Nacht ab und das
/// Parken am Morgen entfiele. Beginnt eine Runde nach einer beendeten Nacht, fordert sie die nächste an.
/// Kein <c>IValidatable</c>: eine fehlgeschlagene Prüfung gälte in NINA als „falsch“ (<c>RunCheck</c>).
/// </summary>
[ExportMetadata("Name", "NINA-PM Day Loop")]
[ExportMetadata("Description", "Loops night after night while NINA-PM delivers targets for one of the next 3 nights, up to an end night or a number of nights.")]
[ExportMetadata("Icon", "NinaPmSVG")]
[ExportMetadata("Category", "NINA-PM")]
[Export(typeof(ISequenceCondition))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class DayLoopCondition : SequenceCondition
{
    private readonly IProfileService profile;
    private readonly IClock clock = SystemClock.Instance;
    private readonly DayLoopState state = new();
    private string endNight = "";
    private int maxNights = DayLoopSettings.DefaultMaxNights;
    private string statusText = "";

    [ImportingConstructor]
    public DayLoopCondition(IProfileService profile)
    {
        this.profile = profile;
    }

    /// <summary>Letzter Nacht-Schlüssel (<c>YYYY-MM-DD</c>, einschließlich); leer = ohne Enddatum.</summary>
    [JsonProperty]
    public string EndNight
    {
        get => endNight;
        set
        {
            endNight = (value ?? "").Trim();
            RaisePropertyChanged();
            RaisePropertyChanged(nameof(EndNightHint));
        }
    }

    /// <summary>Höchstzahl Nächte (Standard 14).</summary>
    [JsonProperty]
    public int MaxNights
    {
        get => maxNights;
        set
        {
            maxNights = Math.Max(1, value);
            RaisePropertyChanged();
        }
    }

    /// <summary>Hinweis bei einem unlesbaren Enddatum (es gilt dann nicht).</summary>
    public string EndNightHint => endNight.Length == 0 || ValidNight(endNight) ? "" : Ui.Texts.DayLoopEndNightInvalid;

    /// <summary>Stand für die Ansicht: begonnene Nächte, Grund des Endes.</summary>
    public string StatusText
    {
        get => statusText;
        private set
        {
            statusText = value;
            RaisePropertyChanged();
        }
    }

    private DayLoopSettings Settings => new(ValidNight(endNight) ? endNight : null, maxNights);

    private static bool ValidNight(string s) =>
        DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    public override object Clone()
    {
        var clone = new DayLoopCondition(profile) { EndNight = EndNight, MaxNights = MaxNights };
        clone.CopyMetaData(this);
        return clone;
    }

    /// <summary>Neue Ausführung des Containers (Sequenzstart): Nächte neu zählen.</summary>
    public override void SequenceBlockInitialize()
    {
        state.Reset();
        StatusText = "";
    }

    public override bool Check(ISequenceItem previousItem, ISequenceItem nextItem)
    {
        var runtime = NinaPmRuntime.Current;
        if (runtime is null) return NinaPmRuntime.IsConfigured(profile);
        var first = Parent?.Items.FirstOrDefault(i => i.Status != SequenceEntityStatus.DISABLED);
        var starting = nextItem is not null && ReferenceEquals(nextItem, first);
        // Mitten in der Runde (auch jede Anweisung in Unter-Containern): immer wahr.
        if (!starting && nextItem is not null) return true;
        try
        {
            var decision = DayCycle.Boundary(runtime.Runner, state, Settings, clock.UtcNow, starting, runtime.Log);
            // Laufende Nacht = beendete + 1 (VM-Lauf 04.10.2026: während Nacht 2 stand „Nacht 1“).
            StatusText = decision == DayLoopDecision.Continue
                ? Ui.Texts.DayLoopStatus(state.Nights.Count + 1, null)
                : Ui.Texts.DayLoopStatus(state.Nights.Count, decision.ToString().ToLowerInvariant());
            return decision == DayLoopDecision.Continue;
        }
        catch (Exception ex)
        {
            // Unerwarteter Fehler an der Rundengrenze: lieber eine weitere Runde (die Nacht prüft selbst) als ein Abbruch.
            Logger.Error($"NINA-PM: Day Loop – {ex.Message}");
            return true;
        }
    }

    public override string ToString() => $"NINA-PM Day Loop, EndNight: {EndNight}, MaxNights: {MaxNights}";
}
