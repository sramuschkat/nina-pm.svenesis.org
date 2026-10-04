namespace NinaPm.Core.Flats;

/// <summary>Ein Cluster mechanischer Rotatorwinkel: Repräsentant und die Winkel, die dazugehören (alle in Zehntelgrad).</summary>
public sealed record AngleCluster(int RepresentativeDg, IReadOnlySet<int> MembersDg);

/// <summary>
/// Clustern der mechanischen Rotatorwinkel einer Nacht (flip-rotation.md §4, NIN-2): **einfach verkettet** auf den
/// sortierten Winkeln – ein neuer Cluster, sobald der Abstand zum Vorgänger größer als <c>tol</c> ist; dazu die
/// Wrap-Prüfung über 0°/360°. Repräsentant = Median des Clusters (mit Vielfachheit), bei einem Wrap-Cluster auf der
/// entrollten Kette (+360° für die übernommenen Winkel) und danach <c>mod 360</c> (AST-G06). Alle Werte in Zehntelgrad
/// (<c>q(x, 10)</c>), damit Schlüssel und Vergleich ganzzahlig sind. Deterministisch und reihenfolgeunabhängig.
/// </summary>
public static class FlatClustering
{
    public const int FullCircleDg = 3600;

    /// <summary><c>tol = max(1°, rotation_tolerance_deg / 2)</c> in Zehntelgrad.</summary>
    public static int ToleranceDg(double rotationToleranceDeg) => Dg(Math.Max(1.0, rotationToleranceDeg / 2));

    /// <summary>Grad → Zehntelgrad, kaufmännisch gerundet (<c>roundHalfAwayFromZero(x · 10)</c>), in [0, 3600).</summary>
    public static int Dg(double deg)
    {
        var dg = (int)Math.Round(deg * 10, MidpointRounding.AwayFromZero);
        return ((dg % FullCircleDg) + FullCircleDg) % FullCircleDg;
    }

    /// <summary>Kreisabstand zweier Winkel in Zehntelgrad (0…1800).</summary>
    public static int CircularDistanceDg(int a, int b)
    {
        var d = Math.Abs(a - b) % FullCircleDg;
        return Math.Min(d, FullCircleDg - d);
    }

    /// <summary>
    /// Cluster aus Winkeln mit Anzahl (gleiche Winkel dürfen mehrfach vorkommen); Rückgabe aufsteigend nach dem kleinsten
    /// Winkel des Clusters (der Wrap-Cluster steht vorn).
    /// </summary>
    public static IReadOnlyList<AngleCluster> Cluster(IEnumerable<(int Dg, int Count)> angles, int toleranceDg)
    {
        var counts = new SortedDictionary<int, int>();
        foreach (var (dg, count) in angles)
        {
            if (count <= 0) continue;
            var k = ((dg % FullCircleDg) + FullCircleDg) % FullCircleDg;
            counts[k] = counts.GetValueOrDefault(k) + count;
        }
        if (counts.Count == 0) return [];
        var sorted = counts.Keys.ToList();

        var groups = new List<List<int>> { new() { sorted[0] } };
        for (var i = 1; i < sorted.Count; i++)
        {
            if (sorted[i] - sorted[i - 1] > toleranceDg) groups.Add([]);
            groups[^1].Add(sorted[i]);
        }

        // Wrap: erster und letzter Cluster hängen über 0° zusammen.
        var wrapped = false;
        if (groups.Count > 1 && sorted[0] + FullCircleDg - sorted[^1] <= toleranceDg)
        {
            var last = groups[^1];
            groups.RemoveAt(groups.Count - 1);
            groups[0] = [.. last, .. groups[0]];
            wrapped = true;
        }

        var result = new List<AngleCluster>(groups.Count);
        for (var g = 0; g < groups.Count; g++)
        {
            var members = groups[g];
            // Entrollte Kette: beim Wrap-Cluster stehen die übernommenen (großen) Winkel vorn, die kleinen bekommen +360°.
            var unrolled = new List<int>();
            var crossed = false;
            for (var i = 0; i < members.Count; i++)
            {
                if (g == 0 && wrapped && i > 0 && members[i] < members[i - 1]) crossed = true;
                var value = members[i] + (crossed ? FullCircleDg : 0);
                for (var c = 0; c < counts[members[i]]; c++) unrolled.Add(value);
            }
            unrolled.Sort();
            var n = unrolled.Count;
            var median = n % 2 == 1 ? unrolled[n / 2] : (unrolled[n / 2 - 1] + unrolled[n / 2]) / 2.0;
            var rep = (int)Math.Round(median, MidpointRounding.AwayFromZero) % FullCircleDg;
            result.Add(new AngleCluster(rep, new HashSet<int>(members)));
        }
        return result;
    }
}
