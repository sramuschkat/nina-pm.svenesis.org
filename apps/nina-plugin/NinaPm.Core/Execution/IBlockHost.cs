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

/// <summary>Kühlung der Kamera jetzt (NT-E2): Kühler an und Sensortemperatur (<c>null</c> = unbekannt).</summary>
public sealed record CameraCooling(bool CoolerOn, double? TemperatureC);

/// <summary>Ergebnis eines Zentrier-Versuchs (§4.1 Nr. 5).</summary>
public sealed record CenterResult(bool Success, string? Error = null);

/// <summary>Eigenes Plate-Solve (flip-rotation.md §3, NIN-4): Positionswinkel in Grad (<c>null</c> = kein Solve) und gespiegelte Optik (NT-33).</summary>
public sealed record SolveReading(double? PositionAngleDeg, bool Mirrored = false);

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

    /// <summary>
    /// Ein Versuch Slew + Zentrieren: mit verbundenem Rotator und <paramref name="rotate"/> <c>CenterAndRotate</c> auf
    /// <c>block.rotationDeg</c>, sonst <c>Center</c> (nach dem Flip immer <c>Center</c>, NT-E4).
    /// </summary>
    Task<CenterResult> SlewCenterAsync(Blocks block, bool rotate, CancellationToken token);

    /// <summary>Rotator verbunden (sonst Winkelprüfung über eigenes Plate-Solve, NT-29).</summary>
    bool RotatorConnected { get; }

    /// <summary>NINA-Profil <c>MeridianFlipSettings.Recenter</c> (NT-22: ohne Rotator dann kein eigenes Zentrieren nach dem Flip).</summary>
    bool NinaRecentersAfterFlip { get; }

    /// <summary>Pier-Seite nach fester ASCOM-Zuordnung (<c>west</c>/<c>east</c>), <c>null</c> = unbekannt (NT-34).</summary>
    string? PierSide();

    /// <summary>
    /// Minuten bis NINAs früheste Flipzeit (<c>minimumTimeRemaining</c> aus <c>TelescopeInfo.TimeToMeridianFlip</c> wie
    /// <c>MeridianFlipTrigger</c>); ≤ 0 = erreicht, <c>null</c> = unbekannt (keine Montierung).
    /// </summary>
    double? MinutesToEarliestFlip();

    /// <summary>Trigger aller Vorfahren über die eigene Iteration (Dither unterdrückt) – zur Flipzeit, auch ohne Belichtung (M1).</summary>
    Task RunTriggersAsync(CancellationToken token);

    /// <summary>Eigenes Plate-Solve am aktuellen Ort (Winkelprüfung, Flip-Rückfall).</summary>
    Task<SolveReading> SolveAsync(CancellationToken token);

    /// <summary>Trigger-Set <em>vor Zielwechsel</em> (Vorfahren-Trigger, §4.1 Nr. 6; Trigger-Walk AP-16d).</summary>
    Task BeforeTargetChangeAsync(CancellationToken token);

    /// <summary>Trigger-Set <em>nach Zielwechsel</em> (§4.1 Nr. 7).</summary>
    Task AfterTargetChangeAsync(CancellationToken token);

    Task StartGuidingAsync(CancellationToken token);

    Task ChangeFilterAsync(Entries entry, CancellationToken token);

    /// <summary>
    /// Interne Belichtung (<c>IExposureItem</c>), Gain/Offset <c>null</c> → <c>-1</c> (NT-38); die Aufnahme wird mit
    /// <paramref name="temperatureDeviation"/> gemeldet (NT-E2).
    /// </summary>
    Task<ExposureResult> ExposeAsync(Blocks block, Entries entry, bool temperatureDeviation, CancellationToken token);

    /// <summary>Kühlung jetzt (Kühler an, Sensortemperatur) für die Prüfung vor Blockstart und vor jeder Belichtung.</summary>
    CameraCooling ReadCooling();

    Task DitherAsync(CancellationToken token);

    /// <summary>Wartet bis <paramref name="untilUtc"/> (10-s-Takt im Adapter); in Tests springt die Uhr.</summary>
    Task DelayAsync(DateTimeOffset untilUtc, CancellationToken token);
}
