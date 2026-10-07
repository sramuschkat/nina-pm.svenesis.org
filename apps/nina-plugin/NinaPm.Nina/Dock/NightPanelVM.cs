using System.ComponentModel.Composition;
using System.Globalization;
using System.Windows.Media;
using NINA.Profile.Interfaces;
using NINA.WPF.Base.ViewModel;
using NinaPm.Core.Simulator;
using NinaPm.Core.Status;
using NinaPm.Nina.Simulator;
using NinaPm.Nina.Status;
using NinaPm.Nina.Ui;
using NinaPm.Nina.Ui.Dock;

namespace NinaPm.Nina.Dock;

/// <summary>
/// Andockbares Fenster „NINA-PM“ im Imaging-Reiter (AP-53b, FA-NIN-28, execution.md §10): Statuszeile (Zustand, Ziel mit
/// Block x/y, Filter, Belichtung n/m mit Fortschritt und Restzeit, Kamera, Danach, Outbox), darunter die Plangrafik mit
/// Erledigtem (blass, aus dem Nachtjournal) und Geplantem (kräftig, aus dem gespeicherten Plan), Lücken mit Grund und
/// Jetzt-Linie, Fußzeile mit Plan und Revision; schmal angedockt zusätzlich die Blockliste „Heutige Ziele“.
/// Muster nach dem Astro-PM-NINA-Plugin (MIT), <c>ViewModels/AstroPMImagingPanelVM.cs</c> @ 5dd621d: MEF-Export als
/// <c>IDockableVM</c>, <c>DockableVM</c> mit <c>IsTool</c>, Vorlage unter <c>&lt;Typ&gt;_Dockable</c>, 2-s-Abfrage.
/// </summary>
[Export(typeof(NINA.Equipment.Interfaces.ViewModel.IDockableVM))]
public sealed class NightPanelVM : DockableVM, IDockSizeSink
{
    private string key = "";
    private double width = PlanChartView.DefaultWidth;
    private double chartWidth;

    [ImportingConstructor]
    public NightPanelVM(IProfileService profileService) : base(profileService)
    {
        Title = Texts.DockTitle;
        ImageGeometry = Icon();
        NightDockModel.Instance.Subscribe(OnUpdated);
    }

    public override bool IsTool => true;

    public override string ContentId => "NinaPm.NightPanel";

    /// <summary>Eigenes Symbol (Berg, Horizont, Stern) – kein „APM“ (Regel 14).</summary>
    internal static GeometryGroup Icon()
    {
        var g = new GeometryGroup { FillRule = FillRule.Nonzero };
        g.Children.Add(Geometry.Parse("M1,21 L23,21 L23,23 L1,23 Z"));
        g.Children.Add(Geometry.Parse("M2,20 L9,9 L13,15 L16,11 L22,20 Z"));
        g.Children.Add(Geometry.Parse("M18,1 L19,4 L22,5 L19,6 L18,9 L17,6 L14,5 L17,4 Z"));
        g.Freeze();
        return g;
    }

    public bool HasRuntime { get; private set; }

    public string Placeholder { get; private set; } = Texts.DockNoRuntime;

    public bool IsNarrow => width < IDockSizeSink.NarrowWidth;

    public bool IsWide => !IsNarrow;

    public string StateText { get; private set; } = "";

    public bool IsBlocked { get; private set; }

    public string BlockedText { get; private set; } = "";

    public bool TestBanner { get; private set; }

    public string TestBannerText => Texts.TestBanner;

    public string TargetLabel { get; private set; } = Texts.DockTarget;

    public string TargetText { get; private set; } = "";

    public string FilterText { get; private set; } = "";

    public string ExposureLabel { get; private set; } = Texts.DockExposure;

    public string ExposureText { get; private set; } = "";

    public double ProgressPercent { get; private set; }

    public bool HasProgress { get; private set; }

    public string RemainingText { get; private set; } = "";

    public string CameraText { get; private set; } = "";

    public string NextText { get; private set; } = "";

    public string OutboxText { get; private set; } = "";

    public string PlanHeader { get; private set; } = "";

    public PlanChartView? Chart { get; private set; }

    public bool HasChart => Chart is not null;

    public string Footer { get; private set; } = "";

    public IReadOnlyList<DockBlockView> Blocks { get; private set; } = [];

    // Beschriftungen für x:Static-freie Bindungen der Vorlage.
    public string StateLabel => Texts.DockState;
    public string FilterLabel => Texts.DockFilter;
    public string CameraLabel => Texts.DockCamera;
    public string NextLabel => Texts.DockNext;
    public string OutboxLabel => Texts.DockOutbox;
    public string BlocksHeader => Texts.DockBlocksHeader;
    public string LegendPast => Texts.DockLegendPast;
    public string LegendPlanned => Texts.DockLegendPlanned;
    public string LegendGap => Texts.DockLegendGap;

    public void DockWidth(double value)
    {
        if (Math.Abs(value - width) < 1) return;
        var wasNarrow = IsNarrow;
        width = value;
        if (wasNarrow != IsNarrow)
        {
            RaisePropertyChanged(nameof(IsNarrow));
            RaisePropertyChanged(nameof(IsWide));
        }
        if (Math.Abs(ChartWidthFor(width) - chartWidth) >= 20) Apply(NightDockModel.Instance.Current, force: true);
    }

