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
}

/// <summary>Simuliertes NINA beim Start (wie das Profil auf dem Testrechner, rig.json).</summary>
public sealed class SimSetup
{
    [JsonProperty("profileFilters")]
    public List<string> ProfileFilters { get; set; } = ["LUMINANCE", "RED", "GREEN", "BLUE", "HA", "SII", "OIII"];

    [JsonProperty("readoutModes")] public List<string> ReadoutModes { get; set; } = ["High Gain Mode", "Low Noise Mode"];
    [JsonProperty("cameraSetpointC")] public double CameraSetpointC { get; set; } = -10;
    [JsonProperty("ditherTrigger")] public bool DitherTrigger { get; set; }

    /// <summary>Sequenz beim Laufbeginn starten (sonst über einen Schritt <c>start</c>).</summary>
    [JsonProperty("autoStart")] public bool AutoStart { get; set; } = true;
}

/// <summary>
/// Schritt zur Minute <c>atMin</c>: <c>server</c> = Aktion des Test-Servers (<c>POST /test/actions</c>), sonst
/// <c>sim</c> = <c>start</c>, <c>stop</c> (Benutzer-Stopp), <c>crash</c> (NINA hart beendet), <c>unsafe</c>, <c>safe</c>,
/// <c>monitor_off</c>, <c>monitor_on</c>, <c>setpoint</c> (<c>value</c> °C), <c>filters</c>/<c>readout_modes</c>
/// (<c>names</c>), <c>network_down</c>, <c>network_up</c>.
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
