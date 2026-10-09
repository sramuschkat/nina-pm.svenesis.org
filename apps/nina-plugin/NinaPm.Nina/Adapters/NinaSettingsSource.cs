using NINA.Astrometry;
using NINA.Sequencer.Trigger;
using NINA.Sequencer.Trigger.Autofocus;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Session;

namespace NinaPm.Nina.Adapters;

/// <summary>
/// NINA-Einstellungen des aktiven Profils für den Heartbeat (execution.md §6 Tabelle, NT-22, NT-E1, NT-E2,
/// contracts/nina/README.md <c>heartbeat.request</c>). Filterrad-Plätze ab 1 (NINA zählt ab 0, §4.4). Trigger aus den
/// Vorfahren des zuletzt laufenden NINA-PM-Containers; ohne Container unbekannt (<c>sequenceTriggers = null</c>,
/// <c>meridianFlip.triggerPresent = null</c>), der Server meldet dann keine Abweichung und plant mit dem Rig-Intervall.
/// </summary>
internal sealed class NinaSettingsSource(NinaMediators m, Func<IEnumerable<ISequenceTrigger>?> triggers) : INinaSettingsSource
{
    public NinaHeartbeat Snapshot()
    {
        var profile = m.Profile.ActiveProfile;
        var flip = profile.MeridianFlipSettings;
        var rotatorSettings = profile.RotatorSettings;
        var astro = profile.AstrometrySettings;
        var known = triggers()?.ToList();
        var allTriggers = known ?? [];
        string Type(ISequenceTrigger t) => t.GetType().Name;

        var body = new NinaHeartbeat
        {
            ProfileLocation = new ProfileLocation { LatDeg = astro.Latitude, LonDeg = astro.Longitude },
            MeridianFlip = new NinaPm.Core.Api.Generated.MeridianFlip
            {
                TriggerPresent = known is null ? null : allTriggers.Any(t => Type(t) == "MeridianFlipTrigger"),
                UseSideOfPier = flip.UseSideOfPier,
                Recenter = flip.Recenter,
                AutoFocusAfterFlip = flip.AutoFocusAfterFlip,
                SettleTimeS = flip.SettleTime,
                PauseBeforeMin = flip.PauseTimeBeforeMeridian,
                AfterMin = flip.MinutesAfterMeridian,
                MaxAfterMin = flip.MaxMinutesAfterMeridian,
            },
            Rotator = new Rotator
            {
                Connected = m.Rotator.GetInfo().Connected,
                RangeType = rotatorSettings.RangeType.ToString() switch
                {
                    "HALF" => RotatorRangeType.HALF,
                    "QUARTER" => RotatorRangeType.QUARTER,
                    _ => RotatorRangeType.FULL,
                },
                RangeStartMechanicalDeg = rotatorSettings.RangeStartMechanicalPosition,
                Reverse = rotatorSettings.Reverse2,
            },
            PlateSolve = new PlateSolve { RotationToleranceDeg = profile.PlateSolveSettings.RotationTolerance },
            SequenceTriggers = known is null ? null : new SequenceTriggers
            {
                Autofocus = [.. allTriggers.Select(Type).Where(n => n.Contains("autofocus", StringComparison.OrdinalIgnoreCase)).Distinct()],
                Dither = [.. allTriggers.Select(Type).Where(n => n.Contains("dither", StringComparison.OrdinalIgnoreCase)).Distinct()],
                AutofocusAfterTimeMin = allTriggers.OfType<AutofocusAfterTimeTrigger>().FirstOrDefault()?.Amount,
            },
            FilterWheel = [.. (profile.FilterWheelSettings.FilterWheelFilters ?? [])
                .Select(f => new FilterWheel { Position = f.Position + 1, Name = f.Name, FocusOffset = f.FocusOffset })],
        };

        var telescope = m.Telescope.GetInfo();
        if (telescope.Connected)
        {
            var lst = AstroUtil.GetLocalSiderealTimeNow(telescope.SiteLongitude);
            var deltaH = telescope.SiderealTime - lst;
            deltaH -= 24 * Math.Round(deltaH / 24);
            body.Mount = new Mount
            {
                EquatorialSystem = telescope.EquatorialSystem switch
                {
                    Epoch.JNOW => MountEquatorialSystem.JNOW,
                    Epoch.B1950 => MountEquatorialSystem.B1950,
                    Epoch.J2050 => MountEquatorialSystem.J2050,
                    _ => MountEquatorialSystem.J2000,
                },
                SiteLatDeg = telescope.SiteLatitude,
                SiteLonDeg = telescope.SiteLongitude,
                SiderealTimeDeltaS = deltaH * 3600,
            };
        }

        var camera = m.Camera.GetInfo();
        if (camera.Connected)
        {
            body.Camera = new Camera
            {
                TemperatureC = Finite(camera.Temperature),
                SetPointC = Finite(camera.TemperatureSetPoint),
                CoolerOn = camera.CoolerOn,
                CoolerPowerPct = Percent(camera.CoolerPower),
            };
            body.CameraReadoutModes = [.. (camera.ReadoutModes ?? []).Select((name, index) => new CameraReadoutModes { Index = index, Name = name })];
        }
        // Nur Anzeige (AP-70): ein Treiberfehler darf den Heartbeat nie verhindern.
        try
        {
            body.Devices = Devices(telescope, camera);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            NINA.Core.Utility.Logger.Debug($"NINA-PM: device status: {ex.Message}");
        }
        return body;
    }

