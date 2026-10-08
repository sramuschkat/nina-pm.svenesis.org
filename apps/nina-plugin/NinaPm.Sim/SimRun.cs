using Newtonsoft.Json;

namespace NinaPm.Sim;

/// <summary>Ein kopfloser Lauf (<c>tools/nina-sim/runs/P-xx.json</c>): Szenario, Geräte, Schritte auf der Zeitachse.</summary>
public sealed class SimRun
{
    [JsonProperty("protocol")] public string Protocol { get; set; } = "";
    [JsonProperty("scenario")] public string Scenario { get; set; } = "";

    /// <summary>Laufende Zeit in Minuten nach dem Serverstart.</summary>
    [JsonProperty("untilMin")] public double UntilMin { get; set; } = 60;

    [JsonProperty("setup")] public SimSetup Setup { get; set; } = new();
    [JsonProperty("steps")] public List<SimStep> Steps { get; set; } = [];

    /// <summary>Sequenz „Mehrere Nächte“ (AP-52): Tagesschleife mit <em>Warten auf Zeit</em>; ohne Angabe „Eine Nacht“.</summary>
    [JsonProperty("dayLoop")] public SimDayLoop? DayLoop { get; set; }
}

/// <summary>
/// <em>NINA-PM Tagesschleife</em> mit <em>NINA-PM Warten auf Zeit</em> am Anfang jeder Runde (AP-52, P-23/P-24):
/// Enddatum (letzter Nacht-Schlüssel einschließlich), Höchstzahl Nächte, Quelle (<c>Time</c>, <c>CivilDusk</c>,
/// <c>NauticalDusk</c>, <c>AstronomicalDusk</c>), Uhrzeit <c>HH:mm</c> (Standortzeit), Versatz, Tageswechsel.
/// </summary>
public sealed class SimDayLoop
{
    [JsonProperty("endNight")] public string? EndNight { get; set; }
    [JsonProperty("maxNights")] public int MaxNights { get; set; } = 14;
    [JsonProperty("source")] public string Source { get; set; } = "NauticalDusk";
    [JsonProperty("time")] public string Time { get; set; } = "21:00";
    [JsonProperty("offsetMin")] public int OffsetMin { get; set; }
    [JsonProperty("rollover")] public string Rollover { get; set; } = "12:00";
}

/// <summary>Simuliertes NINA beim Start (wie das Profil auf dem Testrechner, rig.json).</summary>
public sealed class SimSetup
{
    [JsonProperty("profileFilters")]
    public List<string> ProfileFilters { get; set; } = ["LUMINANCE", "RED", "GREEN", "BLUE", "HA", "SII", "OIII"];

    [JsonProperty("readoutModes")] public List<string> ReadoutModes { get; set; } = ["High Gain Mode", "Low Noise Mode"];
    [JsonProperty("cameraSetpointC")] public double CameraSetpointC { get; set; } = -10;
    [JsonProperty("ditherTrigger")] public bool DitherTrigger { get; set; }

    /// <summary>Rotator verbunden (Rig mit Rotator: NINAs CenterAndRotate; sonst Winkelprüfung per Plate-Solve).</summary>
    [JsonProperty("rotatorConnected")] public bool RotatorConnected { get; set; } = true;

    /// <summary>RotatorSettings.RangeType = QUARTER (M2).</summary>
    [JsonProperty("rotatorRangeQuarter")] public bool RotatorRangeQuarter { get; set; }

    /// <summary>Kamerawinkel ohne Rotator (Grad); <c>null</c> = genau der Soll-Winkel des Blocks.</summary>
    [JsonProperty("cameraAngleDeg")] public double? CameraAngleDeg { get; set; }

    /// <summary>Pier-Seite meldet die Montierung (sonst <c>null</c>, Rückfall über Plate-Solve).</summary>
    [JsonProperty("pierKnown")] public bool PierKnown { get; set; } = true;

