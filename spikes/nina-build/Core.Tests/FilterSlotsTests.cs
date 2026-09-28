using NinaBuild.Core;
using Xunit;

namespace NinaBuild.Core.Tests;

public class FilterSlotsTests
{
    [Theory]
    [InlineData(0, 1)]
    [InlineData(6, 7)]
    public void RoundTrip(int nina, int slot)
    {
        Assert.Equal(slot, FilterSlots.FromNina(nina));
        Assert.Equal(nina, FilterSlots.ToNina(slot));
    }
}
