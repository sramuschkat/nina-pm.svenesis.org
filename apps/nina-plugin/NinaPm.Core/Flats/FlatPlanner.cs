namespace NinaPm.Core.Flats;

/// <summary>Einstellungen für die Kombinationsbildung aus Rig und Bootstrap.</summary>
public sealed record FlatPlanOptions(double RotationToleranceDeg, bool FullSet, bool Sky, IReadOnlyList<RigFilter> Filters);

/// <summary>
/// Kombinationsbildung der Nacht (FA-NIN-17, execution.md §7, flip-rotation.md §4): die mechanischen Winkel aller
/// gespeicherten Lights werden gemeinsam geclustert (<see cref="FlatClustering"/>); je Filter, Kamera (Gain, Offset,
/// Binning, Auslesemodus) und Winkel-Cluster entsteht **eine** Kombination – unabhängig vom Ziel, mit Zielliste.
/// Bereits angelegte Kombinationen behalten ihren eingefrorenen Winkel (NIN5-8): ein Cluster, dessen Repräsentant
/// innerhalb der Toleranz liegt, wird ihnen zugeschlagen. Mit vollständigem Flat-Satz kommen je Winkel und Kamera alle
/// Filter des Rigs mit bestätigtem NINA-Namen hinzu. Ein Flip ändert den mechanischen Winkel nicht und erzeugt daher
/// keine zweite Kombination (NT-E4).
/// </summary>
/// <remarks>
/// Muster nach dem Astro-PM-Plugin (MIT), <c>Instructions/TargetInstructionSet.cs</c> (<c>RecordFlatSpec</c>,
/// <c>ExpandSpecsToFullWheel</c>, <c>DedupeSpecsAcrossTargets</c>), Commit 5dd621d – dort je Ziel und Himmels-PA, hier
/// ohne Ziel und nach mechanischem Winkel (Abweichung §10).
/// </remarks>
public static class FlatPlanner
{
    /// <summary>Aktualisiert <paramref name="combinations"/> um die Lights der Nacht und gibt die vollständige Liste zurück.</summary>
    public static List<FlatCombination> Update(IReadOnlyList<LightObservation> lights, IEnumerable<FlatCombination> combinations, FlatPlanOptions options)
    {
        var combos = combinations.ToList();
        var tol = FlatClustering.ToleranceDg(options.RotationToleranceDeg);
        var nextOrder = combos.Count == 0 ? 0 : combos.Max(c => c.Order) + 1;

        var clusters = FlatClustering.Cluster(lights.GroupBy(l => l.MechDg).Select(g => (g.Key, g.Sum(l => l.Count))), tol);
        int ClusterOf(int dg)
        {
            for (var i = 0; i < clusters.Count; i++)
                if (clusters[i].MembersDg.Contains(dg)) return i;
            return -1;
        }

        var groups = lights
            .GroupBy(l => (l.FilterShort, l.NinaFilter, l.Gain, l.Offset, l.Binning, l.ReadoutIndex, Cluster: ClusterOf(l.MechDg)))
            .OrderBy(g => g.Min(l => l.FirstSeq))
            .ToList();

        var fromLights = new List<FlatCombination>();
        foreach (var g in groups)
        {
            var rep = clusters[g.Key.Cluster].RepresentativeDg;
            var targets = Targets(g);
            var median = Median(g.Select(l => (l.MechDg, l.Count)), rep);
            var existing = combos.FirstOrDefault(c =>
                c.FilterShort == g.Key.FilterShort && c.NinaFilter == g.Key.NinaFilter && c.Gain == g.Key.Gain && c.Offset == g.Key.Offset
                && c.Binning == g.Key.Binning && c.ReadoutIndex == g.Key.ReadoutIndex
                && FlatClustering.CircularDistanceDg(c.MechDg, rep) <= tol);
            if (existing is not null)
            {
                existing.MedianDg = median;
                Merge(existing, targets);
                fromLights.Add(existing);
                continue;
            }
            var created = new FlatCombination
            {
                FilterShort = g.Key.FilterShort,
                NinaFilter = g.Key.NinaFilter,
                Gain = g.Key.Gain,
                Offset = g.Key.Offset,
                Binning = g.Key.Binning,
                ReadoutIndex = g.Key.ReadoutIndex,
                ReadoutName = g.Select(l => l.ReadoutName).FirstOrDefault(n => n is not null),
                MechDg = rep,
                MedianDg = median,
                Targets = targets,
                Order = nextOrder++,
            };
            combos.Add(created);
            fromLights.Add(created);
        }

        if (options.FullSet)
        {
            var sets = fromLights
                .GroupBy(c => (c.MechDg, c.Gain, c.Offset, c.Binning, c.ReadoutIndex))
                .OrderBy(g => g.Min(c => c.Order));
            foreach (var set in sets)
            {
                var template = set.OrderBy(c => c.Order).First();
                var targets = set.OrderBy(c => c.Order).SelectMany(c => c.Targets).DistinctBy(t => (t.ProjectId, t.PanelId)).ToList();
                foreach (var f in options.Filters.Where(f => f.NinaFilterName is not null).OrderBy(f => f.Position))
                {
                    // Schon belichtet (auch unter anderem Kurznamen, aber gleichem NINA-Filter) oder schon ergänzt.
                    var present = combos.FirstOrDefault(c => c.MechDg == set.Key.MechDg && c.Gain == set.Key.Gain && c.Offset == set.Key.Offset
                        && c.Binning == set.Key.Binning && c.ReadoutIndex == set.Key.ReadoutIndex
                        && (c.NinaFilter == f.NinaFilterName || c.FilterShort == f.ShortName));
                    if (present is not null)
                    {
                        if (present.FullSet) Merge(present, targets);
                        continue;
                    }
                    combos.Add(new FlatCombination
                    {
                        FilterShort = f.ShortName,
                        NinaFilter = f.NinaFilterName!,
                        Gain = template.Gain,
                        Offset = template.Offset,
                        Binning = template.Binning,
                        ReadoutIndex = template.ReadoutIndex,
                        ReadoutName = template.ReadoutName,
                        MechDg = template.MechDg,
                        MedianDg = template.MedianDg,
                        Targets = [.. targets],
                        FullSet = true,
                        Order = nextOrder++,
                    });
                }
            }
        }
        return combos.OrderBy(c => c.Order).ToList();
    }

