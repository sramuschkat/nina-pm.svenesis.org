using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Execution;

/// <summary>Ergebnis einer Belichtung (execution.md §4.3); Meldung an den Server folgt mit AP-16e.</summary>
public enum ExposureResult
{
    Saved,
    Aborted,
    Failed,

    /// <summary>Nicht begonnen, z. B. Filter oder Auslesemodus nicht gefunden (AP-16d).</summary>
    Skipped,
}

/// <summary>Ergebnis eines Zentrier-Versuchs (§4.1 Nr. 5).</summary>
public sealed record CenterResult(bool Success, string? Error = null);

/// <summary>
/// Was der Blockablauf von NINA braucht (TK 10.2, execution.md §4.1/§4.2). <c>NinaPm.Nina</c> setzt es auf NINAs
/// Mediatoren und den Trigger-Walk um, die Kern-Tests auf eine Attrappe. Alle Zeiten kommen aus <c>IClock</c>,
/// gewartet wird über <see cref="DelayAsync"/>, damit Tests ohne echte Wartezeit laufen.
/// </summary>
public interface IBlockHost
{
    /// <summary>Höhe und Dunkelheit jetzt erfüllt (§4.1 Nr. 3); im Testbetrieb (NIN-17) immer wahr.</summary>
    bool IsViableNow(Blocks block);

    /// <summary>Ziel setzen: Container-<c>Target</c>, Koordinaten in Center-after-Drift und eigene Trigger (§4.1 Nr. 4, NT-28).</summary>
    void SetTarget(Blocks block);

    /// <summary>
    /// Slew entfällt nach §3.2/NT-16 nur bei gleichem Projekt/Panel ohne Leerlauf, nicht geparkt, keine Unterbrechung,
    /// Abstand &lt; 1′ – der Adapter kennt Park-Zustand und Abstand.
    /// </summary>
    bool CanSkipSlew(Blocks block);

    /// <summary>Ein Versuch Slew + Zentrieren (mit Rotator <c>CenterAndRotate</c> auf <c>block.rotationDeg</c>).</summary>
    Task<CenterResult> SlewCenterAsync(Blocks block, CancellationToken token);

    /// <summary>Trigger-Set <em>vor Zielwechsel</em> (Vorfahren-Trigger, §4.1 Nr. 6; Trigger-Walk AP-16d).</summary>
    Task BeforeTargetChangeAsync(CancellationToken token);

    /// <summary>Trigger-Set <em>nach Zielwechsel</em> (§4.1 Nr. 7).</summary>
    Task AfterTargetChangeAsync(CancellationToken token);

    Task StartGuidingAsync(CancellationToken token);

    Task ChangeFilterAsync(Entries entry, CancellationToken token);

    /// <summary>Interne Belichtung (<c>IExposureItem</c>), Gain/Offset <c>null</c> → <c>-1</c> (NT-38).</summary>
    Task<ExposureResult> ExposeAsync(Blocks block, Entries entry, CancellationToken token);

    Task DitherAsync(CancellationToken token);

    /// <summary>
    /// Flip aktiv auslösen (NT-21, M3): ab <c>atUtc</c> warten, bis NINAs früheste Flipzeit erreicht ist, dann die
    /// Vorfahren-Trigger aufrufen. Einzelheiten (Erkennung, Dauer) AP-16f.
    /// </summary>
    Task MeridianFlipAsync(Blocks block, Entries entry, CancellationToken token);

    /// <summary>Wartet bis <paramref name="untilUtc"/> (10-s-Takt im Adapter); in Tests springt die Uhr.</summary>
    Task DelayAsync(DateTimeOffset untilUtc, CancellationToken token);
}