    /// <summary>Plate-Solve verfügbar.</summary>
    [JsonProperty("solveAvailable")] public bool SolveAvailable { get; set; } = true;

    /// <summary>Früheste Flipzeit der Montierung gegenüber der Engine (Sekunden, + = später).</summary>
    [JsonProperty("mountFlipOffsetS")] public double MountFlipOffsetS { get; set; }

    /// <summary>Dauer eines Flips in der Montierung (Sekunden).</summary>
    [JsonProperty("flipDurationS")] public double FlipDurationS { get; set; } = 200;

    /// <summary>Meridian-Flip-Trigger in der Sequenz.</summary>
    [JsonProperty("flipTrigger")] public bool FlipTrigger { get; set; } = true;

    /// <summary>UTC-Offset der PC-Zeitzone in Minuten; <c>null</c> = wie der Standort.</summary>
    [JsonProperty("pcUtcOffsetMinutes")] public int? PcUtcOffsetMinutes { get; set; }

    /// <summary>Standort des NINA-Profils <c>[Breite, Länge]</c> (FA-NIN-03); Standard Starfront wie der Rig-Standort.</summary>
    [JsonProperty("profileLocation")] public double[] ProfileLocation { get; set; } = [31.5471, -99.3823];

    /// <summary>Zusätzliche Dauer des ersten Zentrierens je Block (Sekunden, P-21 „Zentrieren verzögert“).</summary>
    [JsonProperty("centerDelayS")] public double CenterDelayS { get; set; }

    /// <summary>Settle-Zeit von PHD2 nach einem Dither (Sekunden; Starfront gemessen p50 ≈ 18 s).</summary>
    [JsonProperty("ditherSettleS")] public double DitherSettleS { get; set; } = 10;

    /// <summary>Dauer von Slew und Zentrieren (Sekunden; Starfront gemessen p50 ≈ 35 s).</summary>
    [JsonProperty("centerS")] public double CenterS { get; set; } = 60;

    /// <summary>
    /// Projekte (Anzeigename aus <c>/targets</c>, z. B. <c>Test badcoords</c>), deren Zentrieren immer scheitert – wie
    /// falsche Zielkoordinaten (Starfront 04.09.2026); jeder Versuch kostet <see cref="CenterFailS"/>.
    /// </summary>
    [JsonProperty("centerFailProjects")] public List<string> CenterFailProjects { get; set; } = [];

    /// <summary>Dauer eines gescheiterten Zentrierversuchs (NINA mit 10 Plate-Solves ≈ 2 min).</summary>
    [JsonProperty("centerFailS")] public double CenterFailS { get; set; } = 120;

    /// <summary>Safety-Monitor beim Start sicher (Starfront: Dach tagsüber zu → <c>false</c>).</summary>
    [JsonProperty("safeAtStart")] public bool SafeAtStart { get; set; } = true;

    /// <summary>NINA-Profil: nach dem Flip neu zentrieren (NT-22; Server-Alarm <c>recenter_after_flip_on</c>).</summary>
    [JsonProperty("recenter")] public bool Recenter { get; set; }

    /// <summary>NINA-Profil: Autofokus nach dem Flip (Zusatz „AF nach Flip aktiv“ bei <c>flip_in_transit</c>).</summary>
    [JsonProperty("autoFocusAfterFlip")] public bool AutoFocusAfterFlip { get; set; }

    /// <summary>Trigger <c>AutofocusAfterTimeTrigger</c> in der Sequenz (im Transit unterdrückt, P-14).</summary>
    [JsonProperty("afTrigger")] public bool AfTrigger { get; set; }

    /// <summary>
    /// Mit <see cref="AfTrigger"/>: NINAs <em>Autofokus nach Zeit</em> läuft vor einer Belichtung, wenn seit dem letzten
    /// Autofokus so viele Minuten vergangen sind (0 = nie), und dauert <see cref="AfDurationS"/> (Rig-Zeiten-Lauf 05.10.2026).
    /// </summary>
    [JsonProperty("afEveryMin")] public double AfEveryMin { get; set; }