    /// <summary>
    /// Gerätestatus jetzt (AP-70, FA-RIG-19) für „Rig jetzt“: verbundene Geräte, Fokussierer, Montierung, Guider-RMS,
    /// eingelegter Filter, Safety und die Werte des Wettergeräts (z. B. SkyAlert). Nur Anzeige; nicht endliche Werte fehlen.
    /// </summary>
    private NinaDevices Devices(NINA.Equipment.Equipment.MyTelescope.TelescopeInfo telescope, NINA.Equipment.Equipment.MyCamera.CameraInfo camera)
    {
        var focuser = m.Focuser?.GetInfo();
        var guider = m.Guider?.GetInfo();
        var safety = m.SafetyMonitor?.GetInfo();
        var wheel = m.FilterWheel?.GetInfo();
        var weather = m.Weather?.GetInfo();
        return new NinaDevices
        {
            Connected = new Connected
            {
                Camera = camera.Connected,
                Mount = telescope.Connected,
                Focuser = focuser?.Connected == true,
                FilterWheel = wheel?.Connected == true,
                Rotator = m.Rotator?.GetInfo()?.Connected == true,
                Guider = guider?.Connected == true,
                SafetyMonitor = safety?.Connected == true,
                Weather = weather?.Connected == true,
                FlatDevice = m.FlatDevice?.GetInfo()?.Connected == true,
                Switch = m.Switch?.GetInfo()?.Connected == true,
                Dome = m.Dome?.GetInfo()?.Connected == true,
            },
            Focuser = focuser is { Connected: true } f
                ? new NinaPm.Core.Api.Generated.Focuser { Position = f.Position, TemperatureC = Finite(f.Temperature), Moving = f.IsMoving }
                : null,
            MountState = telescope.Connected
                ? new MountState
                {
                    PierSide = NinaPm.Core.Reporting.CaptureMapper.PierSide(telescope.SideOfPier.ToString()) switch
                    {
                        CapturesPierSide.East => MountStatePierSide.East,
                        CapturesPierSide.West => MountStatePierSide.West,
                        _ => null,
                    },
                    Tracking = telescope.TrackingEnabled,
                    AtPark = telescope.AtPark,
                    Slewing = telescope.Slewing,
                    AltitudeDeg = InRange(telescope.Altitude, -90, 90),
                    AzimuthDeg = InRange(telescope.Azimuth, 0, 360),
                }
                : null,
            Guider = guider is { Connected: true, RMSError: { } rms }
                ? new NinaPm.Core.Api.Generated.Guider
                {
                    RmsTotalArcsec = NonNegative(rms.Total.Arcseconds),
                    RmsRaArcsec = NonNegative(rms.RA.Arcseconds),
                    RmsDecArcsec = NonNegative(rms.Dec.Arcseconds),
                }
                : null,
            Filter = wheel is { Connected: true } ? wheel.SelectedFilter?.Name : null,
            Safe = safety is { Connected: true } ? safety.IsSafe : null,
            Weather = weather is { Connected: true } w ? WeatherNow(w) : null,
        };
    }

    /// <summary>Werte des Wettergeräts; was es nicht liefert (NaN) bzw. außerhalb des Vertragsbereichs liegt, fehlt.</summary>
    internal static NinaWeatherNow WeatherNow(NINA.Equipment.Equipment.MyWeatherData.WeatherDataInfo w) => new()
    {
        CloudCoverPct = InRange(w.CloudCover, 0, 100),
        SkyQualityMag = Finite(w.SkyQuality),
        SkyBrightnessLux = NonNegative(w.SkyBrightness),
        SkyTemperatureC = Finite(w.SkyTemperature),
        StarFwhmArcsec = NonNegative(w.StarFWHM),
        TemperatureC = Finite(w.Temperature),
        HumidityPct = InRange(w.Humidity, 0, 100),
        DewPointC = Finite(w.DewPoint),
        PressureHpa = NonNegative(w.Pressure),
        WindSpeedMs = NonNegative(w.WindSpeed),
        WindGustMs = NonNegative(w.WindGust),
        WindDirectionDeg = InRange(w.WindDirection, 0, 360),
        RainRateMmH = NonNegative(w.RainRate),
    };

    internal static double? InRange(double v, double min, double max) => double.IsFinite(v) && v >= min && v <= max ? v : null;

    internal static double? NonNegative(double v) => double.IsFinite(v) && v >= 0 ? v : null;

    private static double? Finite(double v) => double.IsFinite(v) ? v : null;

    /// <summary>
    /// Kühlerleistung 0–100 % (Vertrag); Treiber melden „unbekannt“ als NaN oder negativ (Sky-Simulator, VM-Lauf
    /// 03.10.2026: <c>422</c> auf jeden Heartbeat) → weglassen.
    /// </summary>
    internal static double? Percent(double v) => double.IsFinite(v) && v is >= 0 and <= 100 ? v : null;
}
