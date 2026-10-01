namespace NinaPm.Core.Abstractions;

// Schnittstellen des Kerns zu NINA (TK 10.1, 10.2): NinaPm.Nina setzt sie auf NINAs Mediatoren um, die Kern-Tests
// auf Attrappen. AP-16a legt das Gerüst an; AP-16b…16f ergänzen die Glieder, die der Plan-Ablauf braucht.

/// <summary>Pierseite nach ASCOM-Pointing-State (NT-34): <c>west</c> vor, <c>east</c> nach dem Flip, sonst unbekannt.</summary>
public enum PierSide
{
    Unknown,
    West,
    East,
}

/// <summary>Montierung (Slew, Pierseite, Sternzeit) – NINA <c>ITelescopeMediator</c>.</summary>
public interface IMountControl
{
    bool Connected { get; }

    PierSide PierSide { get; }

    /// <summary>Lokale Sternzeit der Montierung in Stunden (Heartbeat <c>mount.siderealTimeDeltaS</c>, NT-22).</summary>
    double SiderealTimeHours { get; }

    Task SlewAsync(double raJ2000Deg, double decJ2000Deg, CancellationToken token);
}

/// <summary>Kamera (Auslesemodi, Kühlung) – NINA <c>ICameraMediator</c>.</summary>
public interface ICameraControl
{
    bool Connected { get; }

    /// <summary>Namen der Auslesemodi in NINAs Reihenfolge; der Index ist die Position (AP-S2b, execution.md §4.3).</summary>
    IReadOnlyList<string> ReadoutModes { get; }

    double? TemperatureC { get; }

    Task SetReadoutModeAsync(short index, CancellationToken token);
}

/// <summary>Filterrad – NINA <c>IFilterWheelMediator</c>; Namen exakt wie im NINA-Profil (NT-E1).</summary>
public interface IFilterWheelControl
{
    bool Connected { get; }

    IReadOnlyList<string> FilterNames { get; }

    Task ChangeFilterAsync(string ninaFilterName, CancellationToken token);
}

/// <summary>Rotator – NINA <c>IRotatorMediator</c>; ohne Rotator <see cref="Connected"/> = false.</summary>
public interface IRotatorControl
{
    bool Connected { get; }

    /// <summary>Gemessener mechanischer Winkel (Meldung <c>rotatorMechDeg</c>, NIN5-8).</summary>
    double MechanicalPositionDeg { get; }

    Task MoveMechanicalAsync(double deg, CancellationToken token);
}

/// <summary>Sequenz-Umgebung des Containers: Standort aus dem NINA-Profil, Abbruch durch den Benutzer.</summary>
public interface ISequenceHost
{
    /// <summary>Standort aus dem aktiven NINA-Profil (SiteCheck, FA-NIN-03).</summary>
    (double LatDeg, double LonDeg, double ElevationM) ProfileLocation { get; }

    /// <summary>Name des aktiven NINA-Profils.</summary>
    string ProfileName { get; }
}
