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
    public bool MonitorSafe { get; set; } = setup.SafeAtStart;

    /// <summary>NINAs <em>Loop While Safe</em>: getrennt zählt wie unsicher.</summary>
    public bool SafeNow => MonitorConnected && MonitorSafe;

    public bool Parked { get; set; } = true;
    public bool RotatorConnected { get; set; } = setup.RotatorConnected;
    public bool RotatorRangeQuarter { get; set; } = setup.RotatorRangeQuarter;
    public double? CameraAngleDeg { get; set; } = setup.CameraAngleDeg;
    public bool PierKnown { get; set; } = setup.PierKnown;
    public bool SolveAvailable { get; set; } = setup.SolveAvailable;
    public double MountFlipOffsetS { get; set; } = setup.MountFlipOffsetS;
    public double FlipDurationS { get; set; } = setup.FlipDurationS;
    public bool FlipTrigger { get; set; } = setup.FlipTrigger;
    public int? PcUtcOffsetMinutes { get; set; } = setup.PcUtcOffsetMinutes;
    public double CenterDelayS { get; set; } = setup.CenterDelayS;
    public double DitherSettleS { get; set; } = setup.DitherSettleS;
    public double CenterS { get; set; } = setup.CenterS;
    public List<string> CenterFailProjects { get; set; } = [.. setup.CenterFailProjects];
    public double CenterFailS { get; set; } = setup.CenterFailS;
    public bool Recenter { get; set; } = setup.Recenter;
    public bool AutoFocusAfterFlip { get; set; } = setup.AutoFocusAfterFlip;
    public bool AfTrigger { get; set; } = setup.AfTrigger;

    /// <summary>Montierung: Pier-Seite (<c>west</c> vor, <c>east</c> nach dem Flip) und früheste Flipzeit des Ziels.</summary>
    public string Pier { get; set; } = "west";
    public DateTimeOffset? EarliestFlipUtc { get; set; }
    public int Flips { get; set; }
    public bool NetworkDown { get; set; }

    /// <summary>Offline-Modus der Plugin-Optionen (bleibt über einen Neustart erhalten).</summary>
    public bool OfflineMode { get; set; }
    public int ImageCounter { get; set; }
}