    /// <summary>Breite der Grafik: Fensterbreite abzüglich Rand, nicht schmaler als 300 px.</summary>
    internal static double ChartWidthFor(double windowWidth) => Math.Max(300, windowWidth - 24);

    private void OnUpdated(object? sender, EventArgs e) => Apply(NightDockModel.Instance.Current, force: false);

    /// <summary>Momentaufnahme anzeigen; Grafik und Liste nur bei geändertem Schlüssel oder neuer Breite (Tests rufen direkt auf).</summary>
    internal void Apply(DockSnapshot? s, bool force)
    {
        HasRuntime = s is not null;
        if (s is null)
        {
            RaiseAll();
            return;
        }
        var live = new LiveStatusView(s.Live);
        var view = s.View;
        var site = s.Site;
        StateText = live.StateText;
        IsBlocked = live.IsBlocked;
        BlockedText = live.BlockedText;
        TestBanner = live.TestBanner;

        var blocks = view.Blocks.Where(b => !b.Flats).ToList();
        var current = blocks.FindIndex(b => b.State == ActualState.Running);
        TargetLabel = current >= 0 ? $"{Texts.DockTarget} · {Texts.DockBlock(current + 1, blocks.Count)}" : Texts.DockTarget;
        TargetText = live.TargetText;
        FilterText = s.Live.Exposure?.Filter ?? "";
        var inv = CultureInfo.CurrentCulture;
        if (view.Progress is { } p)
        {
            ExposureLabel = $"{Texts.DockExposure} {Texts.DockExposureOf(p.Index, p.Count, p.ExposureS.ToString("0.#", inv))}";
            ProgressPercent = Math.Round(p.Fraction * 100, 1);
            HasProgress = true;
            RemainingText = Texts.DockRemaining($"{(int)p.Remaining.TotalMinutes}:{p.Remaining.Seconds:00}");
        }
        else
        {
            ExposureLabel = Texts.DockExposure;
            HasProgress = false;
            ProgressPercent = 0;
            RemainingText = "";
        }
        ExposureText = live.ExposureText;
        var e = s.Live.Exposure;
        CameraText = string.Join(" · ", new[]
        {
            e?.Gain is { } g ? $"Gain {g}" : null,
            e?.Offset is { } o ? $"Offset {o}" : null,
            e?.ReadoutMode,
            s.CameraTemperatureC is { } t ? $"{t.ToString("0.0", inv)} °C" : null,
        }.Where(x => !string.IsNullOrEmpty(x)));
        NextText = view.Next is { } n
            ? n.Flats ? Texts.DockNextFlats(site.Clock(n.AtUtc)) : Texts.DockNextBlock(n.Title, site.Clock(n.AtUtc))
            : "";
        OutboxText = Texts.DockOutboxCount(s.Live.OutboxPending);
        PlanHeader = Texts.DockPlanHeader(site.Abbr(s.Now));
        Footer = view.PlanId is { } id
            ? Texts.DockFooter(id.ToString("N")[..8], view.Revision, view.PlanReason, view.PlanAtUtc is { } at ? site.Clock(at) : null,
                s.TargetsFetchedUtc is { } tf ? site.Clock(tf) : null, site.Abbr(s.Now))
            : Texts.DockNoPlan;

        if (force || s.Key != key)
        {
            key = s.Key;
            chartWidth = ChartWidthFor(width);
            Chart = view.Chart is { } c ? new PlanChartView(c, IsNarrow ? chartWidth : Math.Min(chartWidth, 1600)) : null;
            Blocks = [.. view.Blocks.Select(b => new DockBlockView(b, site))];
        }
        RaiseAll();
    }

    private void RaiseAll()
    {
        foreach (var name in new[]
        {
            nameof(HasRuntime), nameof(StateText), nameof(IsBlocked), nameof(BlockedText), nameof(TestBanner), nameof(TargetLabel), nameof(TargetText),
            nameof(FilterText), nameof(ExposureLabel), nameof(ExposureText), nameof(ProgressPercent), nameof(HasProgress), nameof(RemainingText),
            nameof(CameraText), nameof(NextText), nameof(OutboxText), nameof(PlanHeader), nameof(Chart), nameof(HasChart), nameof(Footer),
            nameof(Blocks), nameof(IsNarrow), nameof(IsWide),
        })
            RaisePropertyChanged(name);
    }
}

/// <summary>Zeile „Heutige Ziele“ im schmalen Fenster: Zeichen, Zeitfenster in Standortzeit, Name; Erledigtes blass.</summary>
public sealed class DockBlockView(NightBlockRow b, SiteTime site)
{
    public string Symbol => b.State switch
    {
        ActualState.Done => "✓",
        ActualState.Running => "▶",
        ActualState.Skipped => "↷",
        _ => "○",
    };

    public string Window => b.EndUtc is { } end && !b.Flats ? $"{site.Clock(b.StartUtc)}–{site.Clock(end)}" : Texts.DockNextFlats(site.Clock(b.StartUtc));

    public string Title => b.Flats ? "" : b.Transit ? $"{b.Title} ({Texts.Transit})" : b.Title;

    public double Opacity => b.State == ActualState.Done ? 0.55 : 1;

    public bool IsRunning => b.State == ActualState.Running;
}
