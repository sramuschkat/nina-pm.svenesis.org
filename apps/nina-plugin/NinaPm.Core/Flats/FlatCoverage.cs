using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Flats;

/// <summary>Auto-Flats je Projekt (AP-50b) aus dem Bootstrap: Modus und Intervall in Tagen.</summary>
public sealed record FlatAutoSettings(AutoMode Mode, int IntervalDays)
{
    public bool On => Mode != AutoMode.Off;
}

/// <summary>
/// Gelten die vorhandenen Flats eines Projekts noch für eine Kombination (AP-50b)? Dieselbe Regel wie
/// <c>packages/shared/src/flats-coverage.ts</c> (Web-Markierung): Filter, Gain, Offset, Binning, Auslesemodus genau,
/// mechanischer Winkel innerhalb <c>max(1°, Toleranz/2)</c>; <c>once_per_project</c> – vorhanden genügt,
/// <c>time_based</c> – die neuesten sind jünger als das Intervall (genau N Tage alt → neu aufnehmen).
/// </summary>
/// <remarks>Muster nach dem Astro-PM-Plugin (MIT), <c>Services/FlatsLedger.cs</c> (<c>FlatsAutoPolicy.IsCovered</c>), Commit edbb301.</remarks>
public static class FlatCoverage
{
    public static bool Covered(IEnumerable<FlatsOnRecord>? records, FlatCombination c, FlatAutoSettings auto, double rotationToleranceDeg,
        DateTimeOffset now, out DateTimeOffset? lastUtc)
    {
        lastUtc = null;
        if (!auto.On || records is null) return false;
        var tol = FlatClustering.ToleranceDg(rotationToleranceDeg);
        foreach (var r in records)
        {
            if (r.FilterShortName != c.FilterShort || r.Gain != c.Gain || r.Offset != c.Offset || r.Binning != c.Binning
                || r.ReadoutModeIndex != c.ReadoutIndex || FlatClustering.CircularDistanceDg(r.RotatorMechDg, c.MechDg) > tol)
                continue;
            if (lastUtc is null || r.LastUtc > lastUtc) lastUtc = r.LastUtc;
        }
        if (lastUtc is not { } last) return false;
        if (auto.Mode == AutoMode.Once_per_project) return true;
        return now - last < TimeSpan.FromDays(Math.Max(1, auto.IntervalDays));
    }
}
