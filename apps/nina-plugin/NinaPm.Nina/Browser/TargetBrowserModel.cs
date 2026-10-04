using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using NINA.Astrometry;
using NINA.Core.Utility;
using NinaPm.Core.Targets;
using NinaPm.Nina.Adapters;
using NinaPm.Nina.Sequencer;
using NinaPm.Nina.Ui;

namespace NinaPm.Nina.Browser;

/// <summary>
/// Zielbrowser auf der Optionsseite (FA-NIN-02, AP-16h): Ziele aus dem Cache der Laufzeit (<c>GET /targets</c>) mit dem
/// Rig des Bootstraps, Filter nach Typ und Fortschritt, <em>Aktualisieren</em> (wie die Anweisung <em>Ziele
/// aktualisieren</em>) und <em>In Framing-Assistent laden</em>.
/// </summary>
public sealed class TargetBrowserModel : INotifyPropertyChanged
{
    private readonly FramingLoader? framing;
    private int typeIndex;
    private bool openOnly;
    private TargetRowView? selected;
    private string status = "";

    internal TargetBrowserModel(FramingLoader? framing)
    {
        this.framing = framing;
        RefreshCommand = new RelayCommand(RefreshAsync);
        LoadCommand = new RelayCommand(LoadAsync);
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public ObservableCollection<TargetRowView> Rows { get; } = [];

    public IReadOnlyList<string> Types { get; } = [Texts.TypeAll, Texts.TypeDeepSky, Texts.TypeExoplanet];

    public int TypeIndex
    {
        get => typeIndex;
        set
        {
            typeIndex = value;
            Rebuild();
        }
    }

    public bool OpenOnly
    {
        get => openOnly;
        set
        {
            openOnly = value;
            Rebuild();
        }
    }

    public TargetRowView? Selected
    {
        get => selected;
        set
        {
            selected = value;
            Raise();
        }
    }

    public string Status
    {
        get => status;
        private set
        {
            status = value;
            Raise();
        }
    }

    public ICommand RefreshCommand { get; }

    public ICommand LoadCommand { get; }

    /// <summary>Zeilen aus dem Cache neu aufbauen (ohne Abruf).</summary>
    public void Rebuild()
    {
        var runner = NinaPmRuntime.Current?.Runner;
        var type = typeIndex switch { 1 => "deep_sky", 2 => "exoplanet", _ => null };
        var keep = selected?.Row.ProjectId;
        Rows.Clear();
        foreach (var row in TargetBrowser.Rows(runner?.Targets, runner?.Bootstrap, type, openOnly))
            Rows.Add(new TargetRowView(row));
        Selected = Rows.FirstOrDefault(r => r.Row.ProjectId == keep);
        Status = runner is null ? Texts.NotConfigured : Texts.TargetsCount(Rows.Count);
    }

    /// <summary>Nach einem Abruf (Bootstrap und Ziele neu) – der Simulator zieht seinen Stand nach.</summary>
    public event Action? Refreshed;

    private async Task RefreshAsync()
    {
        if (NinaPmRuntime.Current is { } runtime) await runtime.Runner.RefreshAsync(CancellationToken.None);
        Rebuild();
        Refreshed?.Invoke();
    }

    private async Task LoadAsync()
    {
        var runner = NinaPmRuntime.Current?.Runner;
        if (selected is null || runner is null) return;
        if (framing is null || TargetBrowser.Framing(runner.Targets, runner.Bootstrap, selected.Row.ProjectId) is not { } request)
        {
            Status = Texts.FramingUnavailable;
            return;
        }
        try
        {
            await framing.LoadAsync(request);
            Status = Texts.FramingLoaded(request.Name);
        }
        catch (Exception ex)
        {
            Logger.Warning($"NINA-PM: Framing-Assistent: {ex.Message}");
            Status = Texts.FramingUnavailable;
        }
    }

    private void Raise([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

/// <summary>Anzeigezeile des Zielbrowsers (Formatierung; die Werte rechnet der Kern).</summary>
public sealed class TargetRowView(TargetRow row)
{
    public TargetRow Row { get; } = row;

    public string Name => Row.Name;

    public string Ra => AstroUtil.HoursToHMS(Row.RaDeg / 15);

    public string Dec => AstroUtil.DegreesToDMS(Row.DecDeg);

    public string Rotation => $"{Row.RotationDeg.ToString("0.0", CultureInfo.CurrentCulture)}°";

    public int Panels => Row.Panels;

    public string FocalLength => Row.FocalLengthMm is { } f ? $"{f.ToString("0", CultureInfo.CurrentCulture)} mm" : "";

    public string Sensor => Row.SensorWidthPx is { } w && Row.SensorHeightPx is { } h ? $"{w} × {h}" : "";

    public string Pixel => Row.PixelSizeUm is { } p ? p.ToString("0.00", CultureInfo.CurrentCulture) : "";

    public int Priority => Row.Priority;

    public string Type => Row.Type == "exoplanet" ? Texts.TypeExoplanet : Texts.TypeDeepSky;

    public string Progress => $"{Row.ProgressPct.ToString("0", CultureInfo.CurrentCulture)} %";

    public string NextTransit => Row.NextTransitUtc is { } t ? t.ToString("yyyy-MM-dd HH:mm 'UTC'", CultureInfo.InvariantCulture) : "";
}
