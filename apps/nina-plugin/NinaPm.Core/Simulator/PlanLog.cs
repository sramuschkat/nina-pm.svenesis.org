using System.Globalization;
using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Simulator;

/// <summary>Sprachabhängige Texte des Planprotokolls (DE/EN aus <c>NinaPm.Nina.Ui/Texts.cs</c>, in Tests fest).</summary>
public interface IPlanLogTexts
{
    /// <summary>Spaltenköpfe in der Reihenfolge von <see cref="PlanLog.Columns"/>.</summary>
    IReadOnlyList<string> Headers { get; }

    /// <summary>Befehlsname, z. B. <c>expose_series</c> → „Belichtungsreihe“.</summary>
    string Command(string code);

    /// <summary>„bis 02:34:00 CDT“</summary>
    string Until(string time);

    string Bonus { get; }

    string Yes { get; }

    string No { get; }

    /// <summary>Mondprofil; mitgelieferte heißen <c>moonProfile.&lt;key&gt;</c>.</summary>
    string MoonProfile(string raw);
}

/// <summary>Zeile des Planprotokolls: Zellen in der Reihenfolge von <see cref="PlanLog.Columns"/>.</summary>
public sealed record PlanLogRow(string Cmd, IReadOnlyList<string> Cells)
{
    public string Cell(string column) => Cells[PlanLog.Columns.ToList().IndexOf(column)];
}

/// <summary>
/// Planprotokoll des Simulators (FA-NIN-18, FA-SIM-08) wie S-40 (`apps/web/src/pages/simulator/protocol.ts`): ein Eintrag
/// je Planeintrag mit Zeit in Standortzeit mit Kürzel, Befehl, Ziel, Panel, Nr., Filter, Belichtung, Kamera, Rotation,
/// Koordinaten, Höhe, Mondabstand, Mond ok, gefordertem Abstand, Dunkelheit, Mondvermeidung und Mondprofil.
/// <em>Protokoll kopieren</em> = Tab-getrennt mit Kopfzeile (Einfügen in Tabellenkalkulationen).
/// </summary>
public static class PlanLog
{
    public static readonly IReadOnlyList<string> Columns =
    [
        "time", "cmd", "target", "panel", "no", "filter", "exposure", "gain", "offset", "binning", "readout", "rotation", "ra",
        "dec", "alt", "moonSep", "moonOk", "required", "dark", "la", "profile",
    ];

    private static string Num(double? x, int digits = 1) =>
        x is { } v ? v.ToString("F" + digits.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture) : "";

    private static string Int(int? x) => x is { } v ? v.ToString(CultureInfo.InvariantCulture) : "";

    public static IReadOnlyList<PlanLogRow> Build(NinaSimulation s, SiteTime site, IPlanLogTexts texts)
    {
        string YesNo(bool? v) => v is null ? "" : v.Value ? texts.Yes : texts.No;
        return s.Protocol.Select(r =>
        {
            var code = LockedSettings.Code(r.Cmd);
            var until = r.UntilUtc is { } u ? $" {texts.Until(site.ClockSeconds(u))}" : "";
            var dur = r.DurationS is { } d && d > 0 ? $" ({d.ToString("0.#", CultureInfo.InvariantCulture)} s)" : "";
            var bonus = r.Bonus ? $" · {texts.Bonus}" : "";
            var cells = new[]
            {
                site.ClockSeconds(r.AtUtc),
                $"{texts.Command(code)}{until}{dur}{bonus}",
                r.ProjectName,
                r.Panel,
                Int(r.No),
                r.Filter,
                r.ExposureS is { } e ? $"{e.ToString("0.###", CultureInfo.InvariantCulture)} s" : "",
                Int(r.Gain),
                Int(r.Offset),
                r.Binning is { } b ? $"{b}×{b}" : "",
                r.ReadoutMode ?? "",
                Num(r.RotationDeg),
                Num(r.RaDeg, 4),
                Num(r.DecDeg, 4),
                Num(r.AltDeg),
                Num(r.MoonSepDeg),
                YesNo(r.MoonOk),
                Num(r.RequiredSepDeg),
                YesNo(r.Dark),
                YesNo(r.La),
                r.MoonProfile.Length == 0 ? "" : texts.MoonProfile(r.MoonProfile),
            };
            return new PlanLogRow(code, cells);
        }).ToList();
    }

    /// <summary>Tab-getrennt mit Kopfzeile; Tabulatoren und Zeilenumbrüche in Zellen werden zu Leerzeichen.</summary>
    public static string Tsv(IReadOnlyList<PlanLogRow> rows, IPlanLogTexts texts)
    {
        static string Clean(string v) => v.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
        var lines = new List<string> { string.Join('\t', texts.Headers.Select(Clean)) };
        lines.AddRange(rows.Select(r => string.Join('\t', r.Cells.Select(Clean))));
        return string.Join('\n', lines);
    }
}
