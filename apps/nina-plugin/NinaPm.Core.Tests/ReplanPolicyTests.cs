using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Planning;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// Neuplanung mit Hysterese (FA-SYN-03, execution.md §3.2): vor jedem Block nur bei ETag/settingsVersion/Verzug
/// &gt; 10 min; im Block Fälle a/b/c; Blockindex und Slew-Entfall nach einem Planwechsel. Grundlage ist die
/// Beispielnacht aus <c>docs/contracts/nina/</c> (Deep-Sky-Projekt <c>a91f…</c>, Transit <c>e77c…</c>).
/// </summary>
public sealed class ReplanPolicyTests
{
    private static T Example<T>(string name) => JsonConvert.DeserializeObject<T>(ContractExamples.Json(name), NinaJson.Settings())!;

    private static DateTimeOffset T(string iso) => UtcText.Parse(iso);

    // ---- vor dem Block ------------------------------------------------------------------------------------

    public static TheoryData<string, string?, string?, int, int, string, string, bool, RefreshCause?, string?> BeforeBlockCases() => new()
    {
        // Name, ETag Plan, ETag jetzt, settings Plan, settings jetzt, geplanter Start, jetzt, neu?, Grund, startAtUtc
        { "alles gleich, pünktlich", "\"t-1\"", "\"t-1\"", 7, 7, "2026-09-18T07:35:00Z", "2026-09-18T07:35:00Z", false, null, null },
        { "Verzug genau 10 min (Hysterese)", "\"t-1\"", "\"t-1\"", 7, 7, "2026-09-18T07:35:00Z", "2026-09-18T07:45:00Z", false, null, null },
        { "Verzug 10 min 1 s", "\"t-1\"", "\"t-1\"", 7, 7, "2026-09-18T07:35:00Z", "2026-09-18T07:45:01Z", true, RefreshCause.BehindPlan, "2026-09-18T07:45:01Z" },
        // Ab jetzt, nicht ab dem geplanten Blockstart (Analyse 05.10.2026): die Lücke davor bleibt sonst leer.
        { "neues ETag vor dem Blockstart", "\"t-1\"", "\"t-2\"", 7, 7, "2026-09-18T07:35:00Z", "2026-09-18T07:30:00Z", true, RefreshCause.TargetsChanged, "2026-09-18T07:30:00Z" },
        { "settingsVersion gestiegen", "\"t-1\"", "\"t-1\"", 7, 8, "2026-09-18T07:35:00Z", "2026-09-18T07:36:00Z", true, RefreshCause.SettingsChanged, "2026-09-18T07:36:00Z" },
        { "schwaches ETag (CloudFront komprimiert) = starkes", "W/\"t-1\"", "\"t-1\"", 7, 7, "2026-09-18T07:35:00Z", "2026-09-18T07:35:00Z", false, null, null },
        { "kein ETag abrufbar (offline) → kein Anlass", "\"t-1\"", null, 7, 7, "2026-09-18T07:35:00Z", "2026-09-18T07:36:00Z", false, null, null },
    };

    [Theory]
    [MemberData(nameof(BeforeBlockCases))]
    public void Vor_dem_Block(string name, string? planEtag, string? etag, int planSettings, int settings, string plannedStart, string now,
        bool refresh, RefreshCause? cause, string? startAt)
    {
        var d = ReplanPolicy.BeforeBlock(planEtag, etag, planSettings, settings, T(plannedStart), T(now));
        Assert.True(refresh == d.Refresh, name);
        Assert.Equal(cause, d.Cause);
        Assert.Equal(startAt is null ? null : T(startAt), d.StartAtUtc);
    }

    [Theory]
    [InlineData("Lücke 5 min 1 s nach einem Block", "2026-09-18T07:40:01Z", true, false, true)]
    [InlineData("Lücke genau 5 min", "2026-09-18T07:40:00Z", true, false, false)]
    [InlineData("vor dem ersten Block der Nacht (Abend)", "2026-09-18T09:00:00Z", false, false, false)]
    [InlineData("Plan stammt schon aus einer Lückenplanung", "2026-09-18T09:00:00Z", true, true, false)]
    public void Luecke_vor_dem_naechsten_Block(string name, string plannedStart, bool blockRan, bool fromIdle, bool expected) =>
        Assert.True(expected == ReplanPolicy.IdleAhead(T(plannedStart), T("2026-09-18T07:35:00Z"), blockRan, fromIdle), name);

