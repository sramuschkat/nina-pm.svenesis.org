using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Trigger im Transit (execution.md §5, AP-44, NT-23): Tabellentest über die Typnamen der NINA-Kerntrigger.</summary>
public sealed class TriggerPolicyTests
{
    private static readonly TransitTriggerContext Strict = new(false, false);
    private static readonly TransitTriggerContext Lenient = new(true, true);

    [Theory]
    // Typname,                                regulär, Transit streng, Transit erlaubt
    [InlineData("DitherAfterExposures", true, true, true)]
    [InlineData("SomePluginDitherTrigger", true, true, true)]
    [InlineData("AutofocusAfterTimeTrigger", false, true, false)]
    [InlineData("AutofocusAfterExposures", false, true, false)]
    [InlineData("AutofocusAfterHFRIncreaseTrigger", false, true, false)]
    [InlineData("AutofocusAfterTemperatureChangeTrigger", false, true, false)]
    [InlineData("AutofocusAfterFilterChange", false, true, false)]
    [InlineData("CenterAfterDriftTrigger", false, true, false)]
    [InlineData("MeridianFlipTrigger", false, false, false)]
    [InlineData("BeforeExposureTrigger", false, false, false)]
    public void Unterdrueckt_je_Lage(string type, bool regular, bool strict, bool lenient)
    {
        Assert.Equal(regular, TriggerPolicy.Suppressed(type, null));
        Assert.Equal(strict, TriggerPolicy.Suppressed(type, Strict));
        Assert.Equal(lenient, TriggerPolicy.Suppressed(type, Lenient));
    }

    [Fact]
    public void Trigger_Set_mit_Autofokus_nur_im_Transit_ohne_Erlaubnis_uebersprungen()
    {
        string[] withAf = ["CoolCamera", "RunAutofocus"];
        Assert.True(TriggerPolicy.SuppressedBox(withAf, Strict));
        Assert.False(TriggerPolicy.SuppressedBox(withAf, Lenient));
        Assert.False(TriggerPolicy.SuppressedBox(withAf, null));
        Assert.False(TriggerPolicy.SuppressedBox(["CoolCamera"], Strict));
    }

    [Fact]
    public void Kontext_aus_der_Beobachtung_ohne_Beobachtung_streng()
    {
        var project = Guid.NewGuid();
        var transit = new Blocks { Kind = BlocksKind.Transit, ProjectId = project };
        var targets = new NinaTargets
        {
            Projects =
            [
                new Projects
                {
                    Id = project,
                    Exoplanet = new Exoplanet { Observation = new Observation { AllowAutofocus = true, AllowRecenter = false } },
                },
            ],
        };
        Assert.Equal(new TransitTriggerContext(true, false), TriggerPolicy.ForBlock(transit, targets));
        Assert.Equal(Strict, TriggerPolicy.ForBlock(transit, null));
        Assert.Null(TriggerPolicy.ForBlock(new Blocks { Kind = BlocksKind.Regular, ProjectId = project }, targets));
    }
}
