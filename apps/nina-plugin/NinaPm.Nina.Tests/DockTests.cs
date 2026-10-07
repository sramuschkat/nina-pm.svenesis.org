using System.ComponentModel.Composition;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Moq;
using NINA.Equipment.Interfaces.ViewModel;
using NINA.Profile.Interfaces;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Simulator;
using NinaPm.Core.Status;
using NinaPm.Core.Time;
using NinaPm.Nina.Dock;
using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>
/// Fenster im Imaging-Reiter (AP-53b, FA-NIN-28): MEF-Export als andockbare Werkzeuge, Vorlagen unter
/// „&lt;Typ&gt;_Dockable“, Anzeige aus einer Momentaufnahme (Status, Fortschritt, Fußzeile, Protokoll mit Ist-Spalte,
/// Nur Belichtungen, TSV) und Rendern breit und schmal ohne Binding-Fehler (PNG im CI-Artefakt <c>nina-pm-render</c>).
/// </summary>
[Collection(WpfCollection.Name)]
public sealed class DockTests
{
    private static readonly NinaPlanResponse Plan = SimulatorModelTests.Example<NinaPlanResponse>("plan.response");
    private static readonly NinaTargets Targets = SimulatorModelTests.Example<NinaTargets>("targets.response");
    private static DateTimeOffset T(string hhmmss) => UtcText.Parse($"2026-09-18T{hhmmss}Z");

    private static DockSnapshot Snapshot(bool withSimulation)
    {
        var transit = Plan.Blocks[0];
        var regular = Plan.Blocks[1];
        long id = 0;
        JournalEntry E(string at, string kind, JournalData d) => new(++id, T(at), kind, d);
        var journal = new List<JournalEntry>
        {
            E("01:50:00", JournalKinds.Plan, new JournalData { PlanId = Plan.NightPlanId, Revision = 1, Reason = "initial" }),
            E("02:05:30", JournalKinds.BlockStart, new JournalData { BlockId = transit.Id, ProjectId = transit.ProjectId, Title = "HAT-P-17 b", Transit = true }),
            E("02:09:00", JournalKinds.Capture, new JournalData { BlockId = transit.Id, ProjectId = transit.ProjectId, Filter = "R", ExposureS = 60, StartUtc = T("02:08:00"), Result = "saved" }),
            E("07:34:00", JournalKinds.BlockEnd, new JournalData { BlockId = transit.Id, Reason = "completed", Exposures = 1 }),
            E("07:38:00", JournalKinds.BlockStart, new JournalData { BlockId = regular.Id, ProjectId = regular.ProjectId, Title = "NGC 281 Pacman" }),
        };
        var sim = withSimulation ? SimulatorModelTests.Sim : null;
        var site = sim is null ? SiteTime.From(SimulatorModelTests.Bootstrap) : SiteTime.From(sim);
        var current = regular.Entries.First(e => e.Seq == 4);
        var inputs = new NightViewInputs(Plan.Night, journal, Plan, new HashSet<Guid> { transit.Id }, (regular, T("07:38:00")), current, T("07:42:40"),
            Targets, SimulatorModelTests.Bootstrap, sim, site, T("07:44:40"));
        var view = NightViewBuilder.Build(inputs);
        var live = new LiveStatus(LiveState.Running, null, false, "NGC 281 Pacman", regular.RaDeg, regular.DecDeg, regular.RotationDeg,
            new LiveExposure("Ha", 300, 125, 50, 1, "Low Noise"), null, [], OutboxPending: 0, DeadLetters: 0, Offline: false, TestBanner: false);
        return new DockSnapshot(live, view, site, -10, T("07:40:00"), T("07:44:40"), $"k{withSimulation}");
    }

    private static Mock<IProfileService> Profile() => new() { DefaultValue = DefaultValue.Mock };

    [Fact]
    public void Beide_Fenster_sind_andockbare_Werkzeuge_mit_Vorlage() => Sta.Run(() =>
    {
        foreach (var type in new[] { typeof(NightPanelVM), typeof(NightLogVM) })
        {
            Assert.Contains(type.GetCustomAttributes(typeof(ExportAttribute), false).Cast<ExportAttribute>(), a => a.ContractType == typeof(IDockableVM));
            Assert.IsType<DataTemplate>(new NinaPmResources()[$"{type.FullName}_Dockable"]);
        }
        var panel = new NightPanelVM(Profile().Object);
        var log = new NightLogVM(Profile().Object);
        Assert.True(panel.IsTool && log.IsTool);
        Assert.Equal(("NINA-PM", "NinaPm.NightPanel", "NinaPm.NightLog"), (panel.Title, panel.ContentId, log.ContentId));
        Assert.DoesNotContain("Astro", panel.Title + log.Title, StringComparison.OrdinalIgnoreCase);
    });

