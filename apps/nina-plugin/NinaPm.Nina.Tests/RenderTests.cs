using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Moq;
using NINA.Profile.Interfaces;
using NinaPm.Core.Status;
using NinaPm.Core.Targets;
using NinaPm.Nina.Browser;
using NinaPm.Nina.Status;
using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>
/// Oberfläche ohne VM (AP-16h): Live-Status-Kopf und Optionsseite mit Testdaten rendern, als PNG unter
/// <c>bin/…/render/</c> ablegen (CI-Artefakt <c>nina-pm-render</c>) und jeden Binding-Fehler als Testfehler melden.
/// </summary>
[Collection(WpfCollection.Name)]
public sealed class RenderTests
{
    private sealed class BindingErrors : TraceListener
    {
        public List<string> Errors { get; } = [];
        public override void Write(string? message) { }
        public override void WriteLine(string? message)
        {
            if (message is not null) Errors.Add(message);
        }
    }

    private static string Out(string name)
    {
        var dir = Path.Combine(AppContext.BaseDirectory, "render");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, name);
    }

    /// <summary>Rendert <paramref name="content"/> mit Vorlage auf weißem Grund, speichert PNG, liefert Binding-Fehler.</summary>
    private static List<string> Render(object content, DataTemplate template, double width, string file, Action<FrameworkElement>? prepare = null)
    {
        var listener = new BindingErrors();
        PresentationTraceSources.Refresh();
        PresentationTraceSources.DataBindingSource.Listeners.Add(listener);
        PresentationTraceSources.DataBindingSource.Switch.Level = SourceLevels.Warning;
        try
        {
            var host = new Border
            {
                Background = Brushes.White,
                Padding = new Thickness(8),
                Child = new ContentControl { Content = content, ContentTemplate = template },
            };
            void Layout()
            {
                host.Measure(new Size(width, double.PositiveInfinity));
                host.Arrange(new Rect(host.DesiredSize));
                host.UpdateLayout();
            }
            Layout();
            prepare?.Invoke(host);
            Layout();
            var bitmap = new RenderTargetBitmap((int)Math.Ceiling(host.ActualWidth), (int)Math.Ceiling(host.ActualHeight), 96, 96, PixelFormats.Pbgra32);
            bitmap.Render(host);
            var png = new PngBitmapEncoder();
            png.Frames.Add(BitmapFrame.Create(bitmap));
            using var stream = File.Create(Out(file));
            png.Save(stream);
            return listener.Errors;
        }
        finally
        {
            PresentationTraceSources.DataBindingSource.Listeners.Remove(listener);
        }
    }

    private static IEnumerable<T> Descendants<T>(DependencyObject root) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        {
            var child = VisualTreeHelper.GetChild(root, i);
            if (child is T t) yield return t;
            foreach (var d in Descendants<T>(child)) yield return d;
        }
    }

    private static readonly DateTimeOffset T0 = new(2026, 10, 3, 21, 0, 0, TimeSpan.FromHours(-5));

    private static LiveStatus Running(bool banner, string? blocked = null) => new(
        blocked is null ? LiveState.Running : LiveState.Blocked, blocked, blocked == "lease_lost",
        "M31 – Panel 1", 10.6847, 41.2687, 32.5,
        new LiveExposure("Ha 3nm", 300, 100, 20, 1, "High Gain Mode"), T0.AddHours(3),
        [
            new LiveBlock(Guid.NewGuid(), "NGC 7000", T0, T0.AddHours(1), LiveBlockState.Done, false),
            new LiveBlock(Guid.NewGuid(), "M31 – Panel 1", T0.AddHours(1), T0.AddHours(3), LiveBlockState.Running, false),
            new LiveBlock(Guid.NewGuid(), "HAT-P-17 b", T0.AddHours(3), T0.AddHours(6), LiveBlockState.Pending, true),
        ],
        OutboxPending: 4, DeadLetters: 1, Offline: false, TestBanner: banner);

    [Fact]
    public void Eigenes_Symbol_wird_aufgeloest_und_gerendert() => Sta.Run(() =>
    {
        // NINA sucht ExportMetadata("Icon") als Ressourcenschlüssel; fehlt er, bleibt das Symbol leer.
        var resources = new NinaPmResources();
        var keys = typeof(NinaPmResources).Assembly.GetTypes()
            .SelectMany(t => t.GetCustomAttributes(typeof(System.ComponentModel.Composition.ExportMetadataAttribute), false))
            .Cast<System.ComponentModel.Composition.ExportMetadataAttribute>()
            .Where(a => a.Name == "Icon" && ((string)a.Value!).StartsWith("NinaPm", StringComparison.Ordinal))
            .Select(a => (string)a.Value!)
            .Distinct()
            .ToList();
        Assert.Equal(["NinaPmSVG"], keys);
        var geometry = Assert.IsAssignableFrom<Geometry>(resources["NinaPmSVG"]);
        Assert.Equal(new Rect(1, 1, 30, 30), geometry.Bounds);
        var template = new DataTemplate { VisualTree = new FrameworkElementFactory(typeof(System.Windows.Shapes.Path)) };
        template.VisualTree.SetValue(System.Windows.Shapes.Path.DataProperty, geometry);
        template.VisualTree.SetValue(System.Windows.Shapes.Path.FillProperty, Brushes.DimGray);
        template.VisualTree.SetValue(System.Windows.Shapes.Path.StretchProperty, Stretch.Uniform);
        template.VisualTree.SetValue(FrameworkElement.WidthProperty, 64.0);
        template.VisualTree.SetValue(FrameworkElement.HeightProperty, 64.0);
        Assert.Empty(Render(new object(), template, 80, "nina-pm-icon.png"));
    });

    [Fact]
    public void Live_Status_rendert_ohne_Binding_Fehler() => Sta.Run(() =>
    {
        var resources = new NinaPmResources();
        var template = (DataTemplate)resources["NinaPm.LiveStatus"];
        void Expand(FrameworkElement host)
        {
            foreach (var e in Descendants<Expander>(host)) e.IsExpanded = true;
        }
        var errors = Render(new LiveStatusView(Running(banner: true)), template, 640, "live-status-testbetrieb.png", Expand);
        errors.AddRange(Render(new LiveStatusView(Running(banner: false, blocked: "lease_lost")), template, 640, "live-status-gesperrt.png", Expand));
        Assert.Empty(errors);
    });

    [Fact]
    public void Optionsseite_mit_Zielbrowser_rendert_ohne_Binding_Fehler() => Sta.Run(() =>
    {
        var profile = new Mock<IProfileService> { DefaultValue = DefaultValue.Mock };
        var plugin = new NinaPmPlugin(profile.Object, new OptionsTests.PlainProtector());
        plugin.Targets.Rows.Add(new TargetRowView(new TargetRow(Guid.NewGuid(), "NGC 7000 North America", "deep_sky", 314.75, 44.33, 30, 4,
            382, 6248, 4176, 3.76, 1, 42.5, null)));
        plugin.Targets.Rows.Add(new TargetRowView(new TargetRow(Guid.NewGuid(), "HAT-P-17 b", "exoplanet", 324.5366, 30.4886, 0, 1,
            382, 6248, 4176, 3.76, 2, 0, new DateTimeOffset(2026, 10, 4, 2, 8, 0, TimeSpan.Zero))));
        var resources = new NinaPmResources();
        var errors = Render(plugin, (DataTemplate)resources["NINA-PM_Options"], 1100, "optionsseite.png");
        Assert.Empty(errors);
    });
}
