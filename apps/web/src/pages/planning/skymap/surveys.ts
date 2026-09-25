/**
 * Himmelsfotos der Sternkarte (FA-FRM-03): HiPS-Durchmusterungen bei CDS Straßburg (`alasky.cds.unistra.fr`,
 * CSP `img-src`, Datenschutzhinweis „Himmelsausschnitte“). Geprüft am 25.09.2026 über die `properties` der
 * Durchmusterungen bzw. den MocServer. NSNS (Northern Sky Narrowband Survey, DR0.1) bietet dort nur Hα,
 * Hα mit Kontinuum und Echtfarbe; OIII und SII sind nicht veröffentlicht.
 */
export interface Survey {
  readonly id: SurveyId;
  readonly url: string;
  readonly maxOrder: number;
  readonly ext: 'jpg' | 'png';
  /** Schmalband – nur Nordhimmel (NSNS). */
  readonly narrowband: boolean;
}

export const SURVEY_IDS = [
  'dss2color',
  'dss2red',
  'dss2blue',
  'panstarrs',
  'twomass',
  'nsnsHa',
  'nsnsHaCont',
  'nsnsColor',
] as const;
export type SurveyId = (typeof SURVEY_IDS)[number];

const CDS = 'https://alasky.cds.unistra.fr/';

export const SURVEYS: Readonly<Record<SurveyId, Survey>> = {
  dss2color: {
    id: 'dss2color',
    url: `${CDS}DSS/DSSColor/`,
    maxOrder: 9,
    ext: 'jpg',
    narrowband: false,
  },
  dss2red: {
    id: 'dss2red',
    url: `${CDS}DSS/DSS2Merged/`,
    maxOrder: 9,
    ext: 'jpg',
    narrowband: false,
  },
  dss2blue: {
    id: 'dss2blue',
    url: `${CDS}DSS/DSS2-blue-XJ-S/`,
    maxOrder: 9,
    ext: 'jpg',
    narrowband: false,
  },
  panstarrs: {
    id: 'panstarrs',
    url: `${CDS}Pan-STARRS/DR1/color-z-zg-g/`,
    maxOrder: 11,
    ext: 'jpg',
    narrowband: false,
  },
  twomass: { id: 'twomass', url: `${CDS}2MASS/Color/`, maxOrder: 9, ext: 'jpg', narrowband: false },
  nsnsHa: {
    id: 'nsnsHa',
    url: `${CDS}simg.de/simg.de_P_NSNS_DR0_1_halpha8/`,
    maxOrder: 6,
    ext: 'png',
    narrowband: true,
  },
  nsnsHaCont: {
    id: 'nsnsHaCont',
    url: `${CDS}simg.de/simg.de_P_NSNS_DR0_1_hbr8/`,
    maxOrder: 5,
    ext: 'png',
    narrowband: true,
  },
  nsnsColor: {
    id: 'nsnsColor',
    url: `${CDS}simg.de/simg.de_P_NSNS_DR0_1_tc8/`,
    maxOrder: 5,
    ext: 'png',
    narrowband: true,
  },
};
