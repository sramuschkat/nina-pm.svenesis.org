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
/// Ein Block je Aufruf (execution.md §4.1/§4.2) mit NINA-Attrappe am regulären Block der Beispielnacht
/// (07:35–09:20:01, 17 Belichtungen à 300 s, Dither, Flip): Vorprüfungen, Warten auf den Blockstart, Zentrier-Leiter,
/// Tabelle Eintrag → Aktion, harter Blockschluss, Nachtende-Kulanz.
/// </summary>
public sealed class BlockExecutorTests
{
    private static DateTimeOffset T(string iso) => UtcText.Parse(iso);

    private static NinaPlanResponse Plan() =>
        JsonConvert.DeserializeObject<NinaPlanResponse>(ContractExamples.Json("plan.response"), NinaJson.Settings())!;

    private static Blocks Regular(Action<Blocks>? change = null)
    {
        var b = Plan().Blocks.Single(x => x.Kind == BlocksKind.Regular);
        change?.Invoke(b);
        return b;
    }

    private static (BlockExecutor Executor, FakeNina Nina, ListSink Sink, FixedClock Clock) Setup(string now, PlaybackMode mode = PlaybackMode.Sequential)
    {
        var clock = new FixedClock(T(now));
        var nina = new FakeNina(clock);
        var sink = new ListSink();
        return (new BlockExecutor(nina, clock, new NinaPmLog(sink)) { Mode = mode }, nina, sink, clock);
    }

    [Fact]
    public async Task Ganzer_Block_nach_der_Tabelle_Eintrag_Aktion()
    {
        var (executor, nina, sink, clock) = Setup("2026-09-18T07:35:00Z");
        var block = Regular();

        var outcome = await executor.RunAsync(block, T("2026-09-18T11:30:42Z"), default);

        Assert.Equal(("completed", 17), (outcome.Reason, outcome.Exposures));
        Assert.Equal(["target", "center@2026-09-18T07:35:00.000Z", "before", "guide", "filter:Ha"], nina.Calls.Take(5));
        Assert.Equal(1, nina.Calls.Count(c => c == "flip"));
        Assert.Equal(block.Entries.Count(e => e.Cmd == EntriesCmd.Dither), nina.Calls.Count(c => c == "dither"));
        Assert.Equal("after", nina.Calls[^1]);
        Assert.Contains($"I NINA-PM | BLOCK_START id={block.Id} atUtc=2026-09-18T07:36:30Z", sink.Lines);
        Assert.Contains($"I NINA-PM | BLOCK_END id={block.Id} reason=completed", sink.Lines);
        Assert.True(clock.UtcNow <= block.EndUtc);
    }

    [Fact]
    public async Task Vorbei_ohne_Belichtung_nicht_machbar()
    {
        var (e1, _, s1, _) = Setup("2026-09-18T09:20:01Z");
        Assert.Equal("elapsed", (await e1.RunAsync(Regular(), null, default)).Reason);
        Assert.Contains(s1.Lines, l => l.EndsWith("reason=elapsed", StringComparison.Ordinal) && l.Contains("BLOCK_SKIPPED"));

        var (e2, _, _, _) = Setup("2026-09-18T07:35:00Z");
        var none = Regular(b => b.Entries.RemoveAll(x => x.Cmd == EntriesCmd.Expose));
        Assert.Equal("no_exposures", (await e2.RunAsync(none, null, default)).Reason);

        var (e3, n3, _, _) = Setup("2026-09-18T07:35:00Z");
        n3.Viable = false;
        var r3 = await e3.RunAsync(Regular(), null, default);
        Assert.Equal(("not_viable", false), (r3.Reason, r3.Started));
    }

    [Fact]
    public async Task Wartet_bis_zum_Blockstart()
    {
        var (executor, nina, _, _) = Setup("2026-09-18T07:30:00Z");
        await executor.RunAsync(Regular(), null, default);
        Assert.Equal("delay:2026-09-18T07:35:00.000Z", nina.Calls[0]);
    }

    [Fact]
    public async Task Zentrier_Leiter_bis_kein_Versuch_mehr_vor_Blockende_passt()
    {
        // Blockende 07:45: Versuche 07:35, 07:36:45, 07:38:30, 07:40:30 (+30), 07:43:00 (+60) – der nächste (+120) läge danach.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.Center = _ => new CenterResult(false, "kein Solve");
        var block = Regular(b => b.EndUtc = T("2026-09-18T07:45:00Z"));

        var outcome = await executor.RunAsync(block, null, default);

        Assert.Equal("center_failed", outcome.Reason);
        Assert.Equal(5, nina.Calls.Count(c => c.StartsWith("center@", StringComparison.Ordinal)));
        Assert.Equal(["delay:2026-09-18T07:36:45.000Z", "delay:2026-09-18T07:38:30.000Z", "delay:2026-09-18T07:40:30.000Z", "delay:2026-09-18T07:43:00.000Z"],
            nina.Calls.Where(c => c.StartsWith("delay:", StringComparison.Ordinal)));
        Assert.Equal(5, sink.Lines.Count(l => l.Contains("code=center_failed")));
    }

