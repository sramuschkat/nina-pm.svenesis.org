using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Targets;

/// <summary>Anzeigename eines Blocks: Projekt bzw. „Projekt – Panel-Label“ bei Mosaiken (§4.1 Nr. 4).</summary>
public static class TargetTitle
{
    public static string For(Blocks block, NinaTargets? targets)
    {
        var project = targets?.Projects.FirstOrDefault(p => p.Id == block.ProjectId);
        if (project is null) return "NINA-PM";
        var panel = project.Panels.FirstOrDefault(p => p.Id == block.PanelId);
        return project.Panels.Count > 1 && panel is not null ? $"{project.Name} – {panel.Label}" : project.Name;
    }

    /// <summary>Name für NINA, Ordner, Dateien und FITS-Kopf: <see cref="For"/> als lesbares ASCII (<see cref="AsciiName"/>, AP-71).</summary>
    public static string FileName(Blocks block, NinaTargets? targets) => AsciiName.Of(For(block, targets));
}

/// <summary>Zeile des Zielbrowsers „An NINA ausgeliefert“ (FA-NIN-02).</summary>
public sealed record TargetRow(
    Guid ProjectId,
    string Name,
    string Type,
    double RaDeg,
    double DecDeg,
    double RotationDeg,
    int Panels,
    double? FocalLengthMm,
    int? SensorWidthPx,
    int? SensorHeightPx,
    double? PixelSizeUm,
    int Priority,
    double ProgressPct,
    DateTimeOffset? NextTransitUtc);

/// <summary>
/// Was der Framing-Assistent erhält (FA-NIN-02): Zentrum, <c>pa₀</c>, Raster, Sensor, Brennweite und das Bildfeld des
/// Himmelsbilds (<see cref="TargetBrowser.FieldOfViewDeg"/>).
/// </summary>
public sealed record FramingRequest(
    string Name,
    double RaDeg,
    double DecDeg,
    double PositionAngleDeg,
    int Columns,
    int Rows,
    double OverlapPct,
    int? CameraWidthPx,
    int? CameraHeightPx,
    double? PixelSizeUm,
    double? FocalLengthMm,
    double FieldOfViewDeg);

/// <summary>
/// Zielbrowser (FA-NIN-02, AP-16h): Zeilen aus <c>GET /targets</c> und dem Rig des Bootstraps, Filter nach Typ und
/// Fortschritt, und die Übergabe an NINAs Framing-Assistenten. Zentrum und <c>pa₀</c> kommen aus <c>project.center</c>
/// (Server ab AP-16h); ältere Server liefern ihn nicht – dann das einzige Panel bzw. der normierte Mittelwert der
/// Panel-Richtungen (beim vollständigen Raster exakt das Zentrum, geometry.md §2.1: Paare (ξ, η) ↔ (−ξ, −η)).
/// </summary>
public static class TargetBrowser
{
    public static IReadOnlyList<TargetRow> Rows(NinaTargets? targets, NinaBootstrap? bootstrap, string? type = null, bool openOnly = false)
    {
        if (targets is null) return [];
        var camera = bootstrap?.Rig.Camera;
        var telescope = bootstrap?.Rig.Telescope;
        return targets.Projects
            .Select(p =>
            {
                var (ra, dec, rot) = Center(p);
                var lines = p.Panels.SelectMany(x => x.Lines).ToList();
                var planned = lines.Sum(l => l.Counts?.Planned ?? 0);
                var accepted = lines.Sum(l => Math.Min(l.Counts?.Accepted ?? 0, l.Counts?.Planned ?? 0));
                return new TargetRow(p.Id, p.Name, p.Type.ToString().ToLowerInvariant(), ra, dec, rot, p.Panels.Count,
                    telescope is null ? null : telescope.FocalLengthMm * (telescope.ReducerFactor > 0 ? telescope.ReducerFactor : 1),
                    camera?.WidthPx, camera?.HeightPx, camera?.PixelSizeUm, p.Priority,
                    planned == 0 ? 0 : Math.Round(100.0 * accepted / planned, 1),
                    p.Exoplanet?.Observation?.WindowStartUtc);
            })
            .Where(r => type is null || r.Type == type)
            .Where(r => !openOnly || r.ProgressPct < 100)
            .OrderBy(r => r.Priority).ThenBy(r => r.Name, StringComparer.CurrentCulture)
            .ToList();
    }

    public static FramingRequest? Framing(NinaTargets? targets, NinaBootstrap? bootstrap, Guid projectId)
    {
        var p = targets?.Projects.FirstOrDefault(x => x.Id == projectId);
        if (p is null) return null;
        var (ra, dec, rot) = Center(p);
        var camera = bootstrap?.Rig.Camera;
        var telescope = bootstrap?.Rig.Telescope;
        int columns = p.Mosaic?.Columns ?? 1, rows = p.Mosaic?.Rows ?? 1;
        var overlap = p.Mosaic?.OverlapPct ?? 20;
        // Gerundet: 382 × 1,0010… ergab in NINA „382.40000000000003 mm“ (P-11, 03.10.2026).
        double? focal = telescope is null
            ? null
            : Math.Round(telescope.FocalLengthMm * (telescope.ReducerFactor > 0 ? telescope.ReducerFactor : 1), 2);
        return new FramingRequest(p.Target?.Name ?? p.Name, ra, dec, rot, columns, rows, overlap,
            camera?.WidthPx, camera?.HeightPx, camera?.PixelSizeUm, focal,
            FieldOfViewDeg(columns, rows, overlap, camera?.WidthPx, camera?.HeightPx, camera?.PixelSizeUm, focal));
    }

