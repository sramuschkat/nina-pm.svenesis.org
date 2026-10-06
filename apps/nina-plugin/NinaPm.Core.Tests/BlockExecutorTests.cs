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
    public async Task Zeitgefuehrt_schneller_als_geplant_wartet_mit_WAIT_PLAN_im_Log()
    {
        // Wie im VM-Lauf 05.10.2026: der Plan reserviert vor der ersten Belichtung Zeit (z. B. Autofokus), NINA nutzt sie
        // nicht – das Plugin wartet bis zum geplanten Zeitpunkt und schreibt das ins Log.
        var (executor, _, sink, _) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        var block = Regular(b =>
        {
            foreach (var e in b.Entries.Skip(1)) e.AtUtc = e.AtUtc.AddMinutes(4);
        });
        var firstExpose = block.Entries.First(e => e.Cmd == EntriesCmd.Expose).AtUtc;

        var outcome = await executor.RunAsync(block, T("2026-09-18T11:30:42Z"), default);

        Assert.Equal("completed", outcome.Reason);
        var wait = Assert.Single(sink.Lines, l => l.Contains("WAIT_PLAN") && l.Contains($"untilUtc={firstExpose:yyyy-MM-ddTHH:mm:ss}Z"));
        Assert.Contains($"block={block.Id}", wait);
        Assert.Matches(@"durationS=\d{3}", wait);
    }

    [Fact]
    public async Task WAIT_PLAN_Zuruecksetzen_waehrend_der_Wartezeit_beendet_den_Block_sofort()
    {
        // Analyse 05.10.2026: vorher wirkte Zurücksetzen erst nach der Wartezeit (bis zu Slew + Autofokus des Plans).
        var (executor, nina, _, clock) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        var block = Regular(b =>
        {
            foreach (var e in b.Entries.Skip(1)) e.AtUtc = e.AtUtc.AddMinutes(4);
        });
        var firstExpose = block.Entries.First(e => e.Cmd == EntriesCmd.Expose).AtUtc;
        var reset = false;
        nina.OnDelay = _ => reset = true;

        var outcome = await executor.RunAsync(block, T("2026-09-18T11:30:42Z"), default,
            new BlockRunOptions(StopReason: () => reset ? "replanned" : null, Mode: PlaybackMode.TimeAware));

        Assert.Equal(("replanned", 0), (outcome.Reason, outcome.Exposures));
        Assert.True(clock.UtcNow < firstExpose, clock.UtcNow.ToString("O"));
    }

    [Fact]
    public async Task WAIT_PLAN_neue_Ziele_werden_sofort_geprueft_ein_festgelegter_Transit_beendet_den_Block()
    {
        var (executor, nina, _, clock) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        var block = Regular(b =>
        {
            foreach (var e in b.Entries.Skip(1)) e.AtUtc = e.AtUtc.AddMinutes(4);
        });
        var firstExpose = block.Entries.First(e => e.Cmd == EntriesCmd.Expose).AtUtc;
        var changed = false;
        var checks = 0;
        nina.OnDelay = _ => changed = true;

        var outcome = await executor.RunAsync(block, T("2026-09-18T11:30:42Z"), default, new BlockRunOptions(
            InBlockCheck: (_, _) =>
            {
                checks++;
                changed = false;
                return Task.FromResult<string?>("transit_interrupt");
            },
            TargetsChanged: () => changed,
            Mode: PlaybackMode.TimeAware));

        Assert.Equal(("transit_interrupt", 0, 1), (outcome.Reason, outcome.Exposures, checks));
        Assert.True(clock.UtcNow < firstExpose, clock.UtcNow.ToString("O"));
    }

    [Fact]
    public async Task WAIT_PLAN_bleibt_das_Signal_nach_gescheitertem_Abruf_wird_hoechstens_einmal_je_Minute_geprueft()
    {
        var (executor, _, _, clock) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        var block = Regular(b =>
        {
            foreach (var e in b.Entries.Skip(1)) e.AtUtc = e.AtUtc.AddMinutes(4);
        });
        var firstExpose = block.Entries.First(e => e.Cmd == EntriesCmd.Expose).AtUtc;
        var checks = new List<DateTimeOffset>();

        var outcome = await executor.RunAsync(block, T("2026-09-18T11:30:42Z"), default, new BlockRunOptions(
            InBlockCheck: (_, _) =>
            {
                if (clock.UtcNow < firstExpose) checks.Add(clock.UtcNow);
                return Task.FromResult<string?>(null);
            },
            TargetsChanged: () => true,
            Mode: PlaybackMode.TimeAware));

        Assert.Equal("completed", outcome.Reason);
        // Wartezeit vor der ersten Belichtung: sofort eine Prüfung, danach höchstens eine je Minute – kein Dauerabruf.
        Assert.NotEmpty(checks);
        Assert.All(checks.Zip(checks.Skip(1)), p => Assert.True(p.Second - p.First >= BlockExecutor.WaitRecheck));
    }

    [Fact]
    public async Task Laufende_Belichtung_endet_auch_wenn_waehrend_ihr_ein_Transit_festgelegt_wird()
    {
        // Spec-Ergänzung 04.10.2026 (§5): kein Abbruch; die Belichtung wird gespeichert, danach endet der Block.
        var (executor, nina, _, clock) = Setup("2026-09-18T07:35:00Z");
        DateTimeOffset? deadline = null;
        nina.OnExposure = n =>
        {
            if (n == 2) deadline = clock.UtcNow.AddSeconds(60);
        };

        var outcome = await executor.RunAsync(Regular(), null, default, new BlockRunOptions(TransitDeadline: () => deadline));

        Assert.Equal(("transit_interrupt", 2), (outcome.Reason, outcome.Exposures));
        Assert.False(nina.Sequence.IsCancellationRequested);
    }

    private static Blocks Transit(Action<Blocks>? change = null)
    {
        var b = Plan().Blocks.Single(x => x.Kind == BlocksKind.Transit);
        change?.Invoke(b);
        return b;
    }

    [Fact]
    public async Task Transitserie_vom_Vorlauf_bis_untilUtc_Filter_einmal_kein_Dither()
    {
        // Beispielnacht HAT-P-17 b: Vorlauf 02:05:30, Serie 02:08:00–07:34:00, 60 s + 3 s → 310 Aufnahmen ohne Flip.
        var (executor, nina, sink, clock) = Setup("2026-09-18T02:00:00Z");
        var block = Transit();
        var outcome = await executor.RunAsync(block, null, default);

        Assert.Equal(("completed", 310), (outcome.Reason, outcome.Exposures));
        Assert.Equal("center@2026-09-18T02:05:30.000Z", nina.Calls.First(c => c.StartsWith("center@", StringComparison.Ordinal)));
        Assert.Single(nina.Calls, c => c.StartsWith("filter:", StringComparison.Ordinal));
        Assert.DoesNotContain("dither", nina.Calls);
        Assert.Equal("expose:2@2026-09-18T02:08:00.000Z", nina.Calls.First(c => c.StartsWith("expose:", StringComparison.Ordinal)));
        Assert.True(clock.UtcNow <= block.EndUtc);
        Assert.Contains(sink.Lines, l => l.Contains($"TRANSIT_START id={block.Id}"));
        Assert.Contains(sink.Lines, l => l.EndsWith($"TRANSIT_END id={block.Id}", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Transitserie_NINA_flippt_im_Fenster_zentrieren_ohne_Rotation_Serie_bis_Fensterende()
    {
        // NT-25: kein Flip-Eintrag; NINAs Trigger flippt während der Serie, danach Center (nie CenterAndRotate), weiter.
        var (executor, nina, sink, clock) = Setup("2026-09-18T02:00:00Z");
        nina.Pier = "west";
        nina.FlipDuringExposure = 140;
        var block = Transit();
        var outcome = await executor.RunAsync(block, null, default);

        Assert.Equal("completed", outcome.Reason);
        Assert.Contains(sink.Lines, l => l.Contains($"FLIP id={block.Id} pierBefore=west pierAfter=east"));
        Assert.Contains("center-no-rotate", nina.Calls);
        Assert.True(outcome.Exposures is > 140 and < 310, outcome.Exposures.ToString());
        Assert.True(clock.UtcNow <= block.EndUtc);
    }

    [Fact]
    public async Task Vorlauf_eines_Transits_Belichtung_beginnt_nur_wenn_sie_vorher_endet()
    {
        // §5: Frist = Fensterbeginn − slewCenterS − 60 s; die 300-s-Belichtung um 07:40 würde 07:45:03 enden → Blockende.
        var (executor, nina, _, _) = Setup("2026-09-18T07:35:00Z");
        var deadline = T("2026-09-18T07:45:00Z");
        var outcome = await executor.RunAsync(Regular(), null, default, new BlockRunOptions(TransitDeadline: () => deadline));
        Assert.Equal("transit_interrupt", outcome.Reason);
        Assert.All(nina.Calls.Where(c => c.StartsWith("expose:", StringComparison.Ordinal)),
            c => Assert.True(T(c[(c.IndexOf('@') + 1)..]).AddSeconds(303) <= deadline, c));
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
    public async Task Ohne_gefundenen_Filter_Block_ueberspringen_statt_leer_absitzen()
    {
        // §4.1 Nr. 1 (P-05 prod 03.10.2026): keine Belichtungszeile mit bestätigtem, im Profil gefundenem Filter →
        // BLOCK_SKIPPED filter_not_found, kein Slew, die Zeit gehört dem nächsten Block.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.Unexposable = "filter_not_found";
        var block = Regular();
        var r = await executor.RunAsync(block, null, default);
        Assert.Equal(("filter_not_found", false), (r.Reason, r.Started));
        Assert.DoesNotContain(nina.Calls, c => c.StartsWith("center", StringComparison.Ordinal));
        Assert.Contains(sink.Lines, l => l.Contains($"BLOCK_SKIPPED id={block.Id}") && l.EndsWith("reason=filter_not_found", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Neues_targets_ETag_im_Heartbeat_prueft_sofort_statt_nach_15_min()
    {
        // Eine im Web bestätigte Filterzuordnung soll nicht bis zur 15-min-Prüfung warten (P-05 prod 03.10.2026).
        var (executor, _, _, clock) = Setup("2026-09-18T07:35:00Z");
        var checks = new List<DateTimeOffset>();
        var changed = true;
        var options = new BlockRunOptions(
            InBlockCheck: (_, _) =>
            {
                checks.Add(clock.UtcNow);
                changed = false;
                return Task.FromResult<string?>(null);
            },
            TargetsChanged: () => changed);
        await executor.RunAsync(Regular(), null, default, options);
        // Sofort vor der ersten Belichtung (nach dem Zentrieren), danach wieder im 15-min-Takt.
        Assert.True(checks[0] < T("2026-09-18T07:40:00Z"), checks[0].ToString("O"));
        Assert.True(checks.Count > 1);
        Assert.All(checks.Zip(checks.Skip(1)), p => Assert.True(p.Second - p.First >= TimeSpan.FromMinutes(15)));
    }

    [Fact]
    public async Task Wartet_bis_zum_Blockstart()
    {
        var (executor, nina, _, _) = Setup("2026-09-18T07:30:00Z");
        await executor.RunAsync(Regular(), null, default);
        // Im 10-s-Takt (abbrechbar durch *Block überspringen*), der letzte Takt endet genau am Blockstart.
        var delays = nina.Calls.TakeWhile(c => c.StartsWith("delay:", StringComparison.Ordinal)).ToList();
        Assert.Equal("delay:2026-09-18T07:30:10.000Z", delays[0]);
        Assert.Equal("delay:2026-09-18T07:35:00.000Z", delays[^1]);
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

    /// <summary>
    /// Brief AP-16f: Filterverhältnisse bleiben nach 6 min Verzögerung erhalten – der Startverzug geht in den Verzug ein
    /// (§4.2, NT-21), die Planuhr rutscht nach hinten, statt Belichtungen zu verwerfen; nur das Blockende schneidet ab.
    /// </summary>
    [Fact]
    public async Task Zeitgefuehrt_Startverzug_verschiebt_die_Planuhr_Filterfolge_bleibt()
    {
        var (executor, nina, sink, _) = Setup("2026-09-18T07:41:00Z", PlaybackMode.TimeAware); // 6 min nach Planstart
        nina.SkipSlew = true;
        var block = Regular();
        var outcome = await executor.RunAsync(block, null, default);

        Assert.Equal(0, outcome.SkippedTimeAware);
        Assert.DoesNotContain(sink.Lines, l => l.Contains("SKIPPED_TIMEAWARE"));
        var planned = block.Entries.Where(e => e.Cmd == EntriesCmd.Expose).Select(e => e.Seq).ToList();
        var done = nina.Calls.Where(c => c.StartsWith("expose:", StringComparison.Ordinal))
            .Select(c => int.Parse(c[7..c.IndexOf('@')], System.Globalization.CultureInfo.InvariantCulture)).ToList();
        Assert.Equal(planned.Take(done.Count), done); // Präfix des Plans in Planreihenfolge
    }

    /// <summary>
    /// Rig-Nacht 06.10.2026: Neuplanung ab jetzt (10:36:45) mit genau einer SII-Belichtung à 600 s. Der Plan rechnet
    /// 35 s Slew/Zentrieren und 1 s Download, das Blockende ist das Ende dieser Belichtung (10:47:31).
    /// </summary>
    private static Blocks SingleExposure()
    {
        var b = Regular();
        var slew = b.Entries.Single(e => e.Seq == 1);
        var filter = b.Entries.Single(e => e.Seq == 3);
        var expose = b.Entries.Single(e => e.Seq == 4);
        var end = b.Entries.Single(e => e.Cmd == EntriesCmd.End);
        slew.AtUtc = T("2026-10-06T10:36:45Z");
        slew.DurationS = 35;
        filter.AtUtc = T("2026-10-06T10:37:20Z");
        expose.AtUtc = T("2026-10-06T10:37:30Z");
        expose.ExposureS = 600;
        end.AtUtc = T("2026-10-06T10:47:31Z");
        b.Entries = [slew, filter, expose, end];
        b.StartUtc = slew.AtUtc;
        b.EndUtc = end.AtUtc;
        b.MeridianFlip = null;
        b.TwilightEndUtc = null;
        return b;
    }

    [Fact]
    public async Task Download_Zeit_des_Rigs_statt_fester_3_s_puenktlich_passt_die_Belichtung()
    {
        var block = SingleExposure();
        var (executor, nina, _, _) = Setup("2026-10-06T10:36:45Z", PlaybackMode.TimeAware);
        nina.SkipSlew = true;
        var fixedDownload = await executor.RunAsync(block, T("2026-10-06T11:15:00Z"), default);
        Assert.Equal(("completed", 0), (fixedDownload.Reason, fixedDownload.Exposures)); // 10:37:30 + 603 s > 10:47:31

        (executor, nina, _, _) = Setup("2026-10-06T10:36:45Z", PlaybackMode.TimeAware);
        nina.SkipSlew = true;
        var rigDownload = await executor.RunAsync(SingleExposure(), T("2026-10-06T11:15:00Z"), default, new BlockRunOptions(DownloadS: 1));
        Assert.Equal(("completed", 1), (rigDownload.Reason, rigDownload.Exposures));
    }

    [Fact]
    public async Task Weiches_Blockende_verspaetete_einzige_Belichtung_laeuft_wenn_danach_frei_ist()
    {
        // Zentrieren dauert 90 s statt der geplanten 35 s: ohne weiches Blockende endete der Block leer (Log 05:37–05:52 CDT).
        var (executor, _, sink, _) = Setup("2026-10-06T10:36:45Z", PlaybackMode.TimeAware);
        var hard = await executor.RunAsync(SingleExposure(), T("2026-10-06T11:15:00Z"), default, new BlockRunOptions(DownloadS: 1));
        Assert.Equal(("completed", 0), (hard.Reason, hard.Exposures));

        var block = SingleExposure();
        (executor, _, sink, var clock) = Setup("2026-10-06T10:36:45Z", PlaybackMode.TimeAware);
        var soft = Playback.SoftEnd(block, nextBlockStartUtc: null, darknessEndUtc: T("2026-10-06T11:15:00Z"));
        var outcome = await executor.RunAsync(block, T("2026-10-06T11:15:00Z"), default, new BlockRunOptions(DownloadS: 1, SoftEndUtc: soft));
        Assert.Equal(("completed", 1), (outcome.Reason, outcome.Exposures));
        Assert.True(clock.UtcNow > block.EndUtc && clock.UtcNow <= soft);
        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_END") && l.Contains("reason=completed"));
    }

    [Fact]
    public async Task Weiches_Blockende_reicht_nicht_dann_kein_Slew()
    {
        // Folgeblock beginnt direkt nach dem Blockende: schon vor dem Slew passt nichts mehr → elapsed ohne Zentrieren.
        var block = SingleExposure();
        var (executor, nina, sink, _) = Setup("2026-10-06T10:38:00Z", PlaybackMode.TimeAware);
        var soft = Playback.SoftEnd(block, T("2026-10-06T10:47:31Z"), T("2026-10-06T11:15:00Z"));
        var outcome = await executor.RunAsync(block, null, default, new BlockRunOptions(DownloadS: 1, SoftEndUtc: soft));
        Assert.Equal(("elapsed", false), (outcome.Reason, outcome.Started));
        Assert.DoesNotContain(nina.Calls, c => c.StartsWith("center", StringComparison.Ordinal));
        Assert.Contains($"I NINA-PM | BLOCK_SKIPPED id={block.Id} reason=elapsed", sink.Lines);
    }

    // ---- Flip und Rotation (AP-16f, execution.md §4.2/§4.5, flip-rotation.md §3) ---------------------------------

    [Fact]
    public async Task Flip_wartet_auf_NINAs_frueheste_Flipzeit_danach_nur_Zentrieren()
    {
        var (executor, nina, sink, clock) = Setup("2026-09-18T07:35:00Z");
        var block = Regular();
        var flipEntry = block.Entries.Single(e => e.Cmd == EntriesCmd.Meridian_flip);
        nina.Pier = "west";
        nina.FlipOnTriggers = true;
        nina.EarliestFlipUtc = flipEntry.AtUtc.AddSeconds(20); // Montierung 20 s später als die Engine
        var flips = 0;
        var options = new BlockRunOptions(Flip: new FlipSettings(5, 15, 0, 240), Rotation: new RotationSettings(5, false), FlipDone: _ => flips++);

        await executor.RunAsync(block, null, default, options);

        var trigger = nina.Calls.FindIndex(c => c == "flip");
        Assert.True(trigger > 0);
        var delays = nina.Calls.Take(trigger).Where(c => c.StartsWith("delay:", StringComparison.Ordinal)).ToList();
        Assert.Contains(delays, d => string.CompareOrdinal(d[6..], UtcText.Format(flipEntry.AtUtc.AddSeconds(20))) >= 0);
        Assert.Contains(sink.Lines, l => l.Contains("FLIP id=") && l.Contains("pierBefore=west pierAfter=east"));
        Assert.Equal(1, flips);
        // Nach dem Flip Center ohne Rotation, danach keine Rotation mehr; Winkel mit eigenem Solve geprüft.
        Assert.Contains("center-no-rotate", nina.Calls.Skip(trigger));
        Assert.Equal(1, nina.Calls.Count(c => c == "flip"));
    }

    [Fact]
    public async Task Ungeplanter_Flip_vor_einer_Belichtung_zentriert_und_erledigt_den_Plan_Flip()
    {
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.Pier = "west";
        nina.FlipDuringExposure = 1; // NINAs Trigger flippt schon vor der ersten Belichtung (±1 Belichtung)

        await executor.RunAsync(Regular(), null, default, new BlockRunOptions(Flip: new FlipSettings(5, 15, 0, 240)));

        Assert.Contains(sink.Lines, l => l.Contains("FLIP id=") && l.Contains("pierBefore=west pierAfter=east"));
        Assert.Contains("center-no-rotate", nina.Calls);
        Assert.DoesNotContain("flip", nina.Calls); // Plan-Flip erledigt, kein zweiter Trigger-Aufruf
    }

    [Fact]
    public async Task Pier_Seite_unbekannt_ohne_PA_Sprung_meldet_flip_undetected()
    {
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.Solves.Add(new SolveReading(90));
        var flips = 0;
        await executor.RunAsync(Regular(), null, default, new BlockRunOptions(Flip: new FlipSettings(5, 15, 0, 240), FlipDone: _ => flips++));

        Assert.Contains(sink.Lines, l => l.Contains("FLIP_UNDETECTED"));
        Assert.DoesNotContain(sink.Lines, l => l.Contains("NINA-PM | FLIP id="));
        Assert.Equal(0, flips);
    }

    [Theory]
    [InlineData(false, "rotation_mismatch")]
    [InlineData(true, null)]
    public async Task Ohne_Rotator_Winkel_30_Grad_daneben(bool rotatorConnected, string? skipReason)
    {
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.RotatorConnected = rotatorConnected;
        var block = Regular();
        nina.Solves.Add(new SolveReading(block.RotationDeg + 30));

        var outcome = await executor.RunAsync(block, null, default, new BlockRunOptions(Rotation: new RotationSettings(5, SkipOnMismatch: true)));

        if (skipReason is null)
        {
            // Mit Rotator prüft NINAs CenterAndRotate am Blockbeginn selbst – kein eigener Solve vor dem Blockstart
            // (nach dem Flip im Block prüft das Plugin dagegen immer selbst, §4.5).
            Assert.True(outcome.Started);
            Assert.DoesNotContain("solve", nina.Calls.TakeWhile(c => c != "before"));
        }
        else
        {
            Assert.Equal((false, skipReason), (outcome.Started, outcome.Reason));
            Assert.Contains(sink.Lines, l => l.Contains("ROTATION_MISMATCH"));
        }
    }

    [Theory]
    [InlineData(false, false, false)] // Rig ohne Rotator (Starfront): keine Prüfung, kein Solve, kein Hinweis
    [InlineData(false, true, true)] // ohne Rotator, aber „Bei Abweichung überspringen“: Prüfung bleibt
    [InlineData(true, false, true)] // Rotator im Rig (auch wenn nicht verbunden): Prüfung bleibt
    public async Task Winkelpruefung_ohne_Rotator_nur_mit_Ueberspringen(bool rotatorPresent, bool skipOnMismatch, bool checks)
    {
        // Rig-Nacht 06.10.2026: vor jedem Block ROTATION_MISMATCH (136° gemessen, 0° erwartet), obwohl kein Rotator da ist.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.RotatorConnected = false;
        var block = Regular();
        nina.Solves.Add(new SolveReading(block.RotationDeg + 46));

        var outcome = await executor.RunAsync(block, null, default,
            new BlockRunOptions(Rotation: RotationSettings.For(rotatorPresent, 5, skipOnMismatch)));

        Assert.Equal(checks, sink.Lines.Any(l => l.Contains("ROTATION_MISMATCH")));
        Assert.Equal(checks, nina.Calls.TakeWhile(c => c != "before").Contains("solve"));
        Assert.Equal(!(checks && skipOnMismatch), outcome.Started);
    }

    [Fact]
    public async Task Winkelabweichung_bleibt_fuer_das_Ziel_gemerkt_wenn_das_Zentrieren_entfaellt()
    {
        // Sim-Lauf P-08: derselbe Block kommt im nächsten Plan wieder; ohne Zentrieren entfiele die Winkelprüfung.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.RotatorConnected = false;
        var block = Regular();
        nina.Solves.Add(new SolveReading(block.RotationDeg + 30));
        var options = new BlockRunOptions(Rotation: new RotationSettings(5, SkipOnMismatch: true));
        Assert.Equal("rotation_mismatch", (await executor.RunAsync(block, null, default, options)).Reason);

        nina.SkipSlew = true;
        var again = await executor.RunAsync(Regular(), null, default, options);
        Assert.Equal((false, "rotation_mismatch"), (again.Started, again.Reason));
    }

    [Fact]
    public async Task Winkel_modulo_180_ok_kein_Solve_rotation_unknown_gespiegelt_optics_mirrored()
    {
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.RotatorConnected = false;
        var block = Regular();
        nina.Solves.Add(new SolveReading(block.RotationDeg + 180.5));
        var ok = await executor.RunAsync(block, null, default, new BlockRunOptions(Rotation: new RotationSettings(5, true)));
        Assert.True(ok.Started);
        Assert.DoesNotContain(sink.Lines, l => l.Contains("ROTATION_"));

        var (e2, n2, s2, _) = Setup("2026-09-18T07:35:00Z");
        n2.RotatorConnected = false;
        await e2.RunAsync(Regular(), null, default, new BlockRunOptions(Rotation: new RotationSettings(5, true)));
        Assert.Contains(s2.Lines, l => l.Contains("ROTATION_UNKNOWN"));

        var (e3, n3, s3, _) = Setup("2026-09-18T07:35:00Z");
        n3.RotatorConnected = false;
        n3.Solves.Add(new SolveReading(10, Mirrored: true));
        var r3 = await e3.RunAsync(Regular(), null, default, new BlockRunOptions(Rotation: new RotationSettings(5, true)));
        Assert.True(r3.Started);
        Assert.Contains(s3.Lines, l => l.Contains("WARNING code=optics_mirrored"));
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

    // ---- Kühlung nur warnen (AP-16e, NT-E2) ----------------------------------------------------------------

    [Fact]
    public async Task Kuehlung_abweichend_genau_eine_Warnung_je_Block_alle_Aufnahmen_markiert()
    {
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.Cooling = new CameraCooling(true, -6.0); // Soll −10 °C, Toleranz 1 °C
        var warnings = 0;

        var outcome = await executor.RunAsync(Regular(), T("2026-09-18T11:30:42Z"), default,
            new BlockRunOptions(Cooling: new CoolingTarget(-10, 1), TemperatureWarning: _ => warnings++));

        Assert.Equal(17, outcome.Exposures); // weiter belichten
        Assert.All(nina.Deviations, Assert.True);
        Assert.Equal(1, warnings);
        Assert.Single(sink.Lines, l => l.Contains("WARNING code=camera_temperature"));
    }

    [Theory]
    [InlineData(true, -10.6, false)]
    [InlineData(true, null, false)] // ohne Messwert keine Abweichung
    [InlineData(false, -10.0, true)] // Kühler aus
    public async Task Kuehlung_in_Toleranz_bzw_Kuehler_aus(bool coolerOn, double? temperature, bool deviates)
    {
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.Cooling = new CameraCooling(coolerOn, temperature);

        await executor.RunAsync(Regular(), T("2026-09-18T11:30:42Z"), default, new BlockRunOptions(Cooling: new CoolingTarget(-10, 1)));

        Assert.All(nina.Deviations, d => Assert.Equal(deviates, d));
        Assert.Equal(deviates ? 1 : 0, sink.Lines.Count(l => l.Contains("camera_temperature")));
    }

    [Fact]
    public async Task Ohne_Soll_keine_Pruefung()
    {
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.Cooling = new CameraCooling(false, 20);
        await executor.RunAsync(Regular(), T("2026-09-18T11:30:42Z"), default);
        Assert.All(nina.Deviations, Assert.False);
        Assert.DoesNotContain(sink.Lines, l => l.Contains("camera_temperature"));
    }
}