    [Fact]
    public async Task Zentrieren_gelingt_im_dritten_Versuch()
    {
        var (executor, nina, _, _) = Setup("2026-09-18T07:35:00Z");
        nina.Center = n => new CenterResult(n >= 3);
        var outcome = await executor.RunAsync(Regular(), null, default);
        Assert.True(outcome.Started);
        Assert.Equal(3, nina.Calls.Count(c => c.StartsWith("center@", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task Slew_entfaellt_wenn_der_Adapter_es_erlaubt()
    {
        var (executor, nina, _, _) = Setup("2026-09-18T07:35:00Z");
        nina.SkipSlew = true;
        await executor.RunAsync(Regular(), null, default);
        Assert.DoesNotContain(nina.Calls, c => c.StartsWith("center@", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Abbruch_waehrend_der_Belichtung_geht_weiter_an_den_Container()
    {
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.CancelAtExposure = 2;
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => executor.RunAsync(Regular(), null, nina.Sequence.Token));
        Assert.DoesNotContain(sink.Lines, l => l.Contains("BLOCK_END"));
    }

    [Fact]
    public async Task Zeitgefuehrt_spaeter_Start_ueberspringt_verpasste_Belichtungen()
    {
        var (executor, nina, sink, _) = Setup("2026-09-18T08:20:00Z", PlaybackMode.TimeAware);
        nina.SkipSlew = true;
        var outcome = await executor.RunAsync(Regular(), null, default);
        Assert.True(outcome.SkippedTimeAware >= 6);
        Assert.True(outcome.NeedsReplan);
        Assert.Contains(sink.Lines, l => l.Contains("SKIPPED_TIMEAWARE"));
    }

    [Fact]
    public async Task Nachtende_Kulanz_Belichtung_nach_darknessEnd_beginnt_nicht()
    {
        // Letzte Belichtung der Nacht (seq 39) liegt hinter dem Blockende 09:18; Kulanz nur bis darknessEndUtc 09:19 –
        // sie endete erst 09:20:01 → beginnt nicht, block_end night_end (NT-13).
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        var block = Regular(b =>
        {
            b.EndUtc = T("2026-09-18T09:18:00Z");
            b.Entries.Single(e => e.Seq == 39).LastOfNight = true;
        });
        var outcome = await executor.RunAsync(block, T("2026-09-18T09:19:00Z"), default);
        Assert.Equal("night_end", outcome.Reason);
        Assert.Equal(16, nina.Exposures);
        Assert.DoesNotContain(nina.Calls, c => c.StartsWith("expose:39", StringComparison.Ordinal));
        Assert.Contains(sink.Lines, l => l.EndsWith("reason=night_end", StringComparison.Ordinal));

        // Mit Kulanz bis 09:25 beginnt sie.
        var (executor2, nina2, _, _) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        block.TwilightEndUtc = T("2026-09-18T09:25:00Z");
        var ok = await executor2.RunAsync(block, T("2026-09-18T09:30:00Z"), default);
        Assert.Equal(("completed", 17), (ok.Reason, nina2.Exposures));
    }

    [Fact]
    public async Task Ohne_Dunkelheitsende_gilt_das_Blockende()
    {
        var (executor, _, _, _) = Setup("2026-09-18T07:35:00Z");
        var block = Regular(b => b.TwilightEndUtc = null);
        Assert.Equal("completed", (await executor.RunAsync(block, null, default)).Reason);
    }

    [Fact]
    public async Task Wait_endet_spaetestens_beim_folgenden_Flip()
    {
        var (executor, nina, _, _) = Setup("2026-09-18T07:35:00Z");
        nina.SkipSlew = true;
        var block = Regular(b =>
        {
            // wait 07:47:43 über 20 min, Flip um 07:47:58 → Warten endet 07:47:58.
            var dither = b.Entries.First(e => e.Cmd == EntriesCmd.Dither);
            dither.Cmd = EntriesCmd.Wait;
            dither.DurationS = 1200;
        });
        await executor.RunAsync(block, null, default);
        Assert.Contains("delay:2026-09-18T07:47:58.000Z", nina.Calls);
    }
}
