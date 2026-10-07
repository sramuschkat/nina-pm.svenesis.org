using System.ComponentModel.Composition;
using System.Globalization;
using System.Windows.Input;
using NINA.Core.Utility;
using NINA.Profile.Interfaces;
using NINA.WPF.Base.ViewModel;
using NinaPm.Core.Simulator;
using NinaPm.Core.Status;
using NinaPm.Nina.Ui;

namespace NinaPm.Nina.Dock;

/// <summary>
/// Andockbares Fenster „NINA-PM Protokoll“ im Imaging-Reiter (AP-53b, FA-NIN-28, execution.md §10): Tabelle der Nacht mit
/// der Spalte **Ist** – vergangene Zeilen aus dem Nachtjournal (blass), künftige aus dem gespeicherten Plan (kräftig), die
/// laufende Zeile hervorgehoben; *Mitlaufen* hält sie im Blick, *Nur Belichtungen* blendet Anfahren, Filter, Dither und
/// Hinweise aus, *Protokoll kopieren* liefert TSV. Kopfzeile mit den Zählern der Nacht.
/// Muster nach dem Astro-PM-NINA-Plugin (MIT), <c>ViewModels/AstroPMLogPanelVM.cs</c> @ 5dd621d.
/// </summary>
[Export(typeof(NINA.Equipment.Interfaces.ViewModel.IDockableVM))]
public sealed class NightLogVM : DockableVM, NinaPm.Nina.Ui.Dock.IFollowRows
{
    private string key = "";
    private IReadOnlyList<NightLogRow> all = [];
    private SiteTime site = SiteTime.Utc;
    private bool onlyExposures;
    private bool follow = true;

    [ImportingConstructor]
    public NightLogVM(IProfileService profileService) : base(profileService)
    {
        Title = Texts.DockLogTitle;
        ImageGeometry = NightPanelVM.Icon();
        CopyCommand = new RelayCommand(Copy);
        NightDockModel.Instance.Subscribe(OnUpdated);
    }

    public override bool IsTool => true;

    public override string ContentId => "NinaPm.NightLog";

    public bool HasRuntime { get; private set; }

    public string Placeholder => Texts.DockNoRuntime;

    public string Counters { get; private set; } = "";

    public string Legend => Texts.DockLegendActual;

    public string FollowLabel => Texts.DockFollow;

    public string OnlyExposuresLabel => Texts.DockOnlyExposures;

    public string CopyLabel => Texts.CopyProtocol;

    public string CopyStatus { get; private set; } = "";

    public ICommand CopyCommand { get; }

    public IReadOnlyList<NightLogRowView> Rows { get; private set; } = [];

    /// <summary>Laufende bzw. nächste Zeile; mit <see cref="Follow"/> scrollt die Vorlage sie in den Blick.</summary>
    public NightLogRowView? CurrentRow { get; private set; }

    object? NinaPm.Nina.Ui.Dock.IFollowRows.CurrentRow => CurrentRow;

    public bool Follow
    {
        get => follow;
        set
        {
            follow = value;
            RaisePropertyChanged();
            RaisePropertyChanged(nameof(CurrentRow));
        }
    }

    public bool OnlyExposures
    {
        get => onlyExposures;
        set
        {
            onlyExposures = value;
            RaisePropertyChanged();
            Rebuild();
        }
    }

    private void OnUpdated(object? sender, EventArgs e) => Apply(NightDockModel.Instance.Current);

    internal void Apply(DockSnapshot? s)
    {
        HasRuntime = s is not null;
        RaisePropertyChanged(nameof(HasRuntime));
        if (s is null || s.Key == key) return;
        key = s.Key;
        all = s.View.Rows;
        site = s.Site;
        Counters = Texts.DockCounters(s.View.Saved, s.View.Skipped, s.View.Failed);
        RaisePropertyChanged(nameof(Counters));
        Rebuild();
    }

    private void Rebuild()
    {
        Rows = [.. all.Where(r => !onlyExposures || r.IsExposure || r.State == ActualState.Gap).Select(r => new NightLogRowView(r, site))];
        CurrentRow = Rows.FirstOrDefault(r => r.Row.Current) ?? Rows.FirstOrDefault(r => !r.Row.Past);
        RaisePropertyChanged(nameof(Rows));
        RaisePropertyChanged(nameof(CurrentRow));
    }

