namespace NinaPm.Core.Execution;

/// <summary>Bildstatistik je Aufnahme (AP-71, Grundlage für AP-72): Sättigung aus NINAs <c>ImageStatistics</c>.</summary>
public static class ImageStats
{
    /// <summary>
    /// Anteil der Pixel am Maximalwert der Bittiefe in % (4 Nachkommastellen). Liegt das Bildmaximum darunter, ist nichts
    /// gesättigt (0); ohne Pixelzahl bzw. mit unplausibler Bittiefe <c>null</c>.
    /// </summary>
    public static double? SaturatedPct(double max, long maxOccurrences, int bitDepth, long pixels)
    {
        if (pixels <= 0 || bitDepth is < 8 or > 32 || !double.IsFinite(max) || maxOccurrences < 0) return null;
        var full = Math.Pow(2, bitDepth) - 1;
        if (max < full) return 0;
        return Math.Round(Math.Min(100, 100.0 * maxOccurrences / pixels), 4);
    }
}
