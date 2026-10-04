using System.ComponentModel.Composition;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using NINA.Core.Model;
using NINA.Core.Utility;
using NINA.Sequencer.SequenceItem;
using NinaPm.Core.Execution;
using NinaPm.Core.Simulator;
using NinaPm.Core.Time;

namespace NinaPm.Nina.Sequencer;

// Muster nach dem Astro-PM-NINA-Plugin (MIT), Instructions/AstroPMWaitForTime.cs, Commit 5dd621d;
// Hinweis in THIRD_PARTY_NOTICES.md.

/// <summary>Auswahl der Quelle in der Ansicht.</summary>
public sealed record WaitSourceOption(WaitSource Value, string Label);

/// <summary>
/// <em>NINA-PM Warten auf Zeit</em> (FA-NIN-26, execution.md §1, AP-52): Uhrzeit oder Abenddämmerung
/// (bürgerlich/nautisch/astronomisch) mit Versatz und Tageswechsel-Zeit (Standard lokaler Mittag). Uhrzeiten gelten in
/// **Standortzeit** aus <c>bootstrap.timeZoneTransitions</c>, nie in der Windows-Zone des PCs (NT-06); Zeitumstellung
/// nach L2; Dämmerungen rechnet der Server (H1). Die Zielzeit wird bei jeder Ausführung für die nächste Nacht neu
/// bestimmt – nach einer beendeten Nacht (Tagesschleife) für die folgende. Im Start-Bereich **vor** <em>Entparken</em> (H3).
/// </summary>
[ExportMetadata("Name", "NINA-PM Wait for Time")]
[ExportMetadata("Description", "Waits for a site time or the evening twilight of the next NINA-PM night (site time zone, not the PC time zone).")]
[ExportMetadata("Icon", "ClockSVG")]
[ExportMetadata("Category", "NINA-PM")]
[Export(typeof(ISequenceItem))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class WaitForTimeInstruction : SequenceItem
{
    private readonly IClock clock = SystemClock.Instance;
    private WaitSource source = WaitSource.NauticalDusk;
    private int hours = 21;
    private int minutes;
    private int offsetMinutes;
    private int rolloverHours = 12;
    private int rolloverMinutes;
    private string statusText = "";

    [ImportingConstructor]
    public WaitForTimeInstruction()
    {
    }

    public IReadOnlyList<WaitSourceOption> Sources { get; } =
    [
        new(WaitSource.Time, Ui.Texts.WaitSourceTime),
        new(WaitSource.CivilDusk, Ui.Texts.WaitSourceCivil),
        new(WaitSource.NauticalDusk, Ui.Texts.WaitSourceNautical),
        new(WaitSource.AstronomicalDusk, Ui.Texts.WaitSourceAstronomical),
    ];

    [JsonProperty]
    [JsonConverter(typeof(StringEnumConverter))]
    public WaitSource Source
    {
        get => source;
        set
        {
            source = value;
            Changed(nameof(Source), nameof(IsTimeSource));
        }
    }

    public bool IsTimeSource => source == WaitSource.Time;

    [JsonProperty]
    public int Hours
    {
        get => hours;
        set
        {
            hours = Math.Clamp(value, 0, 23);
            Changed(nameof(Hours));
        }
    }

    [JsonProperty]
    public int Minutes
    {
        get => minutes;
        set
        {
            minutes = Math.Clamp(value, 0, 59);
            Changed(nameof(Minutes));
        }
    }

    [JsonProperty]
    public int OffsetMinutes
    {
        get => offsetMinutes;
        set
        {
            offsetMinutes = Math.Clamp(value, -720, 720);
            Changed(nameof(OffsetMinutes));
        }
    }

    /// <summary>Tageswechsel-Zeit (Standard 12:00 = lokaler Mittag wie die Nacht-Definition, FK 8.1).</summary>
    [JsonProperty]
    public int RolloverHours
    {
        get => rolloverHours;
        set
        {
            rolloverHours = Math.Clamp(value, 0, 23);
            Changed(nameof(RolloverHours), nameof(RolloverHint));
        }
    }

    [JsonProperty]
    public int RolloverMinutes
    {
        get => rolloverMinutes;
        set
        {
            rolloverMinutes = Math.Clamp(value, 0, 59);
            Changed(nameof(RolloverMinutes), nameof(RolloverHint));
        }
    }

    public WaitForTimeSpec Spec =>
        new(source, new TimeOnly(hours, minutes), offsetMinutes, new TimeOnly(rolloverHours, rolloverMinutes));

    /// <summary>Warnung, wenn der Tageswechsel vom lokalen Mittag abweicht (FA-NIN-26).</summary>
    public string RolloverHint => Spec.RolloverDiffersFromNoon ? Ui.Texts.WaitRolloverNotNoon : "";

    /// <summary>Zielzeit in Standortzeit für die Ansicht (aus dem geladenen Bootstrap), bzw. Restzeit beim Warten.</summary>
    public string StatusText
    {
        get => statusText;
        private set
        {
            statusText = value;
            RaisePropertyChanged();
        }
    }

    private void Changed(params string[] names)
    {
        foreach (var n in names) RaisePropertyChanged(n);
        UpdatePreview();
    }

    public override void AfterParentChanged() => UpdatePreview();

    private void UpdatePreview()
    {
        if (NinaPmRuntime.Current is not { } runtime || runtime.Runner.Bootstrap is not { } b) return;
        StatusText = Describe(DayCycle.Target(runtime.Runner, Spec, clock.UtcNow), SiteTime.From(b));
    }

    private static string Describe(WaitTarget? target, SiteTime site) => target switch
    {
        null => "",
        { UntilUtc: { } until } => Ui.Texts.WaitTargetText(site.DateClockZone(until), target.Night),
        _ => Ui.Texts.WaitNoTwilight(target.Night),
    };

    public override object Clone()
    {
        var clone = new WaitForTimeInstruction
        {
            Source = Source,
            Hours = Hours,
            Minutes = Minutes,
            OffsetMinutes = OffsetMinutes,
            RolloverHours = RolloverHours,
            RolloverMinutes = RolloverMinutes,
        };
        clone.CopyMetaData(this);
        return clone;
    }

    public override TimeSpan GetEstimatedDuration()
    {
        if (NinaPmRuntime.Current is not { } runtime) return TimeSpan.Zero;
        return DayCycle.Target(runtime.Runner, Spec, clock.UtcNow) is { } t ? WaitForTime.Remaining(t, clock.UtcNow) : TimeSpan.Zero;
    }

    public override async Task Execute(IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        var runtime = NinaPmRuntime.Current;
        if (runtime is null)
        {
            StatusText = Ui.Texts.NotConfigured;
            Logger.Warning("NINA-PM: Warten auf Zeit – Server-URL oder Sync-Token fehlen");
            return;
        }
        try
        {
            await DayCycle.WaitAsync(runtime.Runner, Spec, clock, runtime.Log,
                (until, t) => Task.Delay(until > clock.UtcNow ? until - clock.UtcNow : TimeSpan.Zero, t),
                (target, left) =>
                {
                    var site = runtime.Runner.Bootstrap is { } b ? SiteTime.From(b) : SiteTime.Utc;
                    StatusText = Describe(target, site);
                    progress?.Report(new ApplicationStatus { Source = "NINA-PM", Status = Ui.Texts.WaitingFor(left) });
                },
                token);
        }
        finally
        {
            progress?.Report(new ApplicationStatus { Source = "NINA-PM", Status = "" });
        }
    }

    public override string ToString() =>
        $"NINA-PM Wait for Time, Source: {Source}, Time: {Hours:00}:{Minutes:00}, Offset: {OffsetMinutes}, Rollover: {RolloverHours:00}:{RolloverMinutes:00}";
}