    /// <summary>Dauer eines Autofokus (Starfront gemessen 2–5 min).</summary>
    [JsonProperty("afDurationS")] public double AfDurationS { get; set; } = 180;

    /// <summary>
    /// Montierung meldet die neue Pier-Seite erst so viele Sekunden nach NINAs Flip (ASI-Montierung am Starfront-Rig,
    /// Rig-Nacht 07./08.10.2026; AP-68).
    /// </summary>
    [JsonProperty("pierReportDelayS")] public double PierReportDelayS { get; set; }

    /// <summary>
    /// Autofokus im Start-Bereich der Sequenz bei jedem Start (NT-24, ohne Dauer). <c>false</c>: kein Autofokus vorher – das
    /// Plugin fokussiert dann vor dem ersten Block selbst (AP-68).
    /// </summary>
    [JsonProperty("startAutofocus")] public bool StartAutofocus { get; set; } = true;

    /// <summary>NINA-Profil: Pause vor dem Meridian in Minuten (Starfront 5), an den Server gemeldet.</summary>
    [JsonProperty("flipPauseBeforeMin")] public double FlipPauseBeforeMin { get; set; }

    /// <summary>
    /// Inhalt der Flat-Box <em>Je Kombination</em> (AP-50): <c>trained</c> (Trained Flat + Trained Dark Flat Exposure),
    /// <c>trained_no_darks</c>, <c>auto</c> (Auto Exposure Flat, Anzahl offen) oder <c>none</c> (leere Box, keine Flats).
    /// </summary>
    [JsonProperty("flatBox")] public string FlatBox { get; set; } = "trained";

    /// <summary>Filterposition je NINA-Filtername beim letzten Flat-Lauf (NT-39, P-33: Filter im Profil umgesteckt).</summary>
    [JsonProperty("lastFlatPositions")] public Dictionary<string, int>? LastFlatPositions { get; set; }

    /// <summary>Mittelwert der Flats als Anteil am Vollausschlag (P-33: 0,95 = zu lange belichtet).</summary>
    [JsonProperty("flatMeanShare")] public double FlatMeanShare { get; set; } = 0.45;

    /// <summary>Sequenz beim Laufbeginn starten (sonst über einen Schritt <c>start</c>).</summary>
    [JsonProperty("autoStart")] public bool AutoStart { get; set; } = true;
}

/// <summary>
/// Schritt zur Minute <c>atMin</c>: <c>server</c> = Aktion des Test-Servers (<c>POST /test/actions</c>), sonst
/// <c>sim</c> = <c>start</c>, <c>stop</c> (Benutzer-Stopp), <c>crash</c> (NINA hart beendet), <c>unsafe</c>, <c>safe</c>,
/// <c>monitor_off</c>, <c>monitor_on</c>, <c>setpoint</c> (<c>value</c> °C), <c>filters</c>/<c>readout_modes</c>
/// (<c>names</c>), <c>network_down</c>, <c>network_up</c>, <c>offline_on</c>, <c>offline_off</c> (Offline-Modus).
/// </summary>
public sealed class SimStep
{
    [JsonProperty("atMin")] public double AtMin { get; set; }
    [JsonProperty("server")] public string? Server { get; set; }
    [JsonProperty("seconds")] public int? Seconds { get; set; }

    /// <summary>Projektname für <c>pause_project</c> (Szenario-Projekt, z. B. <c>ngc7000</c>).</summary>
    [JsonProperty("project")] public string? Project { get; set; }
    [JsonProperty("sim")] public string? Sim { get; set; }
    [JsonProperty("value")] public double? Value { get; set; }
    [JsonProperty("names")] public List<string>? Names { get; set; }
}
