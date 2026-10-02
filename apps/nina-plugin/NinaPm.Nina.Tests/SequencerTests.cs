using System.Windows;
using Moq;
using NINA.Equipment.Interfaces.Mediator;
using NINA.Sequencer.Conditions;
using NINA.Core.Model;
using NINA.Sequencer.Container;
using NINA.Sequencer.SequenceItem;
using NINA.Sequencer.Trigger;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Nina.Adapters;
using NinaPm.Nina.Sequencer;
using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>
/// NINA-Adapter von AP-16c gegen NINA-Typen und Attrappen (execution.md §1, §4.1, §4.6): Koordinaten in Grad (NT-28),
/// Unterbrechung über <c>SafetyMonitorCondition</c> eines Vorfahren, Ansichten der Sequenz-Bausteine je Typ.
/// </summary>
[Collection(WpfCollection.Name)]
public sealed class SequencerTests
{
    [Fact]
    public void Koordinaten_in_Grad_nicht_in_Stunden()
    {
        // NT-28: raDeg = 198,069 → RA 13,2046 h (das Original rechnete mit Angle.ByHours).
        var c = NinaHost.Coordinates(new Blocks { RaDeg = 198.069, DecDeg = 56.6297 });
        Assert.Equal(13.2046, c.RA, 4);
        Assert.Equal(56.6297, c.Dec, 4);
        Assert.Equal(NINA.Astrometry.Epoch.J2000, c.Epoch);
    }

    private static (SequentialContainer Outer, SequentialContainer Inner) Nested(bool withSafety)
    {
        var outer = new SequentialContainer();
        var inner = new SequentialContainer();
        outer.Add(inner);
        if (withSafety) outer.Add(new SafetyMonitorCondition(new Mock<ISafetyMonitorMediator>().Object));
        return (outer, inner);
    }

    [Theory]
    [InlineData(true, false, true, CancelKind.Interrupt)]
    [InlineData(true, true, true, CancelKind.UserAbort)]
    [InlineData(false, false, true, CancelKind.UserAbort)]
    [InlineData(true, false, false, CancelKind.Interrupt)]
    public void Unterbrechung_nur_mit_Safety_Bedingung_am_Vorfahren_und_unsicherem_Monitor(
        bool withSafety, bool safe, bool connected, CancelKind expected)
    {
        var (_, inner) = Nested(withSafety);
        var child = new SequentialContainer();
        inner.Add(child);
        var state = new SafetyState(NinaHost.AncestorHasSafetyCondition(child), connected, safe);
        Assert.Equal(expected, Interruption.Classify(ownCancel: false, state));
    }

    [Fact]
    public void Ansichten_je_Typ_und_Mini_Ansichten_je_Schluessel() => Sta.Run(() =>
    {
        var resources = new NinaPmResources();
        foreach (var type in NinaPmResources.TemplateTypes.Values)
            Assert.IsType<DataTemplate>(resources[new DataTemplateKey(type)]);
        foreach (var type in new[] { typeof(NinaPmContainer), typeof(NightLoopCondition), typeof(SafetyWaitInstruction),
                     typeof(BeforeExposureTrigger), typeof(AfterExposureTrigger) })
            Assert.IsType<DataTemplate>(resources[$"{type.FullName}_Mini"]);
        Assert.IsType<DataTemplate>(resources["NINA-PM_Options"]);
    });

    // ---- AP-16d: Trigger-Walk und Trigger-Sets (execution.md §4.3, NT-23, FA-NIN-16) ---------------------------

    /// <summary>Zählt Ausführungen; der Typname entscheidet über die Dither-Unterdrückung.</summary>
    private class CountingTrigger : SequenceTrigger
    {
        public int Runs { get; private set; }

        public override Task Execute(ISequenceContainer context, IProgress<ApplicationStatus> progress, CancellationToken token)
        {
            Runs++;
            return Task.CompletedTask;
        }

        public override bool ShouldTrigger(ISequenceItem previousItem, ISequenceItem nextItem) => true;

        public override bool ShouldTriggerAfter(ISequenceItem previousItem, ISequenceItem nextItem) => false;

        public override object Clone() => this;
    }

    private sealed class FakeDitherAfterExposures : CountingTrigger;

    private sealed class FakeAutofocusAfterTimeTrigger : CountingTrigger;

    private static NinaPmContainer NewContainer() => new(
        new Mock<NINA.Profile.Interfaces.IProfileService> { DefaultValue = DefaultValue.Mock }.Object,
        Mock.Of<ITelescopeMediator>(), Mock.Of<IImagingMediator>(), Mock.Of<ICameraMediator>(), Mock.Of<IFilterWheelMediator>(),
        Mock.Of<IRotatorMediator>(), Mock.Of<IGuiderMediator>(), Mock.Of<IDomeMediator>(), Mock.Of<NINA.Equipment.Interfaces.IDomeFollower>(),
        Mock.Of<NINA.PlateSolving.Interfaces.IPlateSolverFactory>(), Mock.Of<NINA.Core.Utility.WindowService.IWindowServiceFactory>(),
        Mock.Of<NINA.WPF.Base.Interfaces.Mediator.IImageSaveMediator>(), Mock.Of<NINA.WPF.Base.Interfaces.ViewModel.IImageHistoryVM>(),
        Mock.Of<ISafetyMonitorMediator>(), Mock.Of<NINA.Astrometry.Interfaces.INighttimeCalculator>());

    [Fact]
    public async Task Dither_Trigger_der_Vorfahren_laufen_nie_andere_schon()
    {
        var outer = new SequentialContainer();
        var middle = new SequentialContainer();
        var box = NewContainer();
        outer.Add(middle);
        middle.Add(box);
        var dither = new FakeDitherAfterExposures();
        var af = new FakeAutofocusAfterTimeTrigger();
        outer.Add(dither); // zwei Ebenen über dem Container – der Walk geht alle Vorfahren durch
        middle.Add(af);

        await TriggerWalker.RunAsync(box, after: false, null, box, new Progress<ApplicationStatus>(), runtime: null, default);
        await TriggerWalker.RunAsync(box, after: false, null, box, new Progress<ApplicationStatus>(), runtime: null, default);

        Assert.Equal(0, dither.Runs);
        Assert.Equal(2, af.Runs);
        Assert.Contains(nameof(FakeDitherAfterExposures), box.SuppressedLogged);
    }

    [Fact]
    public void Trigger_Sets_feuern_nur_rund_um_die_Plugin_Belichtung()
    {
        var exposure = (TakeExposureItem)System.Runtime.CompilerServices.RuntimeHelpers.GetUninitializedObject(typeof(TakeExposureItem));
        var other = new PlaceholderItem();
        var before = new BeforeExposureTrigger();
        var after = new AfterExposureTrigger();

        Assert.True(before.ShouldTrigger(other, exposure));
        Assert.False(before.ShouldTrigger(exposure, other));
        Assert.False(before.ShouldTriggerAfter(exposure, other));
        Assert.True(after.ShouldTriggerAfter(exposure, other));
        Assert.False(after.ShouldTriggerAfter(other, exposure));
        Assert.False(after.ShouldTrigger(other, exposure));
    }
}