    [Theory]
    [InlineData("übersprungener Block, Plan aus Lückenplanung", "2026-09-18T07:47:00Z", true, true, true, RefreshCause.SkippedBlock)]
    [InlineData("übersprungener Block, Lücke genau 5 min", "2026-09-18T07:40:00Z", true, true, true, null)]
    [InlineData("kein übersprungener Block, Plan aus Lückenplanung", "2026-09-18T07:47:00Z", true, true, false, null)]
    [InlineData("gelaufener Block, normaler Plan", "2026-09-18T07:47:00Z", true, false, false, RefreshCause.IdleAhead)]
    public void Luecke_nach_uebersprungenem_Block(string name, string plannedStart, bool blockRan, bool fromIdle, bool skipped, RefreshCause? expected) =>
        Assert.True(expected == ReplanPolicy.IdleRefresh(T(plannedStart), T("2026-09-18T07:35:00Z"), blockRan, fromIdle, skipped), name);

    [Theory]
    [InlineData("elapsed", true)]
    [InlineData("not_viable", true)]
    [InlineData("center_failed", true)]
    [InlineData("filter_not_found", false)] // derselbe Block käme wieder (kopfloser Lauf P-19)
    [InlineData("readout_mode_not_found", false)]
    [InlineData("user_skip", false)]
    public void Neuplanung_nur_nach_Gruenden_die_ein_neuer_Plan_aendert(string reason, bool expected) =>
        Assert.Equal(expected, ReplanPolicy.SkipReplans(reason));

    [Fact]
    public void Geplanter_Blockstart_eines_Transitblocks_ist_der_frueheste_Eintrag()
    {
        var plan = Example<NinaPlanResponse>("plan.response");
        var transit = plan.Blocks.Single(b => b.Kind == BlocksKind.Transit);
        var regular = plan.Blocks.Single(b => b.Kind == BlocksKind.Regular);
        Assert.Equal(T("2026-09-18T02:05:30Z"), ReplanPolicy.PlannedStart(transit));
        Assert.Equal(T("2026-09-18T07:35:00Z"), ReplanPolicy.PlannedStart(regular));
    }

    [Fact]
    public void Im_Block_alle_15_Minuten()
    {
        Assert.False(ReplanPolicy.InBlockCheckDue(T("2026-09-18T07:35:00Z"), T("2026-09-18T07:49:59Z")));
        Assert.True(ReplanPolicy.InBlockCheckDue(T("2026-09-18T07:35:00Z"), T("2026-09-18T07:50:00Z")));
    }

    // ---- im Block: Fälle a/b/c ----------------------------------------------------------------------------

    private static (NinaTargets Before, NinaTargets After, RunningBlock Block) Night()
    {
        var before = Example<NinaTargets>("targets.response");
        var after = Example<NinaTargets>("targets.response");
        var deep = before.Projects.Single(p => p.Type == ProjectsType.Deep_sky);
        var panel = deep.Panels[0];
        var block = new RunningBlock(deep.Id, panel.Id, panel.Lines[0].Id, T("2026-09-18T09:20:01Z"));
        return (before, after, block);
    }

    private static Projects Deep(NinaTargets t) => t.Projects.Single(p => p.Type == ProjectsType.Deep_sky);

    private static Projects Exo(NinaTargets t) => t.Projects.Single(p => p.Type == ProjectsType.Exoplanet);