    /// <summary>
    /// Reihenfolge der Ausführung: Panel – je Winkel zusammen (der Rotator fährt einmal je Winkel), Winkel und
    /// Kombinationen in der Reihenfolge der ersten Lights; Himmel (NT-40) – Schmalband → Breitband → L (zunehmende
    /// Himmelshelligkeit), innerhalb je Winkel.
    /// </summary>
    public static List<FlatCombination> ExecutionOrder(IEnumerable<FlatCombination> combinations, FlatPlanOptions options)
    {
        var list = combinations.ToList();
        var angleRank = list.GroupBy(c => c.MechDg)
            .OrderBy(g => g.Min(c => c.Order))
            .Select((g, i) => (g.Key, i))
            .ToDictionary(x => x.Key, x => x.i);
        return options.Sky
            ? list.OrderBy(c => BandRank(c.FilterShort, options.Filters)).ThenBy(c => angleRank[c.MechDg]).ThenBy(c => c.Order).ToList()
            : list.OrderBy(c => angleRank[c.MechDg]).ThenBy(c => c.Order).ToList();
    }

    /// <summary>0 = Schmalband, 1 = Breitband und sonstige, 2 = Luminanz (Filtertyp aus dem Bootstrap, sonst nach Kurzname).</summary>
    public static int BandRank(string filterShort, IReadOnlyList<RigFilter> filters)
    {
        var type = filters.FirstOrDefault(f => f.ShortName == filterShort)?.Type;
        return type switch
        {
            "narrowband" => 0,
            "luminance" => 2,
            null => GuessRank(filterShort),
            _ => 1,
        };
    }

    private static readonly string[] Narrowband = ["HA", "H-ALPHA", "HALPHA", "OIII", "O3", "SII", "S2", "HB", "HBETA", "NII", "N2"];
    private static readonly string[] Luminance = ["L", "LUM", "LUMINANCE", "CLEAR"];

    private static int GuessRank(string shortName)
    {
        var s = shortName.Trim().ToUpperInvariant();
        if (Narrowband.Contains(s)) return 0;
        if (Luminance.Contains(s)) return 2;
        return 1;
    }

    private static List<FlatTarget> Targets(IEnumerable<LightObservation> lights) =>
        lights.OrderBy(l => l.FirstSeq).Select(l => l.Target).DistinctBy(t => (t.ProjectId, t.PanelId)).ToList();

    private static void Merge(FlatCombination combination, IEnumerable<FlatTarget> targets)
    {
        foreach (var t in targets)
            if (!combination.Targets.Any(x => x.ProjectId == t.ProjectId && x.PanelId == t.PanelId))
                combination.Targets.Add(t);
    }

    /// <summary>Median der Winkel (mit Vielfachheit) relativ zum Repräsentanten entrollt, in Zehntelgrad.</summary>
    private static int Median(IEnumerable<(int Dg, int Count)> angles, int rep)
    {
        var values = new List<int>();
        foreach (var (dg, count) in angles)
        {
            var delta = ((dg - rep) % FlatClustering.FullCircleDg + FlatClustering.FullCircleDg) % FlatClustering.FullCircleDg;
            if (delta > FlatClustering.FullCircleDg / 2) delta -= FlatClustering.FullCircleDg;
            for (var i = 0; i < count; i++) values.Add(rep + delta);
        }
        values.Sort();
        var n = values.Count;
        var median = n % 2 == 1 ? values[n / 2] : (values[n / 2 - 1] + values[n / 2]) / 2.0;
        var m = (int)Math.Round(median, MidpointRounding.AwayFromZero);
        return ((m % FlatClustering.FullCircleDg) + FlatClustering.FullCircleDg) % FlatClustering.FullCircleDg;
    }
}
