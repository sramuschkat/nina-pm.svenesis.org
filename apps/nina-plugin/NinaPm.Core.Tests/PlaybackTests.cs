using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Planning;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// Playback (execution.md §4.2, TK 10.3 Nr. 7) am regulären Block der Beispielnacht (07:35–09:20:01, Belichtungen
/// à 300 s ab 07:42:40, Download 3 s): zeitgeführt/sequenziell, verpasste Belichtungen, harter Blockschluss,
/// Nachtende-Kulanz <c>lastOfNight</c> (NT-13).
/// </summary>
public sealed class PlaybackTests
{
    private const double Download = 3;

    private static DateTimeOffset T(string iso) => UtcText.Parse(iso);

    private static Blocks Regular()
    {
        var plan = JsonConvert.DeserializeObject<NinaPlanResponse>(ContractExamples.Json("plan.response"), NinaJson.Settings())!;
        return plan.Blocks.Single(b => b.Kind == BlocksKind.Regular);
    }

    private static int Index(Blocks b, int seq) => b.Entries.FindIndex(e => e.Seq == seq);

    [Fact]
    public void Puenktlich_die_erste_Belichtung()
    {
        var b = Regular();
        var s = Playback.Next(b, -1, T("2026-09-18T07:42:40Z"), TimeSpan.Zero, PlaybackMode.TimeAware, null, Download);
        Assert.Equal(PlaybackKind.Expose, s.Kind);
        Assert.Equal(Index(b, 4), s.EntryIndex);
        Assert.Empty(s.Skipped);
    }

    [Fact]
    public void Zeitgefuehrt_zu_frueh_wartet_bis_zur_Planzeit()
    {
        var b = Regular();
        var s = Playback.Next(b, -1, T("2026-09-18T07:40:00Z"), TimeSpan.Zero, PlaybackMode.TimeAware, null, Download);
        Assert.Equal(PlaybackKind.Wait, s.Kind);
        Assert.Equal(T("2026-09-18T07:42:40Z"), s.WaitUntilUtc);
    }

    [Fact]
    public void Zeitgefuehrt_verpasste_Belichtungen_werden_uebersprungen()
    {
        var b = Regular();
        var s = Playback.Next(b, -1, T("2026-09-18T07:59:00Z"), TimeSpan.Zero, PlaybackMode.TimeAware, null, Download);
        Assert.Equal(Index(b, 10), s.EntryIndex);
        Assert.Equal([Index(b, 4), Index(b, 8)], s.Skipped);
    }

    [Fact]
    public void Verzug_stellt_die_Planuhr_zurueck_und_rettet_Belichtungen()
    {
        // 07:59:00 mit 6 min Verzug (z. B. langes Zentrieren) = Planuhr 07:53:00: nur seq 4 ist fällig, nichts verworfen.
        var b = Regular();
        var s = Playback.Next(b, -1, T("2026-09-18T07:59:00Z"), TimeSpan.FromMinutes(6), PlaybackMode.TimeAware, null, Download);
        Assert.Equal(Index(b, 4), s.EntryIndex);
        Assert.Empty(s.Skipped);
        // Negativer Offset gilt als 0.
        var n = Playback.Next(b, -1, T("2026-09-18T07:59:00Z"), TimeSpan.FromMinutes(-2), PlaybackMode.TimeAware, null, Download);
        Assert.Equal(Index(b, 10), n.EntryIndex);
    }

    [Fact]
    public void Sequenziell_strikt_die_naechste_Belichtung()
    {
        var b = Regular();
        var s = Playback.Next(b, Index(b, 4), T("2026-09-18T08:10:00Z"), TimeSpan.Zero, PlaybackMode.Sequential, null, Download);
        Assert.Equal(Index(b, 8), s.EntryIndex);
        Assert.Empty(s.Skipped);
    }

    [Fact]
    public void Harter_Blockschluss_ohne_Ueberhang()
    {
        var b = Regular();
        // Letzte Belichtung seq 39 (09:14:58) braucht bis 09:20:01 – um 09:15:00 passt sie nicht mehr.
        var s = Playback.Next(b, Index(b, 35), T("2026-09-18T09:15:00Z"), TimeSpan.Zero, PlaybackMode.Sequential, null, Download);
        Assert.Equal(PlaybackKind.End, s.Kind);
        Assert.Equal("completed", s.EndReason);
        var ok = Playback.Next(b, Index(b, 35), T("2026-09-18T09:14:58Z"), TimeSpan.Zero, PlaybackMode.Sequential, null, Download);
        Assert.Equal(Index(b, 37), ok.EntryIndex);
    }