    public static TheoryData<string, Action<NinaTargets>, InBlockCase> InBlockCases() => new()
    {
        { "(c) Priorität geändert", t => Deep(t).Priority += 1, InBlockCase.NextBlock },
        { "(a) Projekt pausiert", t => Deep(t).Status = ProjectsStatus.On_hold, InBlockCase.TargetRemoved },
        { "(a) Projekt nicht mehr ausgeliefert", t => t.Projects.Remove(Deep(t)), InBlockCase.TargetRemoved },
        { "(a) Panel entfernt", t => Deep(t).Panels.Clear(), InBlockCase.TargetRemoved },
        { "(a) Zeile abgeschaltet", t => Deep(t).Panels[0].Lines[0].Enabled = false, InBlockCase.TargetRemoved },
        { "(a) Zeile gelöscht", t => Deep(t).Panels[0].Lines.Clear(), InBlockCase.TargetRemoved },
        { "(a) Zeile durch Korrektur fertig", t => Deep(t).Panels[0].Lines[0].Counts!.PlanningNeed = 0, InBlockCase.TargetRemoved },
        {
            "(c) Zeile durch eigene Aufnahmen fertig",
            t =>
            {
                Deep(t).Panels[0].Lines[0].Counts!.PlanningNeed = 0;
                Deep(t).Panels[0].Lines[0].Counts!.Acquired += 17;
            },
            InBlockCase.NextBlock
        },
        {
            "(b) Transit neu festgelegt, Fenster vor Blockende",
            t => Exo(t).Exoplanet!.Observation.WindowStartUtc = T("2026-09-18T08:30:00Z"),
            InBlockCase.TransitInterrupt
        },
        {
            "(c) Transit verschoben, Fenster samt Vorlauf erst nach Blockende",
            t => Exo(t).Exoplanet!.Observation.WindowStartUtc = T("2026-09-18T09:22:31Z"),
            InBlockCase.NextBlock
        },
        {
            "(b) Vorlauf 150 s reicht vor das Blockende",
            t => Exo(t).Exoplanet!.Observation.WindowStartUtc = T("2026-09-18T09:22:30Z"),
            InBlockCase.TransitInterrupt
        },
        {
            "(c) Transit nur angefragt, nicht festgelegt",
            t =>
            {
                Exo(t).Exoplanet!.Observation.Status = ObservationStatus.Requested;
                Exo(t).Exoplanet!.Observation.WindowStartUtc = T("2026-09-18T08:30:00Z");
            },
            InBlockCase.NextBlock
        },
    };

    [Theory]
    [MemberData(nameof(InBlockCases))]
    public void Im_Block(string name, Action<NinaTargets> change, InBlockCase expected)
    {
        var (before, after, block) = Night();
        change(after);
        Assert.True(expected == ReplanPolicy.InBlock(before, after, block, transitLeadS: 150), name);
    }

    [Fact]
    public void Unveraenderter_festgelegter_Transit_unterbricht_nicht()
    {
        // In der Beispielnacht ist der Transit schon im alten Stand festgelegt (Fenster 02:08–07:34).
        var (before, after, block) = Night();
        Assert.Equal(InBlockCase.NextBlock, ReplanPolicy.InBlock(before, after, block, 150));
    }

    // ---- Planwechsel --------------------------------------------------------------------------------------

    [Fact]
    public void Neuer_Blockindex_ist_der_erste_Block_mit_Ende_nach_jetzt()
    {
        var blocks = Example<NinaPlanResponse>("plan.response").Blocks;
        Assert.Equal(0, ReplanPolicy.NextBlockIndex(blocks, T("2026-09-18T02:00:00Z")));
        Assert.Equal(1, ReplanPolicy.NextBlockIndex(blocks, T("2026-09-18T07:34:00Z")));
        Assert.Equal(-1, ReplanPolicy.NextBlockIndex(blocks, T("2026-09-18T09:20:01Z")));
    }

    public static TheoryData<string, bool, bool, bool, bool, double, int, bool> SlewCases() => new()
    {
        // Name, gleiches Panel, geparkt, führt nach, unterbrochen, Abstand zur Position nach dem Zentrieren ′, Pause s, Slew entfällt
        { "gleiches Panel ohne Pause", true, false, true, false, 0.4, 0, true },
        { "anderes Panel", false, false, true, false, 0.4, 0, false },
        // Rig-Nacht 06.10.2026: Neuplanung 2 s nach dem Blockende, dann leerer Block und 4 min Warten auf die Sperre.
        { "kurze Pause", true, false, true, false, 0.4, 240, true },
        { "Pause über 5 min", true, false, true, false, 0.4, 301, false },
        { "geparkt", true, true, true, false, 0.4, 0, false },
        { "Nachführung aus", true, false, false, false, 0.4, 0, false },
        { "Safety-Unterbrechung", true, false, true, true, 0.4, 0, false },
        { "Abstand genau 1′", true, false, true, false, 1.0, 0, false },
    };

