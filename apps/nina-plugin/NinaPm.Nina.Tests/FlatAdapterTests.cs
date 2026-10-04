using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Moq;
using NINA.Core.Model.Equipment;
using NINA.Equipment.Interfaces.Mediator;
using NINA.Profile.Interfaces;
using NINA.Sequencer.Container;
using NINA.Sequencer.SequenceItem.FlatDevice;
using NINA.WPF.Base.Interfaces.Mediator;
using NINA.WPF.Base.Interfaces.ViewModel;
using NinaPm.Core.Flats;
using NinaPm.Nina.Adapters;
using NinaPm.Nina.Sequencer;
using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>Flat-Handling im Adapter (AP-50, execution.md §7): Werte in NINAs Flat-Anweisungen, Boxen am Container, Ansicht.</summary>
[Collection(WpfCollection.Name)]
public sealed class FlatAdapterTests
{
    private static IProfileService Profile() => new Mock<IProfileService> { DefaultValue = DefaultValue.Mock }.Object;

    private static TrainedFlatExposure Trained(IProfileService profile) => new(profile, Mock.Of<ICameraMediator>(), Mock.Of<IImagingMediator>(),
        Mock.Of<IImageSaveMediator>(), Mock.Of<IImageHistoryVM>(), Mock.Of<IFilterWheelMediator>(), Mock.Of<IFlatDeviceMediator>());

    private static TrainedDarkFlatExposure TrainedDark(IProfileService profile) => new(profile, Mock.Of<ICameraMediator>(), Mock.Of<IImagingMediator>(),
        Mock.Of<IImageSaveMediator>(), Mock.Of<IImageHistoryVM>(), Mock.Of<IFilterWheelMediator>(), Mock.Of<IFlatDeviceMediator>());

    [Fact]
    public void Kombination_wird_in_alle_Flat_Anweisungen_geschrieben_Dark_Flats_mit_0_uebersprungen()
    {
        var profile = Profile();
        var runner = new SequentialContainer();
        var flat = Trained(profile);
        var dark = TrainedDark(profile);
        var nested = new SequentialContainer();
        var flat2 = Trained(profile);
        nested.Add(flat2);
        runner.Add(flat);
        runner.Add(dark);
        runner.Add(nested);
        var filter = new FilterInfo("HA", 0, 4);

        NinaHost.Apply(runner, new FlatComboRun(4, 100, 10, 2, 7, 0, "M 31"), filter);

        foreach (var f in new[] { flat, flat2 })
        {
            Assert.Same(filter, f.GetSwitchFilterItem().Filter);
            Assert.Equal(100, f.GetExposureItem().Gain);
            Assert.Equal(10, f.GetExposureItem().Offset);
            Assert.Equal(2, f.GetExposureItem().Binning.X);
            Assert.Equal(7, f.GetIterations().Iterations);
        }
        Assert.Equal(0, dark.GetIterations().Iterations);
        Assert.Equal(NINA.Core.Enum.SequenceEntityStatus.SKIPPED, dark.Status);
    }

    [Fact]
    public void Gain_und_Offset_minus_1_bleiben_Kamera_Standard()
    {
        var runner = new SequentialContainer();
        var flat = Trained(Profile());
        runner.Add(flat);
        NinaHost.Apply(runner, new FlatComboRun(0, -1, -1, 1, 20, 20, "M 31"), new FilterInfo("L", 0, 0));
        Assert.Equal(-1, flat.GetExposureItem().Gain);
        Assert.Equal(-1, flat.GetExposureItem().Offset);
        Assert.Equal(20, flat.GetIterations().Iterations);
    }

    [Fact]
    public void Flat_Boxen_werden_mit_dem_Container_geklont_und_haengen_am_Klon()
    {
        var box = SequencerTestsAccess.NewContainer();
        box.FlatsRunner.Add(new SequentialContainer { Name = "je Kombination" });
        box.FlatsSetupRunner.Add(new SequentialContainer { Name = "vor" });

        var clone = (NinaPmContainer)box.Clone();

        Assert.Equal("je Kombination", Assert.Single(clone.FlatsRunner.Items).Name);
        Assert.Equal("vor", Assert.Single(clone.FlatsSetupRunner.Items).Name);
        Assert.Empty(clone.FlatsTeardownRunner.Items);
        Assert.Same(clone, clone.FlatsRunner.Parent);
        Assert.Same(box, box.FlatsRunner.Parent);
        Assert.NotSame(box.FlatsRunner, clone.FlatsRunner);
    }

    [Fact]
    public void Flat_Box_rendert_ohne_Binding_Fehler() => Sta.Run(() =>
    {
        var resources = new NinaPmResources();
        var template = (DataTemplate)resources["NinaPm.FlatBox"];
        var host = new Border
        {
            Background = Brushes.White,
            Width = 480,
            Child = new ContentControl { Content = new SequentialContainer(), ContentTemplate = template, Tag = "Vor Flats" },
        };
        // NINAs Ressourcen, die die Box nutzt (im Plugin aus NINA, hier Platzhalter).
        host.Resources["BorderBrush"] = Brushes.Gray;
        host.Resources["BackgroundBrush"] = Brushes.White;
        host.Resources["InverseZeroToVisibilityConverter"] = new ZeroToVisible();
        host.Measure(new Size(480, double.PositiveInfinity));
        host.Arrange(new Rect(host.DesiredSize));
        host.UpdateLayout();
        Assert.True(host.ActualHeight > 30);
    });

    private sealed class ZeroToVisible : System.Windows.Data.IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, System.Globalization.CultureInfo culture) =>
            value is 0 ? Visibility.Visible : Visibility.Collapsed;

        public object ConvertBack(object value, Type targetType, object parameter, System.Globalization.CultureInfo culture) =>
            throw new NotSupportedException();
    }
}
