using System.Globalization;
using System.IO;
using System.Text;

namespace NinaPm.Probe;

/// <summary>
/// Log-Zeilen nach der Grammatik aus ops/plugin-test-protocol.md: <c>NINA-PM | EVENT key=value …</c>, Werte mit
/// Leerzeichen oder Anführungszeichen in <c>"…"</c>. Jede Zeile geht in NINAs Log (Präfix hinter NINAs eigenen
/// Spalten) und zusätzlich in <c>%LOCALAPPDATA%\NINA\NinaPmProbe\nina-pm.log</c> – diese Datei lässt sich direkt
/// als <c>nina.log</c> ablegen.
/// </summary>
public static class ProbeLog
{
    private static readonly object Gate = new();

    public static string LogFile { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NINA", "NinaPmProbe", "nina-pm.log");

    /// <summary>Zeitpunkt in der Form der Grammatik (<c>…Z</c>, ganze Sekunden).</summary>
    public static string Iso(DateTime utc) => utc.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

    public static string Seconds(double s) => Math.Round(s, 1).ToString(CultureInfo.InvariantCulture);

    public static void Event(string name, params (string Key, object? Value)[] fields)
    {
        var sb = new StringBuilder("NINA-PM | ").Append(name);
        foreach (var (key, value) in fields)
        {
            if (value is null) continue;
            var text = Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
            sb.Append(' ').Append(key).Append('=');
            if (text.Length == 0 || text.Any(c => char.IsWhiteSpace(c) || c == '"' || c == '='))
                sb.Append('"').Append(text.Replace("\\", "\\\\").Replace("\"", "\\\"")).Append('"');
            else
                sb.Append(text);
        }
        Write(sb.ToString());
    }

    /// <summary>Begleittext ohne Grammatik (nur NINAs Log), z. B. die Einstellungen eines Laufs.</summary>
    public static void Note(string text) => NINA.Core.Utility.Logger.Info($"NINA-PM Probe: {text}");

    private static void Write(string line)
    {
        NINA.Core.Utility.Logger.Info(line);
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogFile)!);
                File.AppendAllText(LogFile, $"{Iso(DateTime.UtcNow)} {line}{Environment.NewLine}");
            }
        }
        catch (IOException)
        {
            // Nur die Begleitdatei; NINAs Log hat die Zeile schon.
        }
    }
}
