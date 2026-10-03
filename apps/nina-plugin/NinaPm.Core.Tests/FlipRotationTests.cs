using NinaPm.Core.Execution;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Grenzwert-Tabelle flip-rotation.md §3 (Toleranz 5°) und Flip-Erkennung §4.5 (AP-16f).</summary>
public sealed class FlipRotationTests
{
    [Theory]
    [InlineData(90, 270, true)]
    [InlineData(90, 95, true)]
    [InlineData(90, 95.000001, false)]
    [InlineData(2, 178, true)]
    [InlineData(0, 185, true)]
    [InlineData(359, 3, true)]
    [InlineData(0, 354.9, false)]
    [InlineData(45, 230.000001, false)]
    public void Grenzwerte_modulo_180(double target, double actual, bool ok) =>
        Assert.Equal(ok, Rotation.WithinTolerance(actual, target, 5));

    [Fact]
    public void Delta_und_Normalisierung()
    {
        Assert.Equal(5.1, Rotation.Delta180(354.9, 0), 6);
        Assert.Equal(0, Rotation.Normalize(359.9999996));
        Assert.Equal(0, Rotation.Normalize(-0.0));
        Assert.Equal(270, Rotation.Normalize(-90));
    }

    [Theory]
    [InlineData("west", "east", null, null, 0, FlipDetection.Flipped)]
    [InlineData("west", "west", null, null, 300, FlipDetection.NotFlipped)]
    [InlineData(null, null, 90.0, 270.5, 200, FlipDetection.Flipped)]
    [InlineData(null, null, 90.0, 270.5, 100, FlipDetection.Undetected)] // zu kurz für einen Flip (< 0,5 × 240 s)
    [InlineData(null, null, 90.0, 92.0, 300, FlipDetection.Undetected)]  // Pier-Seite null ohne PA-Sprung → kein flip
    [InlineData(null, null, null, null, 300, FlipDetection.Undetected)]
    [InlineData("west", null, 10.0, 185.0, 240, FlipDetection.Flipped)]
    public void Flip_Erkennung(string? before, string? after, double? paBefore, double? paAfter, double triggerS, FlipDetection expected) =>
        Assert.Equal(expected, FlipRules.Detect(before, after, paBefore, paAfter, triggerS, 240));

    [Fact]
    public void Flipdauer_ohne_Wartezeit_bis_zum_Meridian_und_Grenzen()
    {
        var s = new FlipSettings(AfterMin: 5, MaxAfterMin: 15, PauseBeforeMin: 0, DurationS: 240);
        var planned = UtcText.Parse("2026-09-18T04:33:23Z"); // tM 04:28:23 + 5 min
        Assert.Equal(UtcText.Parse("2026-09-18T04:43:23Z"), FlipRules.LimitEnd(planned, s));
        Assert.Equal(UtcText.Parse("2026-09-18T04:18:23Z"), FlipRules.LimitEnd(planned, s with { PauseBeforeMin = 10 }));
        // Trigger vor der frühesten Flipzeit gestartet: gezählt ab tM + afterMin.
        Assert.Equal(180, FlipRules.DurationS(planned.AddSeconds(180), planned.AddSeconds(-60), planned));
        Assert.Equal(200, FlipRules.DurationS(planned.AddSeconds(260), planned.AddSeconds(60), planned));
    }
}
