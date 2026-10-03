using NinaPm.Core.Api.Generated;
using NinaPm.Core.Targets;

namespace NinaPm.Core.Status;

/// <summary>Zustand im Live-Status-Kopf (FA-NIN-13): Warten, Läuft, gesperrt (mit Grund), Beendet.</summary>
public enum LiveState
{
    Waiting,
    Running,
    Blocked,
    Finished,
}

/// <summary>Zeile der Blockliste „Heutige Ziele“.</summary>
public enum LiveBlockState
{
    Pending,
    Running,
    Done,
    Elapsed,
}

/// <summary>Block der Liste; <c>Start</c>/<c>End</c> in Standortzeit (NT-06, Offset aus dem Bootstrap), sonst UTC.</summary>
public sealed record LiveBlock(Guid Id, string Title, DateTimeOffset Start, DateTimeOffset End, LiveBlockState State, bool Transit);

/// <summary>Laufende bzw. zuletzt gestartete Belichtung des Blocks (Filter, Belichtung, Kameraeinstellungen).</summary>
public sealed record LiveExposure(string? Filter, double? ExposureS, int? Gain, int? Offset, int? Binning, string? ReadoutMode);

/// <summary>
/// Momentaufnahme für den Live-Status im Container (FA-NIN-13, AP-16h): Zustand, gesperrter Zustand mit Grund
/// (<c>blockedReasons</c>, execution.md §2), Ziel mit Koordinaten und Rotation, laufende Belichtung, Blockliste aus dem
/// gespeicherten Plan der Nacht, Outbox- und Dead-Letter-Zähler, Offline-Modus und das rote Banner
/// <em>Testbetrieb – Sicherheitsprüfungen aus</em> (§9). Die Ansicht zeigt nur an, sie rechnet nichts.
/// </summary>
public sealed record LiveStatus(
    LiveState State,
    string? BlockedReason,
    bool BlockedRecoverable,
    string? Target,
    double? RaDeg,
    double? DecDeg,
    double? RotationDeg,
    LiveExposure? Exposure,
    DateTimeOffset? NextBlock,
    IReadOnlyList<LiveBlock> Blocks,
    int OutboxPending,
    int DeadLetters,
    bool Offline,
    bool TestBanner)
{
    /// <summary>Vor dem ersten Planaufbau: keine Blöcke, „Plan wird beim Sequenzstart erstellt …“.</summary>
    public bool NoPlan => Blocks.Count == 0;
}

/// <summary>Eingaben des Live-Status (vom <c>NightRunner</c> gesammelt, in Tests frei gesetzt).</summary>
public sealed record LiveInputs(
    NinaPlanResponse? Plan,
    IReadOnlySet<Guid> Done,
    Blocks? Running,
    Entries? CurrentEntry,
    NinaTargets? Targets,
    NinaHeartbeatBlockedReason? Blocked,
    bool NightFinished,
    int OutboxPending,
    int DeadLetters,
    bool Offline,
    bool TestBanner,
    DateTimeOffset Now,
    NinaBootstrap? Bootstrap = null);

public static class LiveStatusBuilder
{
    public static LiveStatus Build(LiveInputs i)
    {
        DateTimeOffset Site(DateTimeOffset t) => i.Bootstrap is { } boot && Execution.SiteCheck.SiteOffset(boot, t) is { } o ? t.ToOffset(o) : t;
        var blocks = (i.Plan?.Blocks ?? []).Select(b => new LiveBlock(b.Id, TargetTitle.For(b, i.Targets), Site(b.StartUtc), Site(b.EndUtc),
            i.Running?.Id == b.Id ? LiveBlockState.Running
            : i.Done.Contains(b.Id) ? LiveBlockState.Done
            : b.EndUtc <= i.Now ? LiveBlockState.Elapsed
            : LiveBlockState.Pending,
            b.Kind == BlocksKind.Transit)).ToList();
        var state = i.NightFinished ? LiveState.Finished
            : i.Blocked is not null ? LiveState.Blocked
            : i.Running is not null ? LiveState.Running
            : LiveState.Waiting;
        var e = i.Running is null ? null : i.CurrentEntry;
        return new LiveStatus(
            state,
            i.Blocked is { } r ? Code(r) : null,
            i.Blocked is { } rr && Planning.NightLoop.Recoverable(rr),
            i.Running is { } run ? TargetTitle.For(run, i.Targets) : null,
            i.Running?.RaDeg,
            i.Running?.DecDeg,
            i.Running?.RotationDeg,
            e is null ? null : new LiveExposure(e.Filter, e.ExposureS, e.Gain, e.Offset, e.Binning, e.ReadoutMode),
            blocks.FirstOrDefault(b => b.State == LiveBlockState.Pending)?.Start,
            blocks,
            i.OutboxPending,
            i.DeadLetters,
            i.Offline,
            i.TestBanner);
    }

    /// <summary>Wert aus <c>blockedReasons</c> (enums.json), z. B. <c>lease_lost</c>.</summary>
    public static string Code(NinaHeartbeatBlockedReason reason) => reason.ToString().ToLowerInvariant();
}
