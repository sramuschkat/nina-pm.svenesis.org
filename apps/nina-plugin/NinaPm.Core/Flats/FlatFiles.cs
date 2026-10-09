using System.Text;

namespace NinaPm.Core.Flats;

/// <summary>
/// Kopie geteilter Flat-Kombinationen in die Ordner der übrigen Ziele (NIN-16b, execution.md §7): Namen werden erst in
/// lesbares ASCII umgeschrieben wie beim Speichern (<see cref="NinaPm.Core.Targets.AsciiName"/>, AP-71), dann sanitisiert wie
/// von NINA (<c>\ / : * ? " &lt; &gt; |</c> → <c>_</c>, getrimmt); ersetzt wird nur ein
/// **ganzes Pfadsegment**, das genau dem Primärziel entspricht – kein Teilstring-Ersatz („M 31“ trifft nicht „M 310“).
/// </summary>
/// <remarks>Muster nach dem Astro-PM-Plugin (MIT), <c>CopyFlatsToDuplicateTargets</c>, Commit 5dd621d – dort Teilstring-Ersatz.</remarks>
public static class FlatFiles
{
    private const string Forbidden = "\\/:*?\"<>|";

    public static string Sanitize(string name)
    {
        var ascii = NinaPm.Core.Targets.AsciiName.Of(name);
        var sb = new StringBuilder(ascii.Length);
        foreach (var c in ascii) sb.Append(Forbidden.Contains(c) || char.IsControl(c) ? '_' : c);
        return sb.ToString().Trim();
    }

    /// <summary>Zielpfad für <paramref name="otherTarget"/>; <c>null</c>, wenn kein Segment dem Primärziel entspricht.</summary>
    public static string? PathFor(string sourcePath, string primaryTarget, string otherTarget)
    {
        var primary = Sanitize(primaryTarget);
        var other = Sanitize(otherTarget);
        if (primary.Length == 0 || other.Length == 0 || primary == other) return null;
        var sb = new StringBuilder(sourcePath.Length);
        var segment = new StringBuilder();
        var replaced = false;
        void Flush()
        {
            if (segment.ToString() == primary)
            {
                sb.Append(other);
                replaced = true;
            }
            else
            {
                sb.Append(segment);
            }
            segment.Clear();
        }
        foreach (var c in sourcePath)
        {
            if (c is '\\' or '/')
            {
                Flush();
                sb.Append(c);
            }
            else
            {
                segment.Append(c);
            }
        }
        Flush();
        return replaced ? sb.ToString() : null;
    }
}
