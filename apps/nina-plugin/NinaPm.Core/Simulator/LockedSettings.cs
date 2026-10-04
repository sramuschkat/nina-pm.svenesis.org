using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Simulator;

/// <summary>
/// Schritt 1 des Simulators (FA-NIN-18): Scheduler-Einstellungen des Rigs aus dem Bootstrap, **gesperrt** – „Gesteuert
/// von NINA-PM – Änderungen in der Web-App“. Werte als Codes aus <c>enums.json</c> (<c>strategies</c>,
/// <c>playbackModes</c>, <c>sortChainKeys</c>, <c>flatsSources</c>); Texte ergänzt die Oberfläche.
/// </summary>
public sealed record LockedSettings(
    int SettingsVersion,
    string Strategy,
    string Playback,
    bool BonusEnabled,
    double OvershootPct,
    bool MosaicPanelsIndependent,
    bool DitherEnabled,
    int DitherEvery,
    bool FilterSwitchEnabled,
    int FilterSwitchEvery,
    double FilterSwitchTolerancePct,
    bool FlatsEnabled,
    string FlatsSource,
    int FlatCount,
    bool FullFlatSet,
    bool DarkFlatsEnabled,
    int? DarkFlatCount,
    bool FlipEnabled,
    double FlipAfterMin,
    double FlipMaxAfterMin,
    double FlipPauseBeforeMin,
    double FlipDurationS,
    IReadOnlyList<string> SortChain)
{
    /// <summary>Gesperrt: im Plugin nie änderbar, auch nicht offline (Entscheidung Sven 01.10.2026).</summary>
    public bool Locked => true;

    public static LockedSettings? From(NinaBootstrap? bootstrap)
    {
        if (bootstrap?.Rig?.Scheduler is not { } s) return null;
        return new LockedSettings(
            bootstrap.Rig.SettingsVersion,
            Code(s.Strategy),
            Code(s.Playback),
            s.Bonus.Enabled,
            s.OvershootPct,
            s.MosaicPanelsIndependent,
            s.Dither.Enabled,
            s.Dither.Every,
            s.FilterSwitch.Enabled,
            s.FilterSwitch.Every,
            s.FilterSwitch.TolerancePct,
            s.Flats.Enabled,
            Code(s.Flats.Source),
            s.Flats.Count,
            s.Flats.FullSet,
            s.Flats.DarkFlats.Enabled,
            s.Flats.DarkFlats.Count,
            s.MeridianFlip.Enabled,
            s.MeridianFlip.AfterMin,
            s.MeridianFlip.MaxAfterMin,
            s.MeridianFlip.PauseBeforeMin,
            s.MeridianFlip.DurationS,
            s.SortChain.Select(Code).ToList());
    }

    /// <summary>Enum des Clients → Code aus <c>enums.json</c> (<c>Lowest_peak_altitude</c> → <c>lowest_peak_altitude</c>).</summary>
    public static string Code<T>(T value) where T : struct, Enum => value.ToString().ToLowerInvariant();
}
