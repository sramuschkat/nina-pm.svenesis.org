/**
 * „Ereignisse der Nacht“ (Heute Nacht): Überflüge von Raumstationen und Hubble (SGP4), Meteorströme, Zentrum
 * der Milchstraße und die nächsten Finsternisse am Standort. Portiert aus
 * `legacy/astro-tools-2026-09-21/js/sky-events.js`. Nur Anzeige – die Planung nutzt nichts davon.
 */
export {
  eventSamples,
  longitudeDiffDeg,
  separationAltAzDeg,
  solarLongitudeJ2000Deg,
  type EventSample,
} from './common';
export {
  earthShadowAt,
  lunarEclipses,
  nextEclipses,
  nextSyzygy,
  solarEclipses,
  type LunarEclipse,
  type LunarEclipseKind,
  type SiteEclipse,
  type SolarEclipse,
  type SolarEclipseKind,
} from './eclipses';
export {
  GALACTIC_CENTRE_J2000,
  galacticCentre,
  galacticSeason,
  type GalacticCentre,
  type GalacticCentreTonight,
  type GalacticSeason,
} from './galactic-centre';
export {
  satelliteLook,
  satellitePasses,
  satellitePassesForNight,
  TLE_MAX_AGE_S,
  type NightPasses,
  type PassPoint,
  type SatelliteLook,
  type SatelliteObserver,
  type SatellitePass,
  type SatelliteTle,
  type StaleSatellite,
} from './satellites';
export {
  parseTle,
  sgp4,
  sgp4init,
  WGS72_RADIUS_KM,
  type Sgp4Record,
  type TemeState,
  type TleElements,
} from './sgp4';
export {
  METEOR_SHOWERS,
  meteorRate,
  radiantAt,
  showersTonight,
  type MeteorRate,
  type MeteorShower,
  type MeteorShowerKey,
  type ShowerTonight,
} from './showers';
