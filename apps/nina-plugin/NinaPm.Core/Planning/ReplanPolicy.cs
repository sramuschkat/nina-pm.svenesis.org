using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Planning;

/// <summary>Warum vor einem Block neu geplant wird (execution.md §3.2).</summary>
public enum RefreshCause
{
    TargetsChanged,
    SettingsChanged,
    BehindPlan,

    /// <summary>
    /// Lücke vor dem nächsten Block (&gt; 5 min) nach einem Block dieser Nacht – z. B. ein Projekt war vor dem Ende seines
    /// Laufs fertig und die Engine gab den Rest frei (<c>idle_gap</c>, allocation.md A-29). Einmal je Plan.
    /// </summary>
    IdleAhead,

    /// <summary>
    /// Block ohne Belichtung beendet, weil nach Slew und Zentrieren keine mehr vor das Blockende passte (Rig-Nacht
    /// 06.10.2026) – sofort ab jetzt neu planen statt nach der 5-min-Sperre erneut anzufahren. Einmal je Einheit.
    /// </summary>
    EmptyBlock,

    /// <summary>
    /// Mehr als 3 zeitgeführt übersprungene Belichtungen in einem Block (execution.md §4.2): der Block endet mit
    /// <c>replanned</c>, der Container plant sofort ab jetzt neu (Plugin 0.4.18).
    /// </summary>
    SkippedExposures,

    /// <summary>
    /// Lücke vor dem nächsten Block nach einem übersprungenen Block (<c>block_skipped</c>, AP-71): einmal je übersprungenem
    /// Block, auch wenn der Plan schon aus einer <see cref="IdleAhead"/>-Neuplanung stammt (Rig-Nacht 08./09.10.2026: 12 min
    /// Leerlauf nach dem zweiten <c>elapsed</c>).
    /// </summary>
    SkippedBlock,
}

/// <summary>Entscheidung vor einem Block: Plan behalten oder <c>POST /plan {reason: refresh, startAtUtc = jetzt}</c>.</summary>
public sealed record BeforeBlockDecision(bool Refresh, RefreshCause? Cause, DateTimeOffset? StartAtUtc)
{
    public static readonly BeforeBlockDecision Keep = new(false, null, null);
}

/// <summary>Fälle beim Neuplanen im laufenden Block (execution.md §3.2).</summary>
public enum InBlockCase
{
    /// <summary>Kein neues ETag – nichts zu tun.</summary>
    None,

    /// <summary>(a) Projekt/Panel/Zeile entfällt: Belichtung zu Ende, <c>block_end target_removed</c>, neu ab jetzt.</summary>
    TargetRemoved,

    /// <summary>(b) neuer/geänderter <c>locked</c> Transit beginnt (inkl. Vorlauf) vor Blockende: Transit-Unterbrechung.</summary>
    TransitInterrupt,

    /// <summary>(c) übrige Änderung: Block behält seine Einträge, neuer Plan ab dem nächsten Block.</summary>
    NextBlock,
}

/// <summary>Was im laufenden Block gerade belichtet wird (für Fall a).</summary>
public sealed record RunningBlock(Guid ProjectId, Guid PanelId, Guid? ExposureLineId, DateTimeOffset EndUtc, Guid? TransitObservationId = null);

/// <summary>
/// Neuplanung mit Hysterese (FA-SYN-03, execution.md §3.2, TK 10.3 Nr. 3) als reine Logik: vor jedem Block nur bei
/// neuem Targets-ETag, gestiegener <c>settingsVersion</c> oder Verzug &gt; 10 min; im Block alle 15 min mit den
/// Fällen a/b/c; Blockindex und Slew-Entfall nach einem Planwechsel (NT-16, NT-18).
/// </summary>
public static class ReplanPolicy
{
    public static readonly TimeSpan MaxDelay = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan InBlockInterval = TimeSpan.FromMinutes(15);

    /// <summary>Höchstabstand Montierung ↔ Soll, unter dem nach einem Planwechsel nicht neu zentriert wird (NT-16).</summary>
    public const double SlewSkipArcmin = 1.0;

