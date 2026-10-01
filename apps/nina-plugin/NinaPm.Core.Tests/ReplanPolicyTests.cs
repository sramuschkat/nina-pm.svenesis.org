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
        { "neues ETag vor dem Blockstart", "\"t-1\"", "\"t-2\"", 7, 7, "2026-09-18T07:35:00Z", "2026-09-18T07:30:00Z", true, RefreshCause.TargetsChanged, "2026-09-18T07:35:00Z" },
        { "settingsVersion gestiegen", "\"t-1\"", "\"t-1\"", 7, 8, "2026-09-18T07:35:00Z", "2026-09-18T07:36:00Z", true, RefreshCause.SettingsChanged, "2026-09-18T07:36:00Z" },
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

    public static TheoryData<string, bool, bool, bool, double, int, bool> SlewCases() => new()
    {
        // Name, gleiches Panel, geparkt, unterbrochen, Abstand ′, Lücke s, Slew entfällt
        { "gleiches Panel ohne Leerlauf", true, false, false, 0.4, 0, true },
        { "anderes Panel", false, false, false, 0.4, 0, false },
        { "Leerlauf dazwischen", true, false, false, 0.4, 60, false },
        { "geparkt", true, true, false, 0.4, 0, false },
        { "Safety-Unterbrechung", true, false, true, 0.4, 0, false },
        { "Abstand genau 1′", true, false, false, 1.0, 0, false },
    };

    [Theory]
    [MemberData(nameof(SlewCases))]
    public void Slew_entfaellt_nur_ohne_Leerlauf_Park_Unterbrechung_und_Drift(
        string name, bool samePanel, bool atPark, bool interrupted, double arcmin, int gapS, bool skip)
    {
        var next = Example<NinaPlanResponse>("plan.response").Blocks.Single(b => b.Kind == BlocksKind.Regular);
        var finishedEnd = next.StartUtc.AddSeconds(-gapS);
        var panel = samePanel ? next.PanelId!.Value : Guid.NewGuid();
        Assert.True(skip == ReplanPolicy.SkipSlew(next.ProjectId, panel, finishedEnd, next, atPark, interrupted, arcmin), name);
    }
}
