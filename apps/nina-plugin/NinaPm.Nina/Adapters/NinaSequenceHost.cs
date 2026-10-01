using NINA.Profile.Interfaces;
using NinaPm.Core.Abstractions;

namespace NinaPm.Nina.Adapters;

/// <summary>
/// Adapter-Gerüst (AP-16a): Profil-Standort und Profilname für SiteCheck und *Verbindung testen*. Die übrigen
/// Abstraktionen (Kamera, Montierung, Filterrad, Rotator) folgen mit AP-16c…16f.
/// </summary>
internal sealed class NinaSequenceHost(IProfileService profileService) : ISequenceHost
{
    public (double LatDeg, double LonDeg, double ElevationM) ProfileLocation
    {
        get
        {
            var astro = profileService.ActiveProfile.AstrometrySettings;
            return (astro.Latitude, astro.Longitude, astro.Elevation);
        }
    }

    public string ProfileName => profileService.ActiveProfile.Name;
}