    /// <summary>
    /// Geplanter Blockstart: <c>startUtc</c>, bei Transitblöcken der früheste Eintrag (<c>min(atUtc)</c>, NT-25),
    /// weil der Slew-Vorlauf vor dem Fenster liegt.
    /// </summary>
    public static DateTimeOffset PlannedStart(Blocks block) =>
        block.Kind == BlocksKind.Transit && block.Entries.Count > 0
            ? block.Entries.Min(e => e.AtUtc)
            : block.StartUtc;

    public static BeforeBlockDecision BeforeBlock(
        string? planTargetsEtag,
        string? currentTargetsEtag,
        int planSettingsVersion,
        int currentSettingsVersion,
        DateTimeOffset plannedBlockStart,
        DateTimeOffset now)
    {
        RefreshCause? cause =
            currentTargetsEtag is not null && NinaApi.OpaqueEtag(currentTargetsEtag) != NinaApi.OpaqueEtag(planTargetsEtag) ? RefreshCause.TargetsChanged
            : currentSettingsVersion > planSettingsVersion ? RefreshCause.SettingsChanged
            : now - plannedBlockStart > MaxDelay ? RefreshCause.BehindPlan
            : null;
        if (cause is null) return BeforeBlockDecision.Keep;
        // Ab jetzt, nicht ab dem geplanten Blockstart (Analyse 05.10.2026): sonst bliebe eine Lücke davor leer, obwohl
        // andere Projekte Arbeit hätten (VM-Lauf real-full-night: 10 von 40 min).
        return new BeforeBlockDecision(true, cause, now);
    }

    /// <summary>Mindestlücke vor dem nächsten Block für <see cref="RefreshCause.IdleAhead"/>.</summary>
    public static readonly TimeSpan IdleRefreshMin = TimeSpan.FromMinutes(5);

    /// <summary>
    /// <see cref="RefreshCause.IdleAhead"/>: nach einem Block dieser Nacht liegt der nächste Block mehr als
    /// <see cref="IdleRefreshMin"/> in der Zukunft, und der Plan stammt nicht schon aus einer solchen Neuplanung (sonst
    /// plante das Plugin in einer echten Pause alle 5 min neu).
    /// </summary>
    public static bool IdleAhead(DateTimeOffset plannedBlockStart, DateTimeOffset now, bool blockRanTonight, bool planFromIdleRefresh) =>
        blockRanTonight && !planFromIdleRefresh && plannedBlockStart - now > IdleRefreshMin;

    /// <summary>
    /// Grund der Neuplanung vor einer Lücke (&gt; <see cref="IdleRefreshMin"/>): <see cref="RefreshCause.SkippedBlock"/>, wenn seit
    /// der letzten Neuplanung ein Block übersprungen wurde (gilt auch für einen Plan aus einer Lücken-Neuplanung), sonst
    /// <see cref="RefreshCause.IdleAhead"/> nach <see cref="IdleAhead"/>; <c>null</c> = Plan behalten.
    /// </summary>
    /// <summary>
    /// Überspring-Gründe, nach denen <see cref="RefreshCause.SkippedBlock"/> neu plant (AP-71): Block vorbei, gerade nicht
    /// machbar, Zentrieren gescheitert. Fehlt ein Filter oder Auslesemodus, enthielte der neue Plan denselben Block.
    /// </summary>
    public static bool SkipReplans(string skipReason) => skipReason is "elapsed" or "not_viable" or "center_failed";

    public static RefreshCause? IdleRefresh(DateTimeOffset plannedBlockStart, DateTimeOffset now, bool blockRanTonight,
        bool planFromIdleRefresh, bool skippedSinceRefresh)
    {
        if (plannedBlockStart - now <= IdleRefreshMin) return null;
        if (skippedSinceRefresh) return RefreshCause.SkippedBlock;
        return IdleAhead(plannedBlockStart, now, blockRanTonight, planFromIdleRefresh) ? RefreshCause.IdleAhead : null;
    }

    /// <summary>
    /// <see cref="RefreshCause.EmptyBlock"/>: Der Block lief an (Slew, Zentrieren), endete aber <c>completed</c> ohne
    /// Belichtung. Nicht erneut für dieselbe Einheit, solange dazwischen keine Belichtung gelang
    /// (<paramref name="lastEmptyUnit"/>) – sonst plante das Plugin ohne Sperre im Kreis.
    /// </summary>
    public static bool EmptyBlock(bool started, string reason, int exposures, string unit, string? lastEmptyUnit) =>
        started && exposures == 0 && reason == "completed" && unit != lastEmptyUnit;

