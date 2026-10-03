using NinaPm.Core.Execution;
using Xunit;

namespace NinaPm.Core.Tests;

public sealed class FrameNumbersTests
{
    [Fact]
    public void Zaehlt_je_Ziel_und_Filter_ab_0_wie_NINA()
    {
        var frames = new FrameNumbers();
        Assert.Equal(0, frames.Peek("Sh2-132", "RED"));
        frames.Advance("Sh2-132", "RED");
        frames.Advance("Sh2-132", "RED");
        Assert.Equal(2, frames.Peek("Sh2-132", "RED"));
        Assert.Equal(0, frames.Peek("Sh2-132", "GREEN"));
        Assert.Equal(0, frames.Peek("M 31", "RED"));
        frames.Advance("M 31", null); // ohne Filterrad
        Assert.Equal(1, frames.Peek("M 31", null));
    }
}