    /// <summary>Tab-getrennt mit Kopfzeile (Ist, dann die Spalten des Planprotokolls bis Höhe).</summary>
    internal string Tsv() => NightLogRowView.Tsv(Rows);

    private Task Copy()
    {
        try
        {
            System.Windows.Clipboard.SetText(Tsv());
            CopyStatus = Texts.Copied;
        }
        catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or InvalidOperationException)
        {
            Logger.Warning($"NINA-PM: clipboard: {ex.Message}");
            CopyStatus = ex.Message;
        }
        RaisePropertyChanged(nameof(CopyStatus));
        return Task.CompletedTask;
    }
}

/// <summary>Zeile des Protokoll-Fensters: Ist mit Grund, Zeit in Standortzeit, Befehl, Ziel und Kamerawerte; blass bzw. hervorgehoben.</summary>
public sealed class NightLogRowView(NightLogRow row, SiteTime site)
{
    /// <summary>Spalten nach „Ist“ (Schlüssel wie <see cref="PlanLog.Columns"/>).</summary>
    public static readonly IReadOnlyList<string> Columns =
        ["time", "cmd", "target", "panel", "no", "filter", "exposure", "gain", "offset", "binning", "readout", "rotation", "ra", "dec", "alt"];

    public NightLogRow Row { get; } = row;

    private static string Num(double? x, int digits = 1) =>
        x is { } v ? v.ToString("F" + digits.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture) : "";

    private static string Int(int? x) => x is { } v ? v.ToString(CultureInfo.InvariantCulture) : "";

    public string Actual
    {
        get
        {
            var symbol = Row.State switch
            {
                ActualState.Saved or ActualState.Done => "✓",
                ActualState.Skipped => "↷",
                ActualState.Failed => "✕",
                ActualState.Running => "▶",
                ActualState.Gap => "⚠",
                _ => "○",
            };
            var reason = Row.Reason is { } r ? Texts.ActualReason(r) : null;
            if (Row.State == ActualState.Running && Row.Progress is { } p) return $"{symbol} {Math.Round(p * 100):0} %";
            if (Row.State == ActualState.Gap && Row.Count > 1) reason = Texts.GapText("EmptyBlocks", Row.Reason, Row.Count);
            return reason is null ? symbol : $"{symbol} {reason}";
        }
    }

    public string Time => site.ClockSeconds(Row.AtUtc);

    public string Cmd
    {
        get
        {
            var text = Texts.Command(Row.Cmd);
            if (Row.DurationS is { } d && d > 0 && Row.Cmd is "meridian_flip" or "gap")
                text += $" ({TimeSpan.FromSeconds(d):h\\:mm\\:ss})";
            return text;
        }
    }

    public string Target => Row.Target;
    public string Panel => Row.Panel;
    public string No => Int(Row.No);
    public string Filter => Row.Filter;
    public string Exposure => Row.ExposureS is { } e ? $"{e.ToString("0.###", CultureInfo.InvariantCulture)} s" : "";
    public string Gain => Int(Row.Gain);
    public string Offset => Int(Row.Offset);
    public string Binning => Row.Binning is { } b ? $"{b}×{b}" : "";
    public string Readout => Row.Readout ?? "";
    public string Rotation => Num(Row.RotationDeg);
    public string Ra => Num(Row.RaDeg, 4);
    public string Dec => Num(Row.DecDeg, 4);
    public string Alt => Num(Row.AltDeg);

    /// <summary>Vergangene Zeilen blass, künftige kräftig (Sven 07.10.2026).</summary>
    public double Opacity => Row.Past ? 0.5 : 1;

    public bool IsCurrent => Row.Current;

    public IReadOnlyList<string> Cells => [Actual, Time, Cmd, Target, Panel, No, Filter, Exposure, Gain, Offset, Binning, Readout, Rotation, Ra, Dec, Alt];

    /// <summary>Tab-getrennt mit Kopfzeile (Ist, dann die Spalten des Planprotokolls bis Höhe).</summary>
    internal static string Tsv(IEnumerable<NightLogRowView> rows)
    {
        static string Clean(string v) => v.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
        var header = new[] { Texts.LogActual }.Concat(Columns.Select(Texts.LogColumn));
        var lines = new List<string> { string.Join('\t', header.Select(Clean)) };
        lines.AddRange(rows.Select(r => string.Join('\t', r.Cells.Select(Clean))));
        return string.Join('\n', lines);
    }
}