    /// <summary>NINAs Vorgabe für das Bildfeld des Himmelsbilds (Grad).</summary>
    public const double DefaultFieldOfViewDeg = 3;

    /// <summary>
    /// Bildfeld des Himmelsbilds: das 1,5-Fache der größeren Mosaik-Kante (deckt jede Rotation ab, Diagonale ≤ √2),
    /// auf 0,5° aufgerundet, mindestens NINAs 3°. Mit der Vorgabe allein lag ein 2×2-Mosaik am Rig (3,05°) außerhalb
    /// des Bilds und NINA zeichnete keine Panels (P-11, 03.10.2026). Ohne Sensor oder Brennweite die Vorgabe.
    /// </summary>
    public static double FieldOfViewDeg(int columns, int rows, double overlapPct, int? widthPx, int? heightPx,
        double? pixelSizeUm, double? focalLengthMm)
    {
        if (widthPx is not { } w || heightPx is not { } h || pixelSizeUm is not { } px || focalLengthMm is not { } fl || fl <= 0)
            return DefaultFieldOfViewDeg;
        double Panel(int pixels) => 2 * Math.Atan(pixels * px / 1000 / (2 * fl)) * 180 / Math.PI;
        double Extent(int n, double panel) => panel * (n - (n - 1) * overlapPct / 100);
        var extent = Math.Max(Extent(columns, Panel(w)), Extent(rows, Panel(h)));
        return Math.Max(DefaultFieldOfViewDeg, Math.Ceiling(extent * 1.5 * 2) / 2);
    }

    /// <summary>Zentrum und <c>pa₀</c> des Projekts (siehe Klassenkommentar).</summary>
    public static (double RaDeg, double DecDeg, double RotationDeg) Center(Projects p)
    {
        if (p.Center is { } c) return (c.RaDeg, c.DecDeg, c.RotationDeg);
        var first = p.Panels[0];
        if (p.Panels.Count == 1) return (first.RaDeg, first.DecDeg, first.RotationDeg);
        double x = 0, y = 0, z = 0;
        foreach (var panel in p.Panels)
        {
            var (px, py, pz) = Vector(panel.RaDeg, panel.DecDeg);
            x += px;
            y += py;
            z += pz;
        }
        var ra = Math.Atan2(y, x) * 180 / Math.PI;
        var dec = Math.Atan2(z, Math.Sqrt(x * x + y * y)) * 180 / Math.PI;
        return (ra < 0 ? ra + 360 : ra, dec, first.RotationDeg);
    }

    private static (double X, double Y, double Z) Vector(double raDeg, double decDeg)
    {
        var a = raDeg * Math.PI / 180;
        var d = decDeg * Math.PI / 180;
        return (Math.Cos(d) * Math.Cos(a), Math.Cos(d) * Math.Sin(a), Math.Sin(d));
    }
}

/// <summary>
/// Panel-Nummerierung NINA-Framing ↔ Raster (geometry.md §2.1, NT-32): NINA zählt zeilenweise ab 1 von oben links –
/// bei Rotation 0 Nordost; Spalte <c>i = 0</c> liegt im Westen, Zeile <c>j = 0</c> im Norden.
/// <c>n = j · cols + (cols − 1 − i) + 1</c>.
/// </summary>
public static class PanelNumbering
{
    public static int NinaNumber(int i, int j, int cols) => j * cols + (cols - 1 - i) + 1;

    public static (int I, int J) Position(int n, int cols) => (cols - 1 - (n - 1) % cols, (n - 1) / cols);

    /// <summary>
    /// Panelzentrum nach geometry.md §2.1 (gnomonisch) – zur Prüfung der Nummerierung und für die Anzeige der
    /// Panelkoordinaten; maßgeblich für Slew bleiben die Koordinaten aus <c>/targets</c>.
    /// </summary>
    public static (double RaDeg, double DecDeg) Center(double ra0Deg, double dec0Deg, double pa0Deg, double fovWDeg, double fovHDeg,
        double overlapPct, int cols, int rows, int n)
    {
        var (i, j) = Position(n, cols);
        var stepX = fovWDeg * (1 - overlapPct / 100);
        var stepY = fovHDeg * (1 - overlapPct / 100);
        var xs = (i - (cols - 1) / 2.0) * stepX;
        var ys = ((rows - 1) / 2.0 - j) * stepY;
        var pa = pa0Deg * Math.PI / 180;
        var xi = (xs * Math.Cos(pa) + ys * Math.Sin(pa)) * Math.PI / 180;
        var eta = (-xs * Math.Sin(pa) + ys * Math.Cos(pa)) * Math.PI / 180;
        var d0 = dec0Deg * Math.PI / 180;
        var rho = Math.Atan(Math.Sqrt(xi * xi + eta * eta));
        var theta = Math.Atan2(xi, eta);
        var dec = Math.Asin(Math.Sin(d0) * Math.Cos(rho) + Math.Cos(d0) * Math.Sin(rho) * Math.Cos(theta));
        var ra = ra0Deg * Math.PI / 180 + Math.Atan2(Math.Sin(rho) * Math.Sin(theta),
            Math.Cos(d0) * Math.Cos(rho) - Math.Sin(d0) * Math.Sin(rho) * Math.Cos(theta));
        var raDeg = ra * 180 / Math.PI % 360;
        return (raDeg < 0 ? raDeg + 360 : raDeg, dec * 180 / Math.PI);
    }
}
