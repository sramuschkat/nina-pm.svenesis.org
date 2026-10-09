using System.Globalization;
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
        var (executor, nina, sink, _) = Setup("2026-09-18T07:30:00Z");
        var block = Regular();
        await executor.RunAsync(block, null, default);
        // Im 10-s-Takt (abbrechbar durch *Block überspringen*), der letzte Takt endet genau am Blockstart.
        var delays = nina.Calls.TakeWhile(c => c.StartsWith("delay:", StringComparison.Ordinal)).ToList();
        Assert.Equal("delay:2026-09-18T07:30:10.000Z", delays[0]);
        Assert.Equal("delay:2026-09-18T07:35:00.000Z", delays[^1]);
        // Plugin 0.4.18: kein stilles Warten – eine Zeile im Log.
        Assert.Contains($"I NINA-PM | WAIT_BLOCK block={block.Id} untilUtc=2026-09-18T07:35:00Z durationS=300", sink.Lines);
    }

    [Fact]
    public async Task Zentrier_Leiter_bis_kein_Versuch_mehr_vor_Blockende_passt()
    {
        // Blockende 07:45: Versuche 07:35, 07:36:45, 07:38:30, 07:40:30 (+30), 07:43:00 (+60) – der nächste (+120) läge danach.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.Center = _ => new CenterResult(false, "kein Solve");
        // Geplantes Zentrieren 60 s statt 330 s: sonst passte nach dem Zentrieren keine Belichtung mehr (AP-68, elapsed).
        var block = Regular(b =>
        {
            b.EndUtc = T("2026-09-18T07:45:00Z");
            b.Entries[0].DurationS = 60;
        });

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
        // Start nach der geplanten Slew-Zeit (10:37:20): ohne Slew zieht die frei gewordene Slew-Zeit die Planuhr sonst vor
        // (Plugin 0.4.18) – hier geht es nur um die Download-Zeit bei pünktlicher Belichtung um 10:37:30.
        var block = SingleExposure();
        var (executor, nina, _, _) = Setup("2026-10-06T10:37:20Z", PlaybackMode.TimeAware);
        nina.SkipSlew = true;
        var fixedDownload = await executor.RunAsync(block, T("2026-10-06T11:15:00Z"), default);
        // 10:37:30 + 603 s > 10:47:31: passt nicht – seit AP-68 gar nicht erst begonnen statt leer beendet.
        Assert.Equal((false, "elapsed", 0), (fixedDownload.Started, fixedDownload.Reason, fixedDownload.Exposures));

        (executor, nina, _, _) = Setup("2026-10-06T10:37:20Z", PlaybackMode.TimeAware);
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
        nina.FlipDurationS = 1300; // Rig-Nacht 06./07.10.2026: ≈ 22 min Flip, danach 600 s Belichtung

        await executor.RunAsync(Regular(), null, default, new BlockRunOptions(Flip: new FlipSettings(5, 15, 0, 240)));

        // Die Belichtung nach dem Flip zählt nicht zur Flipdauer.
        Assert.Contains(sink.Lines, l => l.Contains("FLIP id=") && l.Contains("pierBefore=west pierAfter=east") && l.Contains("durationS=1300"));
        Assert.Contains("center-no-rotate", nina.Calls);
        Assert.DoesNotContain("flip", nina.Calls); // Plan-Flip erledigt, kein zweiter Trigger-Aufruf
    }

    [Fact]
    public async Task Ungeplanter_Flip_vor_dem_Plan_Flip_kein_Warten_auf_den_Meridian()
    {
        // Rig-Nacht 06./07.10.2026 (IC 1795): NINA flippte vor der ersten Belichtung, der Plan sah danach „warten bis
        // Meridian“ und den Flip vor. Das Plugin wartete bis zur Flipzeit + Verzug: 03:22–03:43 CDT untätig.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        var block = Regular(b =>
        {
            // Vor dem Flip 10 min auf den Meridian warten (Pause vor dem Meridian + frühestens danach), wie die Engine plant.
            var wait = new Entries
            {
                Seq = 100, Cmd = EntriesCmd.Wait, AtUtc = T("2026-09-18T07:47:58Z"), DurationS = 600,
            };
            var flipAt = b.Entries.FindIndex(e => e.Cmd == EntriesCmd.Meridian_flip);
            b.Entries.Insert(flipAt, wait);
            var shift = TimeSpan.FromSeconds(600);
            foreach (var e in b.Entries.Skip(flipAt + 1))
            {
                e.AtUtc += shift;
                if (e.UntilUtc is { } u) e.UntilUtc = u + shift;
            }
            b.EndUtc += shift;
        });
        nina.Pier = "west";
        nina.FlipDuringExposure = 1;
        nina.FlipDurationS = 1300;

        await executor.RunAsync(block, null, default, new BlockRunOptions(Flip: new FlipSettings(5, 15, 0, 240), DownloadS: 3));

        Assert.Contains(sink.Lines, l => l.Contains("WAIT_SKIPPED") && l.Contains("reason=flipped") && l.Contains("plannedS=600"));
        Assert.DoesNotContain("flip", nina.Calls);
        // Nach Flip (1300 s) und Zentrieren folgt die zweite Belichtung ohne Warten – vorher erst nach Flipzeit + Verzug.
        var exposes = nina.Calls.Where(c => c.StartsWith("expose:", StringComparison.Ordinal)).ToList();
        var center = nina.Calls.FindIndex(c => c == "center-no-rotate");
        var second = nina.Calls.FindIndex(c => c == exposes[1]);
        Assert.True(center > 0 && second > center);
        Assert.DoesNotContain(nina.Calls.Skip(center).Take(second - center), c => c.StartsWith("delay:", StringComparison.Ordinal));
        // Keine Belichtung verworfen: die frei gewordene Planzeit gleicht den Flip aus.
        Assert.DoesNotContain(sink.Lines, l => l.Contains("SKIPPED_TIMEAWARE"));
        Assert.Equal("expose:8@2026-09-18T08:11:08.000Z", exposes[1]);
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

    // ---- Plugin 0.4.18 (Analyse 07.10.2026): Flip- und Wartezeiten, Stopp, Blockschluss, Tätigkeit -------------------

    /// <summary>
    /// Vor dem Flip <paramref name="waitS"/> s auf den Meridian warten (Eintrag <c>wait</c>, seq 100), wie die Engine plant;
    /// alles danach verschoben.
    /// </summary>
    private static void MeridianWait(Blocks b, double waitS = 600)
    {
        var flipAt = b.Entries.FindIndex(e => e.Cmd == EntriesCmd.Meridian_flip);
        b.Entries.Insert(flipAt, new Entries { Seq = 100, Cmd = EntriesCmd.Wait, AtUtc = b.Entries[flipAt].AtUtc, DurationS = waitS });
        var shift = TimeSpan.FromSeconds(waitS);
        foreach (var e in b.Entries.Skip(flipAt + 1))
        {
            e.AtUtc += shift;
            if (e.UntilUtc is { } u) e.UntilUtc = u + shift;
        }
        b.EndUtc += shift;
    }

    /// <summary>Block um <paramref name="by"/> verschoben, mit neuer ID (späterer Block desselben Ziels).</summary>
    private static void Later(Blocks b, TimeSpan by)
    {
        b.Id = Guid.NewGuid();
        b.StartUtc += by;
        b.EndUtc += by;
        foreach (var e in b.Entries) e.AtUtc += by;
        if (b.MeridianFlip is { } m) m.PlannedUtc += by;
        b.TwilightEndUtc = null;
    }

    private static DateTimeOffset StartOf(string call) => T(call[(call.IndexOf('@') + 1)..]);

    [Fact]
    public async Task Warten_auf_den_Meridian_endet_zur_festen_Flipzeit_nicht_um_den_Verzug_spaeter()
    {
        // Analyse 07.10.2026 (Befund 1): Der Meridian kommt nicht später, nur weil der Block 2 min hinter dem Plan liegt.
        // Vorher wartete das Plugin bis Flipzeit + Verzug und schob den Verzug danach weiter.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:41:00Z", PlaybackMode.TimeAware);
        var block = Regular(b => MeridianWait(b));
        nina.Pier = "west";
        nina.FlipOnTriggers = true;

        await executor.RunAsync(block, null, default);

        var flipAt = block.Entries.Single(e => e.Cmd == EntriesCmd.Meridian_flip).AtUtc; // 07:57:58
        var trigger = nina.Calls.IndexOf("flip");
        Assert.Equal($"delay:{UtcText.Format(flipAt)}", nina.Calls.Take(trigger).Last(c => c.StartsWith("delay:", StringComparison.Ordinal)));
        Assert.Contains(sink.Lines, l => l.Contains($"WAIT_ENTRY block={block.Id} untilUtc={flipAt:yyyy-MM-ddTHH:mm:ss}Z") && l.EndsWith("reason=meridian", StringComparison.Ordinal));
        // Verzug abgebaut: nach Flip (240 s) und Zentrieren (90 s) beginnt die nächste Belichtung zur Planzeit.
        var next = block.Entries.First(e => e.Cmd == EntriesCmd.Expose && e.AtUtc > flipAt);
        Assert.Contains($"expose:{next.Seq}@{UtcText.Format(next.AtUtc)}", nina.Calls);
    }

    [Fact]
    public async Task Wait_Eintrag_ohne_Flip_endet_zur_Planzeit_und_baut_den_Verzug_ab()
    {
        // Befund 1, allgemeiner wait: bis atUtc + durationS (§4.2), kürzeres Warten als geplant baut den Verzug ab.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:41:00Z", PlaybackMode.TimeAware);
        var block = Regular(b =>
        {
            b.Entries.RemoveAll(e => e.Cmd == EntriesCmd.Meridian_flip || e.Seq == 7);
            b.MeridianFlip = null;
            var at = b.Entries.FindIndex(e => e.Seq == 9); // Dither nach der zweiten Belichtung
            b.Entries.Insert(at + 1, new Entries { Seq = 101, Cmd = EntriesCmd.Wait, AtUtc = b.Entries[at].AtUtc.AddSeconds(15), DurationS = 300 });
            foreach (var e in b.Entries.Skip(at + 2)) e.AtUtc += TimeSpan.FromSeconds(300);
            b.EndUtc += TimeSpan.FromSeconds(300);
        });

        var outcome = await executor.RunAsync(block, null, default);

        Assert.Equal("completed", outcome.Reason);
        var until = block.Entries.Single(e => e.Seq == 101).AtUtc.AddSeconds(300);
        Assert.Contains(sink.Lines, l => l.Contains($"WAIT_ENTRY block={block.Id} untilUtc={until:yyyy-MM-ddTHH:mm:ss}Z") && l.EndsWith("reason=plan", StringComparison.Ordinal));
        Assert.Contains($"expose:10@{UtcText.Format(block.Entries.Single(e => e.Seq == 10).AtUtc)}", nina.Calls);
    }

    [Fact]
    public async Task Ungeplanter_Flip_im_frueheren_Block_spaeterer_Block_desselben_Ziels_flippt_nicht_noch_einmal()
    {
        // Befund 2: NINA flippte in Block A ungeplant; Block B desselben Ziels (Plan von vorher) sah noch Warten, Flip und
        // Zentrieren vor – das Plugin wartete auf NINAs Flipzeit (die nach dem Flip nicht mehr kommt) und meldete
        // FLIP_UNDETECTED.
        var (executor, nina, sink, clock) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        nina.Pier = "west";
        nina.FlipDuringExposure = 1;
        nina.FlipDurationS = 300;
        var a = Regular(b =>
        {
            b.Entries.RemoveAll(e => e.Seq is > 4 and < 40);
            b.EndUtc = T("2026-09-18T07:55:00Z");
            b.Entries[^1].AtUtc = b.EndUtc;
            b.MeridianFlip = null;
        });
        var flipDone = false;
        var options = new BlockRunOptions(Flip: new FlipSettings(5, 15, 0, 240), FlipDone: _ => flipDone = true, FlipDoneTonight: _ => flipDone);
        await executor.RunAsync(a, null, default, options);
        Assert.True(flipDone);
        Assert.Equal("east", nina.Pier);

        var b = Regular(x =>
        {
            MeridianWait(x);
            Later(x, TimeSpan.FromHours(2));
        });
        var before = nina.Calls.Count;
        sink.Lines.Clear();
        var outcome = await executor.RunAsync(b, null, default, options);

        Assert.Equal("completed", outcome.Reason);
        Assert.DoesNotContain("flip", nina.Calls.Skip(before));
        Assert.DoesNotContain(sink.Lines, l => l.Contains("FLIP_UNDETECTED"));
        Assert.Contains(sink.Lines, l => l.Contains($"WAIT_SKIPPED block={b.Id} reason=flipped"));
        // Ohne Flip-Nachtfakt (neue Nacht) bleibt der Plan-Flip offen.
        var (e2, n2, s2, _) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        n2.Pier = "west";
        n2.FlipDuringExposure = 1;
        await e2.RunAsync(Regular(x => { x.Entries.RemoveAll(e => e.Seq is > 4 and < 40); x.EndUtc = T("2026-09-18T07:55:00Z"); x.Entries[^1].AtUtc = x.EndUtc; x.MeridianFlip = null; }),
            null, default, options with { FlipDoneTonight = _ => false });
        n2.FlipOnTriggers = true;
        await e2.RunAsync(Regular(x => Later(x, TimeSpan.FromHours(2))), null, default, options with { FlipDoneTonight = _ => false });
        Assert.Contains("flip", n2.Calls);
        Assert.True(clock.UtcNow > b.StartUtc);
    }

    [Fact]
    public async Task Ueberspringen_waehrend_des_Wartens_auf_die_Flipzeit_beendet_den_Block_ohne_Flip_und_Zentrieren()
    {
        // Befund 3: FlipAsync wartete trotz Stoppgrund bis zur Flipzeit und löste den Flip noch aus (§4.2: der Block endet sofort).
        var (executor, nina, sink, clock) = Setup("2026-09-18T07:35:00Z");
        var block = Regular();
        var flipEntry = block.Entries.Single(e => e.Cmd == EntriesCmd.Meridian_flip);
        nina.Pier = "west";
        nina.FlipOnTriggers = true;
        nina.EarliestFlipUtc = flipEntry.AtUtc.AddMinutes(5); // vor limitEnd (tM + 15 min = 07:57:55)
        var skip = false;
        nina.OnDelay = until => skip |= until > flipEntry.AtUtc;

        var outcome = await executor.RunAsync(block, null, default,
            new BlockRunOptions(StopReason: () => skip ? "user_skip" : null, Flip: new FlipSettings(5, 15, 0, 240)));

        Assert.Equal(("user_skip", 1), (outcome.Reason, outcome.Exposures));
        Assert.DoesNotContain("flip", nina.Calls);
        Assert.DoesNotContain("center-no-rotate", nina.Calls);
        Assert.True(clock.UtcNow < nina.EarliestFlipUtc);
        // Befund 12: das Warten auf NINAs früheste Flipzeit steht im Log.
        Assert.Contains(sink.Lines, l => l.Contains($"WAIT_FLIP block={block.Id}") && l.Contains($"untilUtc={nina.EarliestFlipUtc:yyyy-MM-ddTHH:mm:ss}Z"));
    }

    [Fact]
    public async Task Frueher_kurzer_NINA_Flip_frei_gewordene_Planzeit_zieht_die_naechste_Belichtung_vor()
    {
        // Befund 5: NINA flippte vor der ersten Belichtung in 120 s; Warten (600 s), Plan-Flip (240 s) und Zentrieren (90 s)
        // entfallen – mehr, als der Verzug hergibt. Vorher wartete die Rig den Rest mit WAIT_PLAN ab.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        var block = Regular(b => MeridianWait(b));
        nina.Pier = "west";
        nina.FlipDuringExposure = 1;
        nina.FlipDurationS = 120;

        await executor.RunAsync(block, null, default, new BlockRunOptions(Flip: new FlipSettings(5, 15, 0, 240), DownloadS: 3));

        var exposes = nina.Calls.Where(c => c.StartsWith("expose:", StringComparison.Ordinal)).ToList();
        var center = nina.Calls.FindIndex(c => c == "center-no-rotate");
        var second = nina.Calls.FindIndex(c => c == exposes[1]);
        Assert.True(center > 0 && second > center);
        Assert.DoesNotContain(nina.Calls.Skip(center).Take(second - center), c => c.StartsWith("delay:", StringComparison.Ordinal));
        // Kein WAIT_PLAN nach dem Flip vor der zweiten Belichtung (nur vor der ersten und später an der Autofokus-Zeitmarke).
        Assert.DoesNotContain(sink.Lines, l => l.Contains("WAIT_PLAN") && l.Contains("untilUtc=2026-09-18T07:5"));
        Assert.DoesNotContain(sink.Lines, l => l.Contains("SKIPPED_TIMEAWARE"));
        Assert.StartsWith("expose:8@", exposes[1]);
    }

    [Fact]
    public async Task Nach_langem_Flip_wird_das_Blockende_vor_der_Belichtung_neu_geprueft()
    {
        // Befund 6: Die Entscheidung „belichten“ fiel vor Dither und Flip; nach 10 min Flip begann die Belichtung nach dem
        // Blockende.
        var (executor, nina, _, clock) = Setup("2026-09-18T07:35:00Z");
        nina.SkipSlew = true;
        nina.FlipTriggerS = 600;
        var block = Regular(b => b.EndUtc = T("2026-09-18T07:50:00Z"));

        var outcome = await executor.RunAsync(block, null, default);

        Assert.Equal(("completed", 1), (outcome.Reason, outcome.Exposures));
        Assert.Single(nina.Calls, c => c.StartsWith("expose:", StringComparison.Ordinal));
        Assert.All(nina.Calls.Where(c => c.StartsWith("expose:", StringComparison.Ordinal)), c => Assert.True(StartOf(c).AddSeconds(303) <= block.EndUtc, c));
        Assert.True(clock.UtcNow < block.EndUtc.AddMinutes(1));
    }

    [Fact]
    public async Task Slew_entfaellt_die_geplante_Slew_Zeit_wird_nicht_abgewartet()
    {
        // Befund 7: gleiches Ziel, kein Slew – vorher wartete der Block die geplanten 330 s Slew/Zentrieren mit WAIT_PLAN ab.
        // Es bleibt nur die Autofokus-Zeitmarke (120 s, NT-24).
        var (executor, nina, _, _) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        nina.SkipSlew = true;

        await executor.RunAsync(Regular(), null, default);

        Assert.Equal("expose:4@2026-09-18T07:37:10.000Z", nina.Calls.First(c => c.StartsWith("expose:", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task Mehr_als_3_verpasste_Belichtungen_beenden_den_Block_fuer_die_Neuplanung()
    {
        // Befund 8 (§4.2): z. B. nach einem Ruhezustand des PCs während einer Wartezeit liegt die Planuhr eine Stunde weiter.
        var (executor, nina, sink, clock) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        var block = Regular(b =>
        {
            foreach (var e in b.Entries.Skip(1)) e.AtUtc = e.AtUtc.AddMinutes(4);
        });
        var jumped = false;
        nina.OnDelay = _ =>
        {
            if (jumped) return;
            jumped = true;
            clock.Advance(TimeSpan.FromHours(1));
        };

        var outcome = await executor.RunAsync(block, null, default);

        Assert.Equal(("replanned", 0), (outcome.Reason, outcome.Exposures));
        Assert.True(outcome.NeedsReplan);
        Assert.True(outcome.SkippedTimeAware > Playback.MaxSkippedBeforeReplan);
        Assert.DoesNotContain("flip", nina.Calls);
        Assert.Contains(sink.Lines, l => l.Contains($"BLOCK_END id={block.Id} reason=replanned"));
    }

    [Fact]
    public async Task Beim_Warten_Flip_und_Zentrieren_laeuft_keine_Belichtung_die_Taetigkeit_steht_im_Executor()
    {
        // Befund 10: CurrentEntry blieb nach der Belichtung gesetzt – das Fenster zeigte beim Warten „▶ läuft 100 %“.
        var (executor, nina, _, _) = Setup("2026-09-18T07:41:00Z", PlaybackMode.TimeAware);
        var block = Regular(b => MeridianWait(b));
        nina.Pier = "west";
        nina.FlipOnTriggers = true;
        var seen = new List<(Entries? Current, BlockActivity? Activity, Entries? Last)>();
        nina.OnDelay = _ => seen.Add((executor.CurrentEntry, executor.Activity, executor.LastEntry));

        await executor.RunAsync(block, null, default);

        Assert.All(seen, s => Assert.Null(s.Current));
        Assert.Contains(seen, s => s.Activity is { Kind: BlockActivityKind.WaitPlan, UntilUtc: not null });
        Assert.Contains(seen, s => s.Activity is { Kind: BlockActivityKind.WaitMeridian, Seq: 100 } && s.Last?.Seq == 4);
        Assert.Null(executor.Activity);
        Assert.Null(executor.LastEntry);
    }

    [Fact]
    public async Task Ungeplanter_Flip_wird_zum_Ende_des_Flips_vor_der_Belichtung_gemeldet()
    {
        // Befund 11: Zeitpunkt war die Erkennung nach der folgenden Belichtung – das Fenster zeichnete den Flip eine
        // Belichtung zu spät. Jetzt: Beginn der Belichtung (Trigger) + Flipdauer.
        var (executor, nina, _, _) = Setup("2026-09-18T07:35:00Z");
        nina.Pier = "west";
        nina.FlipDuringExposure = 1;
        nina.FlipDurationS = 1300;
        var reported = new List<(EventsKind Kind, double? DurationS, DateTimeOffset? At)>();

        await executor.RunAsync(Regular(), null, default, new BlockRunOptions(Report: (k, _, _, d, at, _) => reported.Add((k, d, at))));

        var started = StartOf(nina.Calls.First(c => c.StartsWith("expose:", StringComparison.Ordinal)));
        var flip = Assert.Single(reported, r => r.Kind == EventsKind.Flip);
        Assert.Equal((1300d, started.AddSeconds(1300)), (flip.DurationS!.Value, flip.At!.Value));
    }

    [Fact]
    public async Task Ungeplanter_Flip_meldet_den_eigentlichen_Flip_ohne_NINAs_Warten_auf_die_frueheste_Flipzeit()
    {
        // AP-65 (Plugin 0.4.19): Rig-Nacht 06./07.10.2026 – NINAs Trigger löste 16 min vor der frühesten Flipzeit aus und
        // wartete; flip.durationS enthält das Warten, data.flipActionS nicht (die Engine plant das Warten als `wait`).
        async Task<(DateTimeOffset Started, IDictionary<string, object>? Data)> Run(Func<DateTimeOffset, DateTimeOffset?> earliest, DateTimeOffset? started)
        {
            var (executor, nina, _, _) = Setup("2026-09-18T07:35:00Z");
            nina.Pier = "west";
            nina.FlipDuringExposure = 1;
            nina.FlipDurationS = 1300;
            if (started is { } st) nina.EarliestFlipUtc = earliest(st);
            IDictionary<string, object>? data = null;
            await executor.RunAsync(Regular(), null, default,
                new BlockRunOptions(Report: (k, _, _, _, _, d) => { if (k == EventsKind.Flip) data = d; }));
            return (StartOf(nina.Calls.First(c => c.StartsWith("expose:", StringComparison.Ordinal))), data);
        }

        var unknown = await Run(_ => null, null);
        Assert.Null(unknown.Data); // ohne Montierung keine früheste Flipzeit → kein flipActionS
        var waited = await Run(st => st.AddSeconds(960), unknown.Started);
        Assert.Equal(340d, Convert.ToDouble(waited.Data!["flipActionS"], CultureInfo.InvariantCulture));
        var reached = await Run(st => st.AddSeconds(-60), unknown.Started);
        Assert.Equal(1300d, Convert.ToDouble(reached.Data!["flipActionS"], CultureInfo.InvariantCulture));
    }

    [Theory]
    [InlineData(1300, 960, 340)]
    [InlineData(300, 0, 300)]
    [InlineData(300, -120, 300)]
    [InlineData(200, 600, 0)]
    public void FlipRules_ActionS_zieht_das_Warten_auf_die_frueheste_Flipzeit_ab(double durationS, double earliestInS, double expected)
    {
        var t = DateTimeOffset.Parse("2026-10-07T07:50:00Z", CultureInfo.InvariantCulture);
        Assert.Equal(expected, FlipRules.ActionS(durationS, t, t.AddSeconds(earliestInS)));
        Assert.Null(FlipRules.ActionS(durationS, t, null));
        Assert.Equal(t.AddSeconds(Math.Max(0, earliestInS)), FlipRules.EarliestUtc(t, earliestInS / 60));
    }

    [Fact]
    public async Task Warten_vor_dem_Flip_prueft_neue_Ziele_sofort_und_endet_ohne_Flip()
    {
        // Befund 12: das Warten eines wait-Eintrags prüfte weder neue Ziele noch einen Transit (§4.2: wie die Wartezeit
        // vor einer Belichtung) – der Block lief bis zum Flip weiter.
        var (executor, nina, _, clock) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        var block = Regular(b => MeridianWait(b));
        var wait = block.Entries.Single(e => e.Seq == 100);
        var changed = false;
        nina.OnDelay = _ => changed |= clock.UtcNow > wait.AtUtc;

        var outcome = await executor.RunAsync(block, null, default, new BlockRunOptions(
            InBlockCheck: (_, _) => Task.FromResult<string?>(changed ? "target_removed" : null),
            TargetsChanged: () => changed));

        Assert.Equal(("target_removed", 1), (outcome.Reason, outcome.Exposures));
        Assert.DoesNotContain("flip", nina.Calls);
        Assert.True(clock.UtcNow < block.Entries.Single(e => e.Cmd == EntriesCmd.Meridian_flip).AtUtc);
    }

    [Fact]
    public async Task Transitserie_endet_durch_Abbruch_transit_end_wird_trotzdem_gemeldet()
    {
        // Befund 15: endete die Serie mit Fehler oder Abbruch, fehlte transit_end auf dem Server.
        var (executor, nina, sink, _) = Setup("2026-09-18T02:00:00Z");
        nina.CancelAtExposure = 3;
        var block = Transit();
        var reported = new List<EventsKind>();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => executor.RunAsync(block, null, nina.Sequence.Token,
            new BlockRunOptions(Report: (k, _, _, _, _, _) => reported.Add(k))));

        Assert.Contains(sink.Lines, l => l.EndsWith($"TRANSIT_END id={block.Id}", StringComparison.Ordinal));
        Assert.Equal([EventsKind.Transit_start, EventsKind.Transit_end], reported);
    }
    // ---- AP-68: Plugin 0.4.20 (Rig-Nächte 06.–08.10.2026) ----------------------------------------------------------

    private static readonly FlipSettings Flip240 = new(5, 15, 0, 240);

    [Fact]
    public async Task Pier_Seite_kommt_verzoegert_der_Flip_wird_erkannt_und_zentriert()
    {
        // ASI-Montierung am Starfront-Rig: die neue Pier-Seite kommt erst 20 s nach dem Flip.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        var block = Regular();
        nina.Pier = "west";
        nina.FlipOnTriggers = true;
        nina.PierReportDelayS = 20;
        nina.EarliestFlipUtc = block.Entries.Single(e => e.Cmd == EntriesCmd.Meridian_flip).AtUtc;

        await executor.RunAsync(block, null, default, new BlockRunOptions(Flip: Flip240));

        Assert.Contains(sink.Lines, l => l.Contains("FLIP id=") && l.Contains("pierBefore=west pierAfter=east"));
        Assert.DoesNotContain(sink.Lines, l => l.Contains("FLIP_UNDETECTED"));
        var trigger = nina.Calls.IndexOf("flip");
        var center = nina.Calls.IndexOf("center-no-rotate");
        var next = nina.Calls.FindIndex(trigger, c => c.StartsWith("expose:", StringComparison.Ordinal));
        Assert.True(trigger < center && center < next);
    }

    [Fact]
    public async Task Pier_Seite_kommt_erst_nach_der_naechsten_Belichtung_Flip_wird_nachgeholt()
    {
        // Rig-Nacht 07./08.10.2026: FLIP_UNDETECTED, die Seite wechselte erst später – nie zentriert, kein Flip gemeldet.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        var block = Regular();
        nina.Pier = "west";
        nina.FlipOnTriggers = true;
        nina.PierReportDelayS = 200;
        nina.EarliestFlipUtc = block.Entries.Single(e => e.Cmd == EntriesCmd.Meridian_flip).AtUtc;
        var flips = 0;

        await executor.RunAsync(block, null, default, new BlockRunOptions(Flip: Flip240, FlipDone: _ => flips++));

        Assert.Contains(sink.Lines, l => l.Contains("FLIP_UNDETECTED"));
        Assert.Contains(sink.Lines, l => l.Contains("FLIP id=") && l.Contains("pierBefore=west pierAfter=east"));
        Assert.Equal(1, flips);
        var center = nina.Calls.IndexOf("center-no-rotate");
        var exposesAfterFlip = nina.Calls.Skip(nina.Calls.IndexOf("flip")).Where(c => c.StartsWith("expose:", StringComparison.Ordinal)).ToList();
        // Eine Belichtung noch vor dem Zentrieren (die Seite war unbekannt), die zweite danach.
        Assert.True(center > nina.Calls.IndexOf(exposesAfterFlip[0]) && center < nina.Calls.IndexOf(exposesAfterFlip[1]));
    }

    [Fact]
    public async Task Autofokus_im_Plan_Slot_fuehrt_das_Plugin_selbst_aus()
    {
        // Rig-Nacht 07./08.10.2026: im Slot nur WAIT_PLAN ≈ 5 min, NINA fokussierte zu anderer Zeit noch einmal.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        nina.SkipSlew = true;
        nina.LastAutofocusUtc = T("2026-09-18T06:50:00Z");
        nina.AutofocusS = 120;
        var options = new BlockRunOptions(Autofocus: new AutofocusSettings(60, 120, T("2026-09-18T07:30:00Z")));

        await executor.RunAsync(Regular(), null, default, options);

        var af = nina.Calls.FindIndex(c => c.StartsWith("af@", StringComparison.Ordinal));
        // AP-70: vor dem Autofokus der Filter der nächsten Belichtung (Ha), nicht der, der noch im Rad liegt.
        Assert.True(af > 0 && nina.Calls[af - 1] == "filter:Ha", string.Join(", ", nina.Calls.Take(af + 1)));
        Assert.Equal(2, nina.Autofocuses); // beide Plan-Slots (07:40:30, 08:46:28)
        Assert.Contains(sink.Lines, l => l.Contains("AF_START") && l.Contains("reason=plan"));
        Assert.Equal(EntryOutcome.Done, executor.EntryOutcomes[2]);
    }

    [Fact]
    public async Task Autofokus_im_Plan_Slot_entfaellt_wenn_NINA_gerade_fokussiert_hat()
    {
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        nina.SkipSlew = true;
        nina.LastAutofocusUtc = T("2026-09-18T07:30:00Z");
        var block = Regular(b => b.Entries.RemoveAll(e => e.Seq == 28));

        await executor.RunAsync(block, null, default, new BlockRunOptions(Autofocus: new AutofocusSettings(60, 120, T("2026-09-18T07:30:00Z"))));

        Assert.Equal(0, nina.Autofocuses);
        Assert.Contains(sink.Lines, l => l.Contains("AF_SKIPPED") && l.Contains("reason=recent"));
        Assert.Equal(EntryOutcome.Skipped, executor.EntryOutcomes[2]);
    }

    [Fact]
    public async Task Ohne_Autofokus_Takt_bleibt_der_Plan_Slot_Zeitmarke()
    {
        var (executor, nina, _, _) = Setup("2026-09-18T07:35:00Z");
        await executor.RunAsync(Regular(), null, default, new BlockRunOptions(Autofocus: new AutofocusSettings(0, 120, null)));
        Assert.Equal(0, nina.Autofocuses);
    }

    [Fact]
    public async Task Autofokus_vor_dem_ersten_Block_der_Nacht_nur_mit_altem_Fokus()
    {
        var block = Regular(b => b.Entries.RemoveAll(e => e.Cmd == EntriesCmd.Autofocus_hint));
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.LastAutofocusUtc = T("2026-09-18T06:40:00Z"); // Start-AF 55 min vorher, danach WAIT_BLOCK bis zur Dunkelheit
        await executor.RunAsync(block, null, default, new BlockRunOptions(Autofocus: new AutofocusSettings(60, 180, null)));
        var af = nina.Calls.FindIndex(c => c.StartsWith("af@", StringComparison.Ordinal));
        Assert.True(af > nina.Calls.FindIndex(c => c.StartsWith("center@", StringComparison.Ordinal)) && af < nina.Calls.IndexOf("guide"));
        // AP-70 (Rig-Nacht 08./09.10.2026: Autofokus mit B für einen L-Block): erst der Filter der ersten Belichtung.
        Assert.Equal("filter:Ha", nina.Calls[af - 1]);
        Assert.Contains(sink.Lines, l => l.Contains("AF_START") && l.Contains("reason=block_start"));

        // Frisch fokussiert (z. B. im Wiederherstellungsteil nach dem Dach) bzw. Block direkt nach dem vorigen: kein Autofokus.
        (executor, nina, _, _) = Setup("2026-09-18T07:35:00Z");
        nina.LastAutofocusUtc = T("2026-09-18T07:20:00Z");
        await executor.RunAsync(block, null, default, new BlockRunOptions(Autofocus: new AutofocusSettings(60, 180, null)));
        Assert.Equal(0, nina.Autofocuses);

        (executor, nina, _, _) = Setup("2026-09-18T07:35:00Z");
        nina.LastAutofocusUtc = T("2026-09-18T06:40:00Z");
        await executor.RunAsync(block, null, default, new BlockRunOptions(Autofocus: new AutofocusSettings(60, 180, T("2026-09-18T07:25:00Z"))));
        Assert.Equal(0, nina.Autofocuses);
    }

    [Fact]
    public async Task Schneller_Plan_Flip_zieht_die_naechste_Belichtung_vor()
    {
        // VM-Lauf 07.10.2026: Flip 92 s statt geplanter 120 s, danach WAIT_PLAN 125 s.
        var (executor, nina, _, _) = Setup("2026-09-18T07:35:00Z", PlaybackMode.TimeAware);
        var block = Regular();
        nina.Pier = "west";
        nina.FlipOnTriggers = true;
        nina.FlipTriggerS = 90;
        nina.EarliestFlipUtc = block.Entries.Single(e => e.Cmd == EntriesCmd.Meridian_flip).AtUtc;

        await executor.RunAsync(block, null, default, new BlockRunOptions(Flip: Flip240));

        var center = nina.Calls.IndexOf("center-no-rotate");
        var next = nina.Calls.FindIndex(center, c => c.StartsWith("expose:", StringComparison.Ordinal));
        Assert.DoesNotContain(nina.Calls.Skip(center).Take(next - center), c => c.StartsWith("delay:", StringComparison.Ordinal));
        Assert.Equal(EntryOutcome.Done, executor.EntryOutcomes[5]); // Dither
        Assert.Equal(EntryOutcome.Done, executor.EntryOutcomes[6]); // Flip
    }

    [Fact]
    public async Task Keine_Fahrt_zu_einem_Block_in_den_nach_dem_Zentrieren_keine_Belichtung_passt()
    {
        // Rig-Nacht 07./08.10.2026 (NGC 7380): Slew um 03:24, nach dem Zentrieren passte nichts mehr – 22,8 min ohne Belichtung.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        var block = Regular(b => b.EndUtc = T("2026-09-18T07:44:00Z")); // ohne Slew passte 07:35 + 303 s, mit 330 s Slew nicht

        var outcome = await executor.RunAsync(block, null, default);

        Assert.Equal((false, "elapsed"), (outcome.Started, outcome.Reason));
        Assert.DoesNotContain(nina.Calls, c => c.StartsWith("center@", StringComparison.Ordinal));
        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_SKIPPED") && l.Contains("reason=elapsed"));
    }
    [Fact]
    public async Task NINA_flippt_in_den_Triggern_vor_der_Belichtung_erst_zentrieren_dann_belichten()
    {
        // Rig-Nacht 07./08.10.2026: Flip 22:29–22:35 CDT im Trigger-Aufruf vor der Belichtung, Belichtung bis 22:45 unzentriert.
        var (executor, nina, sink, _) = Setup("2026-09-18T07:35:00Z");
        nina.Pier = "west";
        nina.FlipBeforeExposure = 1; // vor dem geplanten Flip (früheste Flipzeit erreicht, ±1 Belichtung)
        nina.FlipDurationS = 360;
        var flips = 0;

        var outcome = await executor.RunAsync(Regular(), null, default, new BlockRunOptions(Flip: Flip240, FlipDone: _ => flips++));

        Assert.Equal(1, flips);
        Assert.Contains(sink.Lines, l => l.Contains("FLIP id=") && l.Contains("pierBefore=west pierAfter=east") && l.Contains("durationS=360"));
        var flip = nina.Calls.FindIndex(c => c.StartsWith("nina-flip@", StringComparison.Ordinal));
        var center = nina.Calls.IndexOf("center-no-rotate");
        var next = nina.Calls.FindIndex(flip, c => c.StartsWith("expose:", StringComparison.Ordinal));
        Assert.True(flip < center && center < next);
        Assert.True(outcome.Exposures > 1);
    }
}