    /// <summary>Im Block: <c>GET /targets</c> alle 15 min (erster Abruf 15 min nach Blockbeginn).</summary>
    public static bool InBlockCheckDue(DateTimeOffset lastCheckUtc, DateTimeOffset now) => now - lastCheckUtc >= InBlockInterval;

    /// <summary>
    /// Fall a/b/c im laufenden Block. <paramref name="previous"/> sind die Targets, nach denen der laufende Plan
    /// gebaut wurde; <paramref name="transitLeadS"/> der Slew-Vorlauf vor einem Transitfenster (Zentrieren + 60 s).
    /// </summary>
    public static InBlockCase InBlock(NinaTargets previous, NinaTargets current, RunningBlock block, double transitLeadS)
    {
        if (Removed(previous, current, block)) return InBlockCase.TargetRemoved;
        if (NewLockedTransitBefore(previous, current, block, transitLeadS)) return InBlockCase.TransitInterrupt;
        return InBlockCase.NextBlock;
    }

    /// <summary>
    /// (a): Projekt fehlt (gelöscht, Auslieferung aus) oder ist nicht mehr <c>active</c>, das Panel fehlt, die Zeile
    /// fehlt oder ist abgeschaltet, oder sie ist durch eine Korrektur fertig geworden (<c>planningNeed</c> fällt auf 0,
    /// ohne dass neue Aufnahmen dazukamen – eigene Aufnahmen beenden den Block nicht).
    /// </summary>
    private static bool Removed(NinaTargets previous, NinaTargets current, RunningBlock block)
    {
        var project = current.Projects.FirstOrDefault(p => p.Id == block.ProjectId);
        if (project is null || project.Status != ProjectsStatus.Active) return true;
        var panel = project.Panels.FirstOrDefault(p => p.Id == block.PanelId);
        if (panel is null) return true;
        if (block.ExposureLineId is not { } lineId || project.Type != ProjectsType.Deep_sky) return false;

        var line = panel.Lines.FirstOrDefault(l => l.Id == lineId);
        if (line is null || line.Enabled == false) return true;
        var before = previous.Projects.FirstOrDefault(p => p.Id == block.ProjectId)?.Panels
            .FirstOrDefault(p => p.Id == block.PanelId)?.Lines.FirstOrDefault(l => l.Id == lineId);
        return line.Counts is { PlanningNeed: 0 } now
            && before?.Counts is { PlanningNeed: > 0 } was
            && now.Acquired == was.Acquired;
    }

    /// <summary>(b): neuer oder geänderter <c>locked</c> Transit, dessen Fenster samt Vorlauf vor Blockende beginnt.</summary>
    private static bool NewLockedTransitBefore(NinaTargets previous, NinaTargets current, RunningBlock block, double transitLeadS)
    {
        foreach (var p in current.Projects)
        {
            var obs = p.Exoplanet?.Observation;
            if (obs is null || obs.Status != ObservationStatus.Locked) continue;
            if (obs.Id == block.TransitObservationId) continue;
            var old = previous.Projects.FirstOrDefault(x => x.Id == p.Id)?.Exoplanet?.Observation;
            var changed = old is null || old.Id != obs.Id || old.Status != ObservationStatus.Locked
                || old.WindowStartUtc != obs.WindowStartUtc || old.WindowEndUtc != obs.WindowEndUtc;
            if (changed && obs.WindowStartUtc.AddSeconds(-transitLeadS) < block.EndUtc) return true;
        }
        return false;
    }