    [Fact]
    public void Statuszeile_Fortschritt_Danach_und_Fusszeile() => Sta.Run(() =>
    {
        var panel = new NightPanelVM(Profile().Object);
        panel.Apply(Snapshot(withSimulation: false), force: true);
        Assert.True(panel.HasRuntime);
        Assert.Contains("2/2", panel.TargetLabel);
        Assert.Equal("Ha", panel.FilterText);
        Assert.True(panel.HasProgress);
        Assert.Equal(40, panel.ProgressPercent);
        Assert.Contains("3:00", panel.RemainingText);
        Assert.Contains("Gain 125", panel.CameraText);
        Assert.Contains("°C", panel.CameraText);
        Assert.Contains("Flats", panel.NextText);
        Assert.Contains("Rev. 1", panel.Footer);
        Assert.NotNull(panel.Chart);

        panel.DockWidth(420);
        Assert.True(panel.IsNarrow);
        Assert.True(panel.Chart!.ChartWidth < 420);
        Assert.Contains(panel.Blocks, b => b.Symbol == "✓");
    });

    [Fact]
    public void Protokoll_Nur_Belichtungen_Mitlaufen_und_TSV() => Sta.Run(() =>
    {
        var log = new NightLogVM(Profile().Object);
        log.Apply(Snapshot(withSimulation: true));
        Assert.Contains("1", log.Counters);
        Assert.NotNull(log.CurrentRow);
        Assert.True(log.CurrentRow!.IsCurrent);
        Assert.StartsWith("▶", log.CurrentRow.Actual);
        Assert.Contains(log.Rows, r => r.Actual.StartsWith("✓", StringComparison.Ordinal) && r.Opacity < 1);

        log.OnlyExposures = true;
        Assert.All(log.Rows, r => Assert.True(r.Row.IsExposure || r.Row.State == ActualState.Gap));

        var tsv = log.Tsv().Split('\n');
        Assert.Equal(log.Rows.Count + 1, tsv.Length);
        Assert.Equal(16, tsv[0].Split('\t').Length);
    });

    [Fact]
    public void Fenster_rendern_breit_und_schmal_ohne_Binding_Fehler() => Sta.Run(() =>
    {
        var resources = new NinaPmResources();
        var errors = new List<string>();
        foreach (var (width, sim) in new[] { (1100.0, true), (420.0, false) })
        {
            var panel = new NightPanelVM(Profile().Object);
            panel.DockWidth(width);
            panel.Apply(Snapshot(sim), force: true);
            errors.AddRange(Render(panel, (DataTemplate)resources[$"{typeof(NightPanelVM).FullName}_Dockable"], width, $"dock-nina-pm-{width:0}.png"));
        }
        var log = new NightLogVM(Profile().Object);
        log.Apply(Snapshot(withSimulation: true));
        errors.AddRange(Render(log, (DataTemplate)resources[$"{typeof(NightLogVM).FullName}_Dockable"], 1100, "dock-nina-pm-protokoll.png", 500));
        Assert.Empty(errors);
    });

    private sealed class BindingErrors : TraceListener
    {
        public List<string> Errors { get; } = [];
        public override void Write(string? message) { }
        public override void WriteLine(string? message)
        {
            if (message is not null) Errors.Add(message);
        }
    }

    private static List<string> Render(object content, DataTemplate template, double width, string file, double? height = null)
    {
        var listener = new BindingErrors();
        PresentationTraceSources.Refresh();
        PresentationTraceSources.DataBindingSource.Listeners.Add(listener);
        PresentationTraceSources.DataBindingSource.Switch.Level = SourceLevels.Warning;
        try
        {
            var host = new Border { Background = Brushes.DimGray, Child = new ContentControl { Content = content, ContentTemplate = template } };
            host.Measure(new Size(width, height ?? double.PositiveInfinity));
            host.Arrange(new Rect(new Size(width, height ?? host.DesiredSize.Height)));
            host.UpdateLayout();
            var bitmap = new RenderTargetBitmap((int)Math.Ceiling(host.ActualWidth), (int)Math.Ceiling(Math.Max(1, host.ActualHeight)), 96, 96, PixelFormats.Pbgra32);
            bitmap.Render(host);
            var png = new PngBitmapEncoder();
            png.Frames.Add(BitmapFrame.Create(bitmap));
            var dir = Path.Combine(AppContext.BaseDirectory, "render");
            Directory.CreateDirectory(dir);
            using var stream = File.Create(Path.Combine(dir, file));
            png.Save(stream);
            return listener.Errors;
        }
        finally
        {
            PresentationTraceSources.DataBindingSource.Listeners.Remove(listener);
        }
    }
}
