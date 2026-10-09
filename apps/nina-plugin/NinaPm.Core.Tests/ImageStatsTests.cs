using NinaPm.Core.Execution;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Bildstatistik je Aufnahme (AP-71).</summary>
public class ImageStatsTests
{
    [Theory]
    [InlineData(65535, 1200, 16, 1_000_000, 0.12)]
    [InlineData(65000, 1200, 16, 1_000_000, 0.0)] // Maximum unter dem Vollausschlag: nichts gesättigt
    [InlineData(4095, 10, 12, 1000, 1.0)]
    [InlineData(65535, 1200, 16, 0, null)] // ohne Pixelzahl
    [InlineData(65535, 1200, 4, 1000, null)] // unplausible Bittiefe
    public void Saettigung(double max, long occ, int bitDepth, long pixels, double? expected) =>
        Assert.Equal(expected, ImageStats.SaturatedPct(max, occ, bitDepth, pixels));
}
