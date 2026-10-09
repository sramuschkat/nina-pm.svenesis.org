using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Logging;
using NinaPm.Core.Planning;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// AP-71 „Block passt noch“ – derselbe Plan wie der Engine-Test <c>packages/engine/test/block-fits.spec.ts</c>
/// (<c>plan.response.tight</c>): Die Engine legt <c>endUtc</c> auf das Ende der letzten Belichtung, der nächste Block rückt
/// direkt dahinter. Rig-Nacht 08./09.10.2026: 0,7 s Startverzug → <c>BLOCK_SKIPPED elapsed</c>. Bis 60 s Verzug
/// (<see cref="Playback.LateGraceMax"/>) läuft der Block jetzt; darüber gilt er weiter als vorbei.
/// </summary>
public sealed class BlockFitsTests
{
    private static DateTimeOffset T(string iso) => UtcText.Parse(iso);

    private static readonly NinaPlanResponse Plan =
        JsonConvert.DeserializeObject<NinaPlanResponse>(ContractExamples.Json("plan.response.tight"), NinaJson.Settings())!;

    private static async Task<(BlockOutcome Outcome, ListSink Sink)> RunLate(int index, double lateS)
    {
        var block = Plan.Blocks[index];
        var clock = new FixedClock(block.StartUtc.AddSeconds(lateS));
        var nina = new FakeNina(clock) { DownloadS = 5 };
        var sink = new ListSink();
        var executor = new BlockExecutor(nina, clock, new NinaPmLog(sink)) { Mode = PlaybackMode.TimeAware };
        DateTimeOffset? next = index + 1 < Plan.Blocks.Count ? Plan.Blocks[index + 1].StartUtc : null;
        var soft = Playback.SoftEnd(block, next, Plan.DarknessEndUtc);
        var outcome = await executor.RunAsync(block, Plan.DarknessEndUtc, default, new BlockRunOptions(DownloadS: 5, SoftEndUtc: soft));
        return (outcome, sink);
    }

    [Fact]
    public void Kein_Spiel_im_Plan_der_Engine()
    {
        Assert.Equal(Plan.Blocks[0].EndUtc, Plan.Blocks[1].StartUtc);
        Assert.Equal(Plan.Blocks[1].EndUtc, Plan.Blocks[2].StartUtc);
        Assert.Equal(Plan.Blocks[1].EndUtc, Playback.SoftEnd(Plan.Blocks[1], Plan.Blocks[2].StartUtc, Plan.DarknessEndUtc));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(0.7)] // Rig-Nacht 08./09.10.2026
    [InlineData(45)]
    [InlineData(60)]
    public async Task Einzige_Belichtung_laeuft_trotz_Verzug_bis_60_s(double lateS)
    {
        var (outcome, sink) = await RunLate(1, lateS);
        Assert.Equal((true, "completed", 1), (outcome.Started, outcome.Reason, outcome.Exposures));
        Assert.DoesNotContain(sink.Lines, l => l.Contains("BLOCK_SKIPPED"));
    }

    [Fact]
    public async Task Ueber_60_s_Verzug_gilt_der_Block_als_vorbei()
    {
        var (outcome, sink) = await RunLate(1, 75);
        Assert.Equal((false, "elapsed"), (outcome.Started, outcome.Reason));
        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_SKIPPED") && l.Contains("reason=elapsed"));
    }

    [Fact]
    public async Task Letzte_Belichtung_eines_Blocks_mit_Startverzug_bleibt()
    {
        // Block A (2 Belichtungen) beginnt 20 s zu spät: vorher entfiel die zweite (kein Spiel bis Block B).
        var (outcome, _) = await RunLate(0, 20);
        Assert.Equal(("completed", 2), (outcome.Reason, outcome.Exposures));
    }
}
