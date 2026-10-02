using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Execution;

/// <summary>Ergebnis der Filterauflösung (execution.md §4.4, NT-E1).</summary>
public enum FilterResolutionKind
{
    /// <summary>Kein Filterrad (OSC, leere Filterliste): ohne Filterwechsel belichten.</summary>
    NoWheel,

    /// <summary>Exakter Treffer im NINA-Profil.</summary>
    Found,

    /// <summary><c>ninaFilterName</c> fehlt oder ist im Profil nicht vorhanden: Belichtung überspringen.</summary>
    NotFound,
}

/// <summary>Filter für eine Belichtung: Art, Index im NINA-Profil (nur bei <c>Found</c>) und gesuchter Name.</summary>
public sealed record FilterResolution(FilterResolutionKind Kind, int Index, string? NinaName);

/// <summary>
/// Filterauflösung (FA-RIG-14, FA-NIN-27, execution.md §4.4, NT-E1): ausschließlich über den bestätigten
/// <c>ninaFilterName</c> mit **exaktem** Vergleich (ordinal, keine Normalisierung) gegen die Filternamen des NINA-Profils.
/// Quelle des Namens: die Belichtungszeile in <c>targets</c> (über <c>exposureLineId</c>); ohne <c>targets</c> bzw. ohne
/// die Zeile der Platz der Rig-Filter im Bootstrap (gleicher bestätigter Name). Nie ein „ähnlicher“ oder der gerade
/// eingelegte Filter.
/// </summary>
public static class FilterResolver
{
    public static FilterResolution Resolve(string? ninaFilterName, IReadOnlyList<string>? profileFilterNames)
    {
        if (profileFilterNames is null || profileFilterNames.Count == 0)
            return new FilterResolution(FilterResolutionKind.NoWheel, -1, ninaFilterName);
        if (ninaFilterName is null) return new FilterResolution(FilterResolutionKind.NotFound, -1, null);
        for (var i = 0; i < profileFilterNames.Count; i++)
            if (string.Equals(profileFilterNames[i], ninaFilterName, StringComparison.Ordinal))
                return new FilterResolution(FilterResolutionKind.Found, i, ninaFilterName);
        return new FilterResolution(FilterResolutionKind.NotFound, -1, ninaFilterName);
    }

    /// <summary>
    /// Bestätigter NINA-Name für eine Belichtung: Zeile in <paramref name="targets"/> (auch <c>null</c> = nicht
    /// bestätigt, dann kein Rückfall); ohne Zeile der Rig-Filter mit demselben Kurznamen aus dem Bootstrap.
    /// </summary>
    public static string? NinaNameFor(Entries entry, NinaTargets? targets, NinaBootstrap? bootstrap)
    {
        if (entry.ExposureLineId is { } lineId && targets is not null)
        {
            foreach (var project in targets.Projects)
                foreach (var panel in project.Panels)
                    foreach (var line in panel.Lines)
                        if (line.Id == lineId)
                            return line.NinaFilterName;
        }
        if (entry.Filter is null) return null;
        return bootstrap?.Rig.Filters.FirstOrDefault(f => f.ShortName == entry.Filter)?.NinaFilterName;
    }

    /// <summary>
    /// Beim Planaufbau (execution.md §4.4): bestätigte NINA-Namen aktiver Projekte, die im Profil fehlen – Anlass für
    /// <c>warning filter_wheel_changed</c>. Ohne Filterrad nichts.
    /// </summary>
    public static IReadOnlyList<string> MissingInProfile(NinaTargets? targets, IReadOnlyList<string>? profileFilterNames)
    {
        if (targets is null || profileFilterNames is null || profileFilterNames.Count == 0) return [];
        var missing = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var project in targets.Projects.Where(p => p.Status == ProjectsStatus.Active))
            foreach (var panel in project.Panels)
                foreach (var line in panel.Lines)
                    if (line.NinaFilterName is { } name && !profileFilterNames.Contains(name, StringComparer.Ordinal))
                        missing.Add(name);
        return [.. missing];
    }
}

/// <summary>Ergebnis der Auflösung des Auslesemodus (execution.md §4.3, NT-37).</summary>
public enum ReadoutResolutionKind
{
    /// <summary>Kein Modus verlangt: nichts setzen.</summary>
    Unchanged,

    Found,

    /// <summary>Name nicht gefunden (und mehr als ein Modus): Belichtung überspringen, <c>readout_mode_not_found</c>.</summary>
    NotFound,
}

public sealed record ReadoutResolution(ReadoutResolutionKind Kind, int Index);

/// <summary>
/// Auslesemodus (NT-37): Name → Index in <c>ReadoutModes</c> (exakt, ohne Groß-/Kleinschreibung); meldet die Kamera
/// genau einen Modus, gilt dieser. <c>readoutModeIndex</c> ist nie ein Rückfall (nach einem Treiberwechsel kann ein
/// Index einen anderen Modus bezeichnen).
/// </summary>
public static class ReadoutResolver
{
    public static ReadoutResolution Resolve(string? readoutMode, IReadOnlyList<string>? cameraModes)
    {
        if (string.IsNullOrEmpty(readoutMode)) return new ReadoutResolution(ReadoutResolutionKind.Unchanged, -1);
        var modes = cameraModes ?? [];
        for (var i = 0; i < modes.Count; i++)
            if (string.Equals(modes[i], readoutMode, StringComparison.OrdinalIgnoreCase))
                return new ReadoutResolution(ReadoutResolutionKind.Found, i);
        return modes.Count == 1
            ? new ReadoutResolution(ReadoutResolutionKind.Found, 0)
            : new ReadoutResolution(ReadoutResolutionKind.NotFound, -1);
    }
}

/// <summary>Hinweise höchstens einmal je Zeitraum und Schlüssel (z. B. <c>filter_not_found</c> 1×/12 h je Filter, §4.4).</summary>
public sealed class HintThrottle(TimeSpan interval)
{
    public static readonly TimeSpan TwelveHours = TimeSpan.FromHours(12);
    private readonly Dictionary<string, DateTimeOffset> last = new(StringComparer.Ordinal);

    public bool ShouldEmit(string key, DateTimeOffset now)
    {
        if (last.TryGetValue(key, out var at) && now - at < interval) return false;
        last[key] = now;
        return true;
    }
}