    [Fact]
    public void Weiches_Blockende_laesst_eine_verspaetete_Belichtung_bis_zur_Grenze_zu()
    {
        // Rig-Nacht 06.10.2026: Ende 09:20:01, letzte Belichtung um 09:15:00 – 17 s nach Plan – endet 09:20:03.
        var b = Regular();
        var now = T("2026-09-18T09:15:00Z");
        var soft = Playback.SoftEnd(b, nextBlockStartUtc: null, darknessEndUtc: T("2026-09-18T10:00:00Z"));
        Assert.Equal(T("2026-09-18T09:25:01Z"), soft); // endUtc + 5 min
        var s = Playback.Next(b, Index(b, 35), now, TimeSpan.Zero, PlaybackMode.Sequential, null, Download, soft);
        Assert.Equal((PlaybackKind.Expose, Index(b, 37)), (s.Kind, s.EntryIndex));

        // Folgeblock beginnt 09:20:02 → Grenze 09:20:02, die Belichtung passt nicht.
        var next = Playback.SoftEnd(b, T("2026-09-18T09:20:02Z"), T("2026-09-18T10:00:00Z"));
        Assert.Equal(T("2026-09-18T09:20:02Z"), next);
        var end = Playback.Next(b, Index(b, 35), now, TimeSpan.Zero, PlaybackMode.Sequential, null, Download, next);
        Assert.Equal(("completed", PlaybackKind.End), (end.EndReason, end.Kind));

        // Höchstens eine Belichtung über das Blockende: ab endUtc beginnt keine mehr, auch wenn sie vor der Grenze endete.
        b.Entries[Index(b, 39)].ExposureS = 10;
        var after = Playback.Next(b, Index(b, 37), T("2026-09-18T09:20:01Z"), TimeSpan.Zero, PlaybackMode.Sequential, null, Download, soft);
        Assert.Equal(("completed", PlaybackKind.End), (after.EndReason, after.Kind));
    }

    [Fact]
    public void Weiches_Blockende_hoechstens_bis_Nachtende_und_nie_vor_endUtc()
    {
        var b = Regular();
        b.TwilightEndUtc = T("2026-09-18T09:22:00Z");
        Assert.Equal(T("2026-09-18T09:21:00Z"), Playback.SoftEnd(b, null, T("2026-09-18T09:21:00Z")));
        Assert.Equal(T("2026-09-18T09:22:00Z"), Playback.SoftEnd(b, null, null));
        // Grenze vor endUtc (Folgeblock überlappt) → endUtc, kein früherer Schluss.
        Assert.Equal(b.EndUtc, Playback.SoftEnd(b, T("2026-09-18T09:10:00Z"), null));
        b.Kind = BlocksKind.Transit;
        Assert.Equal(b.EndUtc, Playback.SoftEnd(b, null, T("2026-09-18T10:00:00Z")));
    }

    [Fact]
    public void Ohne_weitere_Belichtung_endet_der_Block()
    {
        var b = Regular();
        var s = Playback.Next(b, Index(b, 39), T("2026-09-18T09:20:00Z"), TimeSpan.Zero, PlaybackMode.TimeAware, null, Download);
        Assert.Equal(("completed", PlaybackKind.End), (s.EndReason, s.Kind));
    }

    [Fact]
    public void Nachtende_Kulanz_nur_mit_lastOfNight_bis_zur_frueheren_Grenze()
    {
        var b = Regular();
        var last = b.Entries[Index(b, 39)];
        last.LastOfNight = true;
        b.EndUtc = T("2026-09-18T09:18:00Z");
        b.TwilightEndUtc = T("2026-09-18T09:25:00Z");
        var now = T("2026-09-18T09:14:58Z");

        // Grenze = min(darknessEnd 09:30, twilightEnd 09:25) = 09:25 → 300 s + 3 s passen.
        var kulanz = Playback.Next(b, Index(b, 37), now, TimeSpan.Zero, PlaybackMode.Sequential, T("2026-09-18T09:30:00Z"), Download);
        Assert.Equal(Index(b, 39), kulanz.EntryIndex);

        // Grenze 09:19:00 (darknessEnd früher) → passt nicht → night_end.
        var end = Playback.Next(b, Index(b, 37), now, TimeSpan.Zero, PlaybackMode.Sequential, T("2026-09-18T09:19:00Z"), Download);
        Assert.Equal(("night_end", PlaybackKind.End), (end.EndReason, end.Kind));

        // Ohne lastOfNight gilt blockEnd hart.
        last.LastOfNight = false;
        var hard = Playback.Next(b, Index(b, 37), now, TimeSpan.Zero, PlaybackMode.Sequential, T("2026-09-18T09:30:00Z"), Download);
        Assert.Equal(("completed", PlaybackKind.End), (hard.EndReason, hard.Kind));
    }

    [Fact]
    public void Kulanzgrenze_ignoriert_null()
    {
        Assert.Null(Playback.KulanzLimit(null, null));
        Assert.Equal(T("2026-09-18T11:00:00Z"), Playback.KulanzLimit(null, T("2026-09-18T11:00:00Z")));
        Assert.Equal(T("2026-09-18T10:00:00Z"), Playback.KulanzLimit(T("2026-09-18T10:00:00Z"), T("2026-09-18T11:00:00Z")));
    }

    [Fact]
    public void Mehr_als_drei_Verpasste_fuehren_zur_Neuplanung()
    {
        Assert.False(Playback.NeedsReplan(3));
        Assert.True(Playback.NeedsReplan(4));
    }
}
