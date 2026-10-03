using NinaPm.Core.Api.Generated;
using NinaPm.Core.Logging;
using NinaPm.Core.Reporting;
using NinaPm.Core.Time;

namespace NinaPm.Core.Execution;

/// <summary>
/// Geräteunabhängige Regeln des NINA-Adapters (execution.md §4.3/§4.4, NT-23, NT-37): Hinweise beim Planaufbau,
/// Filter- und Auslesemodus-Auswahl mit 12-h-Drosselung, Fakten und Meldung einer Aufnahme. <c>NinaPm.Nina</c> liest
/// dafür NINAs Profil und Geräte, der kopflose Nachtlauf (<c>NinaPm.Sim</c>) ein simuliertes NINA – beide verhalten
/// sich damit gleich und schreiben dieselben Logzeilen.
/// </summary>
public sealed class HostRules(IClock clock, Func<NinaPmLog?> log, Func<NightRunner?> runner)
{
    private readonly HintThrottle hints = new(HintThrottle.TwelveHours);

    /// <summary>
    /// Nach dem Planaufbau: Dither-Trigger in den Vorfahren → einmal je Nacht <c>warning nina_dither_trigger_present</c>;
    /// bestätigte NINA-Filternamen, die im Profil fehlen → <c>warning filter_wheel_changed</c> je Name höchstens 1×/12 h.
    /// </summary>
    public void PlanBuilt(NinaTargets? targets, IReadOnlyList<string> profileFilters, string? ditherTriggerType)
    {
        var now = clock.UtcNow;
        if (ditherTriggerType is not null && hints.ShouldEmit("nina_dither_trigger_present", now))
            log()?.Warning("WARNING", ("code", "nina_dither_trigger_present"), ("type", ditherTriggerType));
        foreach (var name in FilterResolver.MissingInProfile(targets, profileFilters))
            if (hints.ShouldEmit($"filter_wheel_changed:{name}", now))
                log()?.Warning("WARNING", ("code", "filter_wheel_changed"), ("filter", name));
    }

    /// <summary>Filter des Eintrags im Profil (§4.4); nicht gefunden → <c>FILTER_NOT_FOUND</c> höchstens 1×/12 h je Filter.</summary>
    public FilterResolution ChooseFilter(Entries entry, IReadOnlyList<string> profileFilters)
    {
        var r = runner();
        var nina = FilterResolver.NinaNameFor(entry, r?.Targets, r?.Bootstrap);
        var resolution = FilterResolver.Resolve(nina, profileFilters);
        if (resolution.Kind == FilterResolutionKind.NotFound && hints.ShouldEmit($"filter_not_found:{nina ?? entry.Filter}", clock.UtcNow))
            log()?.Event("FILTER_NOT_FOUND", ("filter", nina ?? ""), ("short", entry.Filter ?? ""));
        return resolution;
    }

    /// <summary>Auslesemodus per Name (§4.3, NT-37); nicht gefunden → <c>READOUT_MODE_NOT_FOUND</c> höchstens 1×/12 h je Modus.</summary>
    public ReadoutResolution ChooseReadout(Entries entry, IReadOnlyList<string>? cameraModes)
    {
        var resolution = ReadoutResolver.Resolve(entry.ReadoutMode, cameraModes);
        if (resolution.Kind == ReadoutResolutionKind.NotFound && hints.ShouldEmit($"readout_mode_not_found:{entry.ReadoutMode}", clock.UtcNow))
            log()?.Event("READOUT_MODE_NOT_FOUND", ("name", entry.ReadoutMode));
        return resolution;
    }

    /// <summary>
    /// Fakten einer Aufnahme vor der Belichtung (§4.3): Plan, nach dem belichtet wird, die an NINA übergebenen Werte,
    /// Pier-Seite nach fester ASCOM-Zuordnung (NT-34), mechanischer Rotatorwinkel (ohne Rotator 0). Zeiten vorläufig
    /// (jetzt), bis NINAs Metadaten vorliegen. Ohne laufenden Plan <c>null</c>.
    /// </summary>
    public CaptureFacts? Facts(Guid captureId, Blocks block, Entries entry, string? filterName, bool temperatureDeviation,
        double exposureS, IReadOnlyList<string>? cameraModes, double rotatorMechDeg, string? ascomPierSide)
    {
        if (runner()?.ExecutingPlan is not { } plan) return null;
        var now = clock.UtcNow;
        var readout = ReadoutResolver.Resolve(entry.ReadoutMode, cameraModes);
        return new CaptureFacts(captureId, plan.Night, plan.NightPlanId, block, entry, now, now.AddSeconds(exposureS / 2),
            filterName ?? entry.Filter ?? "", exposureS, entry.Gain, entry.Offset, entry.Binning ?? 1,
            entry.ReadoutMode, readout.Kind == ReadoutResolutionKind.Found ? readout.Index : null,
            rotatorMechDeg, CaptureMapper.PierSide(ascomPierSide), temperatureDeviation, null);
    }

    /// <summary><c>ImageSaved</c> zur Aufnahme: <c>CAPTURE result=saved</c>, Meldung mit Messwerten.</summary>
    public void Saved(CaptureFacts facts, Metrics metrics, string file)
    {
        log()?.Event("CAPTURE", ("id", facts.CaptureId), ("result", "saved"), ("file", file), ("atUtc", clock.UtcNow));
        runner()?.ReportCapture(facts with { Metrics = metrics }, CapturesResult.Saved, file);
    }

    /// <summary>Belichtung abgebrochen (Safety, Benutzer-Stopp): <c>CAPTURE result=aborted</c>.</summary>
    public void Aborted(Guid captureId, CaptureFacts? facts)
    {
        log()?.Event("CAPTURE", ("id", captureId), ("result", "aborted"), ("atUtc", clock.UtcNow));
        if (facts is not null) runner()?.ReportCapture(facts, CapturesResult.Aborted, null);
    }

    /// <summary>120 s ohne <c>ImageSaved</c>: <c>CAPTURE result=failed</c> und <c>warning image_not_saved</c>.</summary>
    public void Failed(CaptureFacts facts)
    {
        log()?.Event("CAPTURE", ("id", facts.CaptureId), ("result", "failed"), ("atUtc", clock.UtcNow));
        log()?.Warning("WARNING", ("code", "image_not_saved"), ("id", facts.CaptureId));
        runner()?.ReportCapture(facts, CapturesResult.Failed, null);
        runner()?.ReportEvent(EventsKind.Warning, "image_not_saved", facts.Block.Id);
    }
}
