namespace NinaPm.Core.Reporting;

/// <summary>
/// Pfad einer Bilddatei relativ zum NINA-Bildordner (AP-72b, Plugin 0.4.23): mit <c>/</c> getrennt, ohne Laufwerk und
/// Benutzername, damit die Datei in der Dropbox wiederzufinden ist. Liegt sie außerhalb des Bildordners (oder ist er
/// unbekannt), nur der Dateiname. Reine Zeichenkettenrechnung – auch Windows-Pfade auf macOS/Linux (Tests).
/// </summary>
public static class ImagePaths
{
    public static string? Relative(string? imageRoot, string? fullPath)
    {
        if (string.IsNullOrWhiteSpace(fullPath)) return null;
        var full = fullPath.Replace('\\', '/');
        var name = full[(full.LastIndexOf('/') + 1)..];
        if (string.IsNullOrWhiteSpace(imageRoot)) return name;
        var root = imageRoot.Replace('\\', '/').TrimEnd('/') + "/";
        return full.StartsWith(root, StringComparison.OrdinalIgnoreCase) && full.Length > root.Length
            ? full[root.Length..]
            : name;
    }
}
