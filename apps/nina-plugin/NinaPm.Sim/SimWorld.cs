namespace NinaPm.Sim;

/// <summary>
/// Die simulierten Geräte und das NINA-Profil – überdauern einen Absturz des simulierten NINA (wie die echte Hardware).
/// </summary>
public sealed class SimWorld(SimSetup setup)
{
    public List<string> ProfileFilters { get; set; } = [.. setup.ProfileFilters];
    public List<string> ReadoutModes { get; set; } = [.. setup.ReadoutModes];
    public double CameraSetpointC { get; set; } = setup.CameraSetpointC;

    /// <summary>Sensortemperatur folgt dem Sollwert sofort (der Kamera-Simulator kühlt in Sekunden).</summary>
    public double CameraTemperatureC => CameraSetpointC;

    public bool CoolerOn { get; set; } = true;
    public bool DitherTrigger { get; set; } = setup.DitherTrigger;
    public bool MonitorConnected { get; set; } = true;
    public bool MonitorSafe { get; set; } = true;

    /// <summary>NINAs <em>Loop While Safe</em>: getrennt zählt wie unsicher.</summary>
    public bool SafeNow => MonitorConnected && MonitorSafe;

    public bool Parked { get; set; } = true;
    public bool NetworkDown { get; set; }
    public int ImageCounter { get; set; }
}