    [Theory]
    [MemberData(nameof(SlewCases))]
    public void Slew_entfaellt_nur_ohne_lange_Pause_Park_Unterbrechung_und_Drift(
        string name, bool samePanel, bool atPark, bool tracking, bool interrupted, double arcmin, int gapS, bool skip)
    {
        var next = Example<NinaPlanResponse>("plan.response").Blocks.Single(b => b.Kind == BlocksKind.Regular);
        var finishedEnd = next.StartUtc;
        var panel = samePanel ? next.PanelId!.Value : Guid.NewGuid();
        Assert.True(skip == ReplanPolicy.SkipSlew(next.ProjectId, panel, finishedEnd, next, finishedEnd.AddSeconds(gapS), atPark,
            tracking, interrupted, arcmin), name);
    }

    [Fact]
    public void Frist_vor_dem_Transit_Vorlauf_nur_fuer_regulaere_Bloecke_und_festgelegte_Transits()
    {
        // HAT-P-17 b: Fenster ab 02:08:00, Vorlauf 90 s + 60 s → Frist 02:05:30 (§5, NT-25).
        var targets = Example<NinaTargets>("targets.response");
        var regular = new Blocks { Kind = BlocksKind.Regular, StartUtc = T("2026-09-18T01:00:00Z") };
        Assert.Equal(T("2026-09-18T02:05:30Z"), ReplanPolicy.TransitDeadline(targets, regular, 150));
        // Der eigene Transitblock hat keine Frist; ein Block nach dem Fenster auch nicht.
        var obs = Exo(targets).Exoplanet!.Observation!;
        Assert.Null(ReplanPolicy.TransitDeadline(targets, new Blocks { Kind = BlocksKind.Transit, TransitObservationId = obs.Id }, 150));
        Assert.Null(ReplanPolicy.TransitDeadline(targets, new Blocks { Kind = BlocksKind.Regular, StartUtc = T("2026-09-18T08:00:00Z") }, 150));
        // Nur angefragt (nicht festgelegt): keine Frist.
        obs.Status = ObservationStatus.Requested;
        Assert.Null(ReplanPolicy.TransitDeadline(targets, regular, 150));
    }

    [Fact]
    public void Frist_schon_vorbei_zaehlt_nur_mit_offenem_Transitblock_im_Plan()
    {
        // Rig-Nacht 06./07.10.2026: WASP-3b-Serie endete um 00:55 (Mindesthöhe), das Fenster lief bis 01:07 – jeder Block
        // danach endete sofort mit transit_interrupt (212×). Fenster hier ab 02:08:00, Frist 02:05:30.
        var targets = Example<NinaTargets>("targets.response");
        var obs = Exo(targets).Exoplanet!.Observation!;
        var regular = new Blocks { Kind = BlocksKind.Regular, StartUtc = T("2026-09-18T01:00:00Z") };
        var before = T("2026-09-18T02:00:00Z");
        var after = T("2026-09-18T02:30:00Z");
        // Vor der Frist: wie bisher, unabhängig vom Plan.
        Assert.Equal(T("2026-09-18T02:05:30Z"), ReplanPolicy.TransitDeadline(targets, regular, 150, before, new HashSet<Guid>()));
        // Nach der Frist, Transit im Plan noch offen (z. B. Regelblock lief über): Frist bleibt → Wechsel zum Transit.
        Assert.Equal(T("2026-09-18T02:05:30Z"), ReplanPolicy.TransitDeadline(targets, regular, 150, after, new HashSet<Guid> { obs.Id }));
        // Nach der Frist, Transit gelaufen bzw. gestrichen: keine Frist mehr.
        Assert.Null(ReplanPolicy.TransitDeadline(targets, regular, 150, after, new HashSet<Guid>()));
    }

    [Fact]
    public void Pruefung_im_Block_in_der_Stunde_vor_einem_Fenster_alle_5_min()
    {
        var targets = Example<NinaTargets>("targets.response"); // Fenster ab 02:08:00
        Assert.Equal(TimeSpan.FromMinutes(15), ReplanPolicy.InBlockIntervalFor(targets, T("2026-09-18T01:07:00Z")));
        Assert.Equal(TimeSpan.FromMinutes(5), ReplanPolicy.InBlockIntervalFor(targets, T("2026-09-18T01:09:00Z")));
        Assert.Equal(TimeSpan.FromMinutes(15), ReplanPolicy.InBlockIntervalFor(targets, T("2026-09-18T02:09:00Z")));
        Assert.Equal(TimeSpan.FromMinutes(15), ReplanPolicy.InBlockIntervalFor(null, T("2026-09-18T01:09:00Z")));
    }
}
