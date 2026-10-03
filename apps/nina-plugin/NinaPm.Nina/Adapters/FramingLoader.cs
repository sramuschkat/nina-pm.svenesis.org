using NINA.Astrometry;
using NINA.Core.Enum;
using NINA.Profile.Interfaces;
using NINA.WPF.Base.Interfaces.Mediator;
using NINA.WPF.Base.Interfaces.ViewModel;
using NinaPm.Core.Targets;

namespace NinaPm.Nina.Adapters;

/// <summary>
/// „In Framing-Assistent laden“ (FA-NIN-02, AP-16h). Ablauf wie Astro PM (<c>FramingInjector.cs</c>, Commit 5dd621d,
/// MIT): Sensor und Brennweite setzen, Ziel laden, danach Raster und Überlappung erneut setzen, weil das Laden des
/// Himmelsbilds sie zurücksetzt. Statt Reflection und Suche im Visual Tree über NINAs öffentliche Schnittstelle
/// <see cref="IFramingAssistantVM"/> wie NINAs eigener Ziel-Container (<c>DeepSkyObjectContainer.CoordsToFraming</c>):
/// Reiter wechseln, <c>SetCoordinates</c> mit <c>RotationPositionAngle = pa₀</c> (NINA rechnet intern
/// <c>360 − pa</c>, geometry.md §2.1 NT-32). Koordinaten J2000 in Grad (NT-28).
/// </summary>
internal sealed class FramingLoader(IFramingAssistantVM framing, IApplicationMediator application, IProfileService profile)
{
    public async Task<bool> LoadAsync(FramingRequest r)
    {
        if (r.CameraWidthPx is { } w) framing.CameraWidth = w;
        if (r.CameraHeightPx is { } h) framing.CameraHeight = h;
        if (r.PixelSizeUm is { } px) framing.CameraPixelSize = px;
        if (r.FocalLengthMm is { } fl) framing.FocalLength = fl;
        application.ChangeTab(ApplicationTab.FRAMINGASSISTANT);
        var coordinates = new Coordinates(Angle.ByDegree(r.RaDeg), Angle.ByDegree(r.DecDeg), Epoch.J2000);
        var dso = new DeepSkyObject(r.Name, coordinates, profile.ActiveProfile.AstrometrySettings.Horizon)
        {
            RotationPositionAngle = r.PositionAngleDeg,
        };
        var loaded = await framing.SetCoordinates(dso);
        framing.HorizontalPanels = r.Columns;
        framing.VerticalPanels = r.Rows;
        framing.OverlapPercentage = r.OverlapPct;
        return loaded;
    }
}
