using NINA.Astrometry;
using NINA.Sequencer.Trigger;
using NINA.Sequencer.Trigger.Autofocus;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Session;

namespace NinaPm.Nina.Adapters;

/// <summary>
/// NINA-Einstellungen des aktiven Profils für den Heartbeat (execution.md §6 Tabelle, NT-22, NT-E1, NT-E2,
/// contracts/nina/README.md <c>heartbeat.request</c>). Filterrad-Plätze ab 1 (NINA zählt ab 0, §4.4). Trigger aus den
/// Vorfahren des zuletzt laufenden NINA-PM-Containers (ohne Container leer, <c>autofocusAfterTimeMin = null</c>).
/// </summary>
internal sealed class NinaSettingsSource(NinaMediators m, Func<IEnumerable<ISequenceTrigger>> triggers) : INinaSettingsSource
{
    public NinaHeartbeat Snapshot()
    {
        var profile = m.Profile.ActiveProfile;
        var flip = profile.MeridianFlipSettings;
        var rotatorSettings = profile.RotatorSettings;
        var astro = profile.AstrometrySettings;
        var allTriggers = triggers().ToList();
        string Type(ISequenceTrigger t) => t.GetType().Name;

        var body = new NinaHeartbeat
        {
            ProfileLocation = new ProfileLocation { LatDeg = astro.Latitude, LonDeg = astro.Longitude },
            MeridianFlip = new NinaPm.Core.Api.Generated.MeridianFlip
            {
                TriggerPresent = allTriggers.Any(t => Type(t) == "MeridianFlipTrigger"),
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
            SequenceTriggers = new SequenceTriggers
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
        return body;
    }

    private static double? Finite(double v) => double.IsFinite(v) ? v : null;

    /// <summary>
    /// Kühlerleistung 0–100 % (Vertrag); Treiber melden „unbekannt“ als NaN oder negativ (Sky-Simulator, VM-Lauf
    /// 03.10.2026: <c>422</c> auf jeden Heartbeat) → weglassen.
    /// </summary>
    internal static double? Percent(double v) => double.IsFinite(v) && v is >= 0 and <= 100 ? v : null;
}
