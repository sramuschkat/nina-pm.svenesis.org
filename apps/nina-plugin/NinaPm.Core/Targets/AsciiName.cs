using System.Globalization;
using System.Text;

namespace NinaPm.Core.Targets;

/// <summary>
/// Lesbarer ASCII-Name für Ordner, Dateien und den FITS-Kopf (AP-71, Entscheidung Sven 09.10.2026). NINAs eigene Anweisungen
/// (Flats, Belichtung) schreiben den Zielnamen als <c>NameAsAscii</c> – <c>Encoding.ASCII</c> macht aus jedem Zeichen
/// außerhalb von ASCII ein „?“ und das Speichern daraus ein „_“. Die Lights des Plugins übernahmen den Namen unverändert:
/// „IC 5146 – Cocoon Nebula“ (Lights) neben „IC 5146 _ Cocoon Nebula“ (Flats), und die Kopie der Flats fand das Ziel im
/// Pfad nicht (Rig-Nacht 07./08.10.2026: 75 × <c>COPY status=no_target_segment</c>). Mit diesem Namen ist NINAs Umwandlung
/// eine Identität, und alle Dateien eines Ziels landen in einem Ordner.
/// <list type="bullet">
/// <item>Striche (– — ‒ ―, Minus) → „-“, typografische Anführungszeichen → <c>'</c>, Auslassung … → „...“, geschütztes Leerzeichen → Leerzeichen;</item>
/// <item>ä ö ü → ae oe ue (auch groß), ß → ss; übrige Akzente fallen weg (é → e);</item>
/// <item>griechische Buchstaben wie NINA (SIMBAD-Kürzel: α → alf, β → bet, μ → mu.);</item>
/// <item>alles übrige außerhalb von ASCII → „_“ (wie NINA, nur ohne den Umweg über „?“).</item>
/// </list>
/// </summary>
public static class AsciiName
{
    private static readonly Dictionary<char, string> Map = new()
    {
        ['–'] = "-", ['—'] = "-", ['‒'] = "-", ['―'] = "-", ['−'] = "-", ['‐'] = "-", ['‑'] = "-",
        ['‘'] = "'", ['’'] = "'", ['‚'] = "'", ['‛'] = "'", ['“'] = "'", ['”'] = "'", ['„'] = "'", ['«'] = "'", ['»'] = "'",
        ['…'] = "...", ['\u00A0'] = " ", ['\u2009'] = " ", ['\u202F'] = " ", ['×'] = "x",
        ['ä'] = "ae", ['ö'] = "oe", ['ü'] = "ue", ['Ä'] = "Ae", ['Ö'] = "Oe", ['Ü'] = "Ue", ['ß'] = "ss",
        // SIMBAD-Kürzel wie NINAs TextEncoding.GreekToLatinAbbreviation (Groß- und Kleinbuchstaben gleich).
        ['Α'] = "alf", ['α'] = "alf", ['Β'] = "bet", ['β'] = "bet", ['Γ'] = "gam", ['γ'] = "gam", ['Δ'] = "del", ['δ'] = "del",
        ['Ε'] = "eps", ['ε'] = "eps", ['Ζ'] = "zet", ['ζ'] = "zet", ['Η'] = "eta", ['η'] = "eta", ['Θ'] = "tet", ['θ'] = "tet",
        ['Ι'] = "iot", ['ι'] = "iot", ['Κ'] = "kap", ['κ'] = "kap", ['Λ'] = "lam", ['λ'] = "lam", ['Μ'] = "mu.", ['µ'] = "mu.",
        ['μ'] = "mu.", ['Ν'] = "nu.", ['ν'] = "nu.", ['Ξ'] = "ksi", ['ξ'] = "ksi", ['Ο'] = "omi", ['ο'] = "omi", ['Π'] = "pi.",
        ['π'] = "pi.", ['Ρ'] = "rho", ['ρ'] = "rho", ['Σ'] = "sig", ['σ'] = "sig", ['ς'] = "sig", ['Τ'] = "tau", ['τ'] = "tau",
        ['Υ'] = "ups", ['υ'] = "ups", ['Φ'] = "phi", ['φ'] = "phi", ['Χ'] = "chi", ['χ'] = "chi", ['Ψ'] = "psi", ['ψ'] = "psi",
        ['Ω'] = "ome", ['ω'] = "ome",
    };

    public static string Of(string name)
    {
        var sb = new StringBuilder(name.Length);
        foreach (var c in name)
        {
            if (c < 0x80)
            {
                sb.Append(c);
                continue;
            }
            if (Map.TryGetValue(c, out var mapped))
            {
                sb.Append(mapped);
                continue;
            }
            // Akzente: zerlegen und nur den Grundbuchstaben behalten (é → e, å → a); sonst „_“.
            var basis = c.ToString().Normalize(NormalizationForm.FormD)
                .Where(x => CharUnicodeInfo.GetUnicodeCategory(x) != UnicodeCategory.NonSpacingMark).ToArray();
            sb.Append(basis.Length > 0 && basis.All(x => x < 0x80) ? new string(basis) : "_");
        }
        return sb.ToString();
    }
}
