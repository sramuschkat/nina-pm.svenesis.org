using System.Windows;
using Moq;
using NINA.Equipment.Interfaces.Mediator;
using NINA.Sequencer.Conditions;
using NINA.Sequencer.Container;
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

    [Theory]
    [InlineData(true, true, true)]
    [InlineData(true, false, false)]
    [InlineData(false, true, false)]
    public async Task Vor_dem_Slew_entparken_wenn_geparkt(bool connected, bool atPark, bool unparks)
    {
        // P-25-Lauf 02.10.2026: NINA übersprang Unpark Scope im Sicherungscontainer, der Slew scheiterte („parked“).
        var telescope = new Mock<ITelescopeMediator>();
        telescope.Setup(t => t.GetInfo()).Returns(new NINA.Equipment.Equipment.MyTelescope.TelescopeInfo { Connected = connected, AtPark = atPark });
        telescope.Setup(t => t.UnparkTelescope(It.IsAny<IProgress<NINA.Core.Model.ApplicationStatus>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        var warned = 0;

        var ok = await NinaHost.EnsureUnparkedAsync(telescope.Object, () => warned++, new Progress<NINA.Core.Model.ApplicationStatus>(), default);

        Assert.True(ok);
        Assert.Equal(unparks ? 1 : 0, warned);
        telescope.Verify(t => t.UnparkTelescope(It.IsAny<IProgress<NINA.Core.Model.ApplicationStatus>>(), It.IsAny<CancellationToken>()),
            unparks ? Times.Once() : Times.Never());
    }

    [Fact]
    public void Ansichten_je_Typ_und_Mini_Ansichten_je_Schluessel() => Sta.Run(() =>
    {
        var resources = new NinaPmResources();
        foreach (var type in NinaPmResources.TemplateTypes.Values)
            Assert.IsType<DataTemplate>(resources[new DataTemplateKey(type)]);
        foreach (var type in new[] { typeof(NinaPmContainer), typeof(NightLoopCondition), typeof(SafetyWaitInstruction) })
            Assert.IsType<DataTemplate>(resources[$"{type.FullName}_Mini"]);
        Assert.IsType<DataTemplate>(resources["NINA-PM_Options"]);
    });
}
