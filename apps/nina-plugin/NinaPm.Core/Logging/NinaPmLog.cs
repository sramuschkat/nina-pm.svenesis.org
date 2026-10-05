using System.Globalization;
using System.Text;
using NinaPm.Core.Time;

namespace NinaPm.Core.Logging;

/// <summary>Ziel der Log-Zeilen: im Plugin NINAs Logger, in Tests eine Liste.</summary>
public interface ILogSink
{
    void Info(string line);
    void Warning(string line);
    void Error(string line);
}

/// <summary>
/// Log-Grammatik der Testprotokolle (FA-NIN-19, ops/plugin-test-protocol.md): eine Zeile je Ereignis,
/// <c>NINA-PM | EVENT key=value …</c>; EVENT in Großbuchstaben, Werte mit Leerzeichen, <c>"</c> oder <c>=</c> in
/// <c>"…"</c>, Zeitpunkte in <c>…Z</c>. Werte <c>null</c> entfallen. Das Sync-Token gehört nie in eine Zeile (SV-08).
/// </summary>
public sealed class NinaPmLog(ILogSink sink)
{
    public const string Prefix = "NINA-PM | ";

    public void Event(string name, params (string Key, object? Value)[] fields) => sink.Info(Line(name, fields));

    public void Warning(string name, params (string Key, object? Value)[] fields) => sink.Warning(Line(name, fields));

    public void Error(string name, params (string Key, object? Value)[] fields) => sink.Error(Line(name, fields));

    /// <summary>Begleittext ohne Grammatik (Präfix ohne Ereignis), z. B. Ausnahmen für NINAs Log.</summary>
    public void Note(string text) => sink.Info($"NINA-PM: {text}");

    public static string Line(string name, params (string Key, object? Value)[] fields)
    {
        if (name.Length == 0 || name.Any(c => !(char.IsAsciiLetterUpper(c) || char.IsAsciiDigit(c) || c == '_')))
            throw new ArgumentException($"Event name must be upper case: {name}", nameof(name));
        var sb = new StringBuilder(Prefix).Append(name);
        foreach (var (key, value) in fields)
        {
            if (value is null) continue;
            sb.Append(' ').Append(key).Append('=').Append(Quote(Text(value)));
        }
        return sb.ToString();
    }

    private static string Text(object value) => value switch
    {
        DateTimeOffset t => UtcText.Seconds(t),
        bool b => b ? "true" : "false",
        double d => Math.Round(d, 1).ToString(CultureInfo.InvariantCulture),
        float f => Math.Round(f, 1).ToString(CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? "",
    };

    private static string Quote(string text) =>
        text.Length == 0 || text.Any(c => char.IsWhiteSpace(c) || c == '"' || c == '=')
            ? $"\"{text.Replace("\\", "\\\\").Replace("\"", "\\\"")}\""
            : text;
}