    /// <summary>
    /// Frist für Belichtungen eines regulären Blocks (execution.md §5): Beginn des Vorlaufs
    /// (<c>windowStart − leadS</c>) des frühesten festgelegten Transits, dessen Fenster noch nicht vorbei ist – außer dem
    /// eigenen. Im Transitblock selbst keine Frist. Ohne festgelegten Transit <c>null</c>.
    /// <para>Mit <paramref name="now"/> (Plugin 0.4.11, Rig-Nacht 06./07.10.2026): Ein Transit, dessen Frist schon vorbei
    /// ist, zählt nur noch, wenn er im aktuellen Plan als offener Transitblock steht (<paramref name="pendingTransits"/>).
    /// Ist er gelaufen oder vom Server gestrichen – WASP-3b endete wegen der Mindesthöhe um 00:55, das Fenster erst
    /// 01:07 –, passte sonst keine Belichtung mehr davor: <c>transit_interrupt</c>, Neuplanung, wieder Abbruch, 212-mal.
    /// Einen <b>neu</b> festgelegten Transit meldet weiterhin die Prüfung im Block (Fall b).</para>
    /// </summary>
    public static DateTimeOffset? TransitDeadline(NinaTargets? targets, Blocks block, double leadS,
        DateTimeOffset? now = null, IReadOnlySet<Guid>? pendingTransits = null)
    {
        if (targets is null || block.Kind == BlocksKind.Transit) return null;
        DateTimeOffset? deadline = null;
        foreach (var p in targets.Projects)
        {
            var obs = p.Exoplanet?.Observation;
            if (obs is null || obs.Status != ObservationStatus.Locked || obs.Id == block.TransitObservationId) continue;
            if (obs.WindowEndUtc <= block.StartUtc) continue;
            var start = obs.WindowStartUtc.AddSeconds(-leadS);
            if (now is { } n && start <= n && pendingTransits?.Contains(obs.Id) != true) continue;
            if (deadline is null || start < deadline) deadline = start;
        }
        return deadline;
    }

    /// <summary>Prüfung im Block in der letzten Stunde vor einem Transitfenster alle 5 min statt 15 min (§5).</summary>
    public static readonly TimeSpan InBlockIntervalNearTransit = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Abstand der Prüfungen im Block: 5 min, wenn ein Transit (festgelegt oder angefragt) innerhalb der nächsten Stunde
    /// beginnt – eine kurzfristige Festlegung fällt so rechtzeitig auf –, sonst 15 min.
    /// </summary>
    public static TimeSpan InBlockIntervalFor(NinaTargets? targets, DateTimeOffset now)
    {
        foreach (var p in targets?.Projects ?? [])
            if (p.Exoplanet?.Observation is { } obs && obs.WindowStartUtc > now && obs.WindowStartUtc - now <= TimeSpan.FromHours(1))
                return InBlockIntervalNearTransit;
        return InBlockInterval;
    }

    /// <summary>Neuer Blockindex nach einem Planwechsel: erster Block mit <c>endUtc &gt; now</c> (NT-18), sonst -1.</summary>
    public static int NextBlockIndex(IReadOnlyList<Blocks> blocks, DateTimeOffset now)
    {
        for (var i = 0; i < blocks.Count; i++)
            if (blocks[i].EndUtc > now) return i;
        return -1;
    }

    /// <summary>Höchste Pause seit dem Ende des zuletzt zentrierten Blocks, nach der der Slew noch entfallen darf.</summary>
    public static readonly TimeSpan SlewSkipIdleMax = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Slew entfällt nach einem Planwechsel nur bei demselben Projekt/Panel, höchstens <see cref="SlewSkipIdleMax"/> nach
    /// dem Ende des zuletzt zentrierten Blocks, wenn seit dem Zentrieren weder geparkt noch unterbrochen wurde, die
    /// Montierung nachführt und &lt; 1′ von ihrer Position nach dem Zentrieren steht (NT-16; Spec-Ergänzung 06.10.2026:
    /// vorher „ohne Leerlauf“ und Abstand zur Zielkoordinate – mit NINAs Zentrieren ohne Sync steht die Montierung um
    /// ihren Zeigefehler daneben, am Starfront-Rig ≈ 22′, und fuhr bei jeder Neuplanung neu an).
    /// </summary>
    public static bool SkipSlew(
        Guid finishedProjectId,
        Guid finishedPanelId,
        DateTimeOffset finishedEndUtc,
        Blocks next,
        DateTimeOffset now,
        bool atPark,
        bool tracking,
        bool interruptedSinceCenter,
        double offsetArcmin) =>
        next.ProjectId == finishedProjectId
        && next.PanelId == finishedPanelId
        && now - finishedEndUtc <= SlewSkipIdleMax
        && !atPark
        && tracking
        && !interruptedSinceCenter
        && offsetArcmin < SlewSkipArcmin;
}
