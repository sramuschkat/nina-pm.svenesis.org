/**
 * Testdaten für `buildPlanInput`/`planNight` (AP-13c): Rig in Starfront (Beispielnacht TK 7.6,
 * contracts/nina/README.md), zwei freigegebene Projekte, ein Entwurf, Mondprofile, Nacht-Tabelle.
 */
import type { z } from 'zod';
import type { ProjectView, RigView, SiteNightsView } from '../../src';
import type { PlanMoonProfileSource } from '../../src/plan-input';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const RIG_ID = ID(1);
export const FILTER_HA = ID(11);
export const FILTER_OIII = ID(12);
export const FILTER_L = ID(13);
const T = '2026-09-01T00:00:00Z';

export const rig: z.infer<typeof RigView> = {
  id: RIG_ID,
  name: 'Starfront Rig',
  siteId: ID(2),
  telescopeId: ID(3),
  cameraId: ID(4),
  showInPlanning: true,
  ninaDeliveryEnabled: true,
  defaultTemplateId: null,
  defaultRotationDeg: null,
  hasRotator: true,
  rotationToleranceDeg: 5,
  skipOnRotationMismatch: false,
  sessionReportDiscord: false,
  notes: '',
  scheduler: {
    strategy: 'proportional',
    playback: 'time_aware',
    sortChain: [
      'lowest_peak_altitude',
      'setting_soonest',
      'most_remaining',
      'constrained',
      'bogus',
    ],
    bonusEnabled: false,
    overshootPct: 0,
    mosaicPanelsIndependent: true,
    ditherEnabled: true,
    ditherEvery: 1,
    filterSwitchEnabled: true,
    filterSwitchEvery: 5,
    filterSwitchTolerancePct: 50,
    flatsEnabled: true,
    flatsFullSet: false,
    flatCount: 20,
    darkFlatsEnabled: false,
    darkFlatCount: null,
    flatsSource: 'panel',
    flatsAutoMode: 'off',
    flatsAutoIntervalDays: 7,
    flipEnabled: false,
    flipAfterMeridianMin: 5,
    flipMaxAfterMeridianMin: 15,
    flipPauseBeforeMeridianMin: 0,
    flipDurationS: 240,
    overhead: {
      slewCenterS: 90,
      filterChangeS: 10,
      ditherSettleS: 15,
      afEveryMin: 60,
      afDurationS: 120,
      downloadS: 3,
    },
  },
  filterWheel: [
    {
      position: 1,
      filterId: FILTER_HA,
      ninaFilterName: 'Ha',
      ninaConfirmedAt: T,
      ninaConfirmedBy: ID(9),
    },
    {
      position: 2,
      filterId: FILTER_OIII,
      ninaFilterName: 'OIII',
      ninaConfirmedAt: null,
      ninaConfirmedBy: null,
    },
    {
      position: 3,
      filterId: FILTER_L,
      ninaFilterName: 'Lum',
      ninaConfirmedAt: T,
      ninaConfirmedBy: ID(9),
    },
  ],
  settingsVersion: 4,
  derived: { effFocalMm: 530, scaleArcsecPx: 1.46, fovWidthDeg: 2.5, fovHeightDeg: 1.7 },
  createdAt: T,
  updatedAt: T,
};

const counters = (planned: number, accepted: number) => ({
  planned,
  acquired: accepted,
  rejected: 0,
  accepted,
  remaining: planned - accepted,
  planningNeed: planned - accepted,
  bonus: 0,
  bonusRejected: 0,
  percentDone: 0,
  integrationS: 0,
});

type Line = z.infer<typeof ProjectView>['panels'][number]['lines'][number];
const line = (
  id: number,
  panelId: string,
  filterId: string,
  short: string,
  over: Partial<Line> = {},
): Line => ({
  id: ID(id),
  panelId,
  filterId,
  filterShortName: short,
  exposureS: 300,
  plannedCount: 40,
  disabledForNight: null,
  gain: 100,
  offsetAdu: 20,
  binning: 1,
  readoutMode: 'High Gain Mode',
  moonMode: 'none',
  moonProfileId: null,
  enabled: true,
  orderIndex: 0,
  notes: '',
  hasCaptures: false,
  counters: counters(40, 0),
  ...over,
});

type Project = z.infer<typeof ProjectView>;
const project = (n: number, over: Partial<Project>): Project => ({
  id: ID(n),
  name: `Projekt ${String(n)}`,
  projectType: 'deep_sky',
  rigId: RIG_ID,
  createdBy: ID(9),
  targetName: null,
  targetType: null,
  dsoObjectId: null,
  dsoPrimaryId: null,
  thumbnailUrl: null,
  catalogNames: '',
  mosaic: { cols: 1, rows: 1, overlapPct: 20 },
  descriptionMd: '',
  raDeg: 13.2046,
  decDeg: 56.6297,
  rotationDeg: 90,
  startDate: null,
  dueDate: null,
  requestPeriodFrom: null,
  requestPeriodTo: null,
  requestComment: null,
  conditions: {
    minAltitudeDeg: 30,
    minTimeOnTargetH: 1,
    twilight: 'astronomical',
    moonAvoidanceEnabled: true,
    moonMustBeDown: false,
    moonSeparationDeg: 60,
    moonWidthDays: 5,
    moonRelaxScale: 2,
    moonMinAltDeg: -15,
    moonMaxAltDeg: 5,
    moonMaxIlluminationPct: 60,
  },
  approvalStatus: 'approved',
  status: 'active',
  priority: 1,
  effortStale: false,
  effort: null,
  favorite: false,
  version: 3,
  deletedAt: null,
  createdAt: T,
  updatedAt: T,
  progress: {
    targetReached: false,
    finished: false,
    planningNeed: 40,
    percentDone: 0,
    plannedS: 0,
    integrationS: 0,
  },
  panels: [],
  ...over,
});

export const NGC281 = ID(100);
export const NGC7000 = ID(200);
export const DRAFT = ID(300);
export const STRICT = ID(50);

export const projects: Project[] = [
  project(200, {
    raDeg: 314.75,
    decDeg: 44.53,
    panels: [
      {
        id: ID(201),
        panelIndex: 0,
        label: '1',
        raDeg: 314.75,
        decDeg: 44.53,
        rotationDeg: 0,
        notes: '',
        enabled: true,
        lines: [
          line(211, ID(201), FILTER_OIII, 'OIII', { moonMode: 'profile', moonProfileId: STRICT }),
          line(212, ID(201), FILTER_L, 'L', { orderIndex: 1, moonMode: 'project_default' }),
        ],
      },
    ],
  }),
  project(100, {
    panels: [
      {
        id: ID(101),
        panelIndex: 0,
        label: '1',
        raDeg: 13.2046,
        decDeg: 56.6297,
        rotationDeg: 90,
        notes: '',
        enabled: true,
        lines: [line(111, ID(101), FILTER_HA, 'Ha', { counters: counters(40, 23) })],
      },
    ],
  }),
  project(300, { approvalStatus: 'draft', status: null, panels: [] }),
];

export const moonProfiles: PlanMoonProfileSource[] = [
  {
    id: STRICT,
    separationDeg: 90,
    widthDays: 8,
    relaxScale: 0,
    moonMinAltDeg: -15,
    moonMaxAltDeg: 5,
    maxIlluminationPct: 30,
    moonMustBeDown: false,
  },
  {
    id: ID(51),
    separationDeg: 25,
    widthDays: 3,
    relaxScale: 3,
    moonMinAltDeg: -15,
    moonMaxAltDeg: 5,
    maxIlluminationPct: 80,
    moonMustBeDown: false,
  },
];

export const nights: z.infer<typeof SiteNightsView> = {
  currentNight: '2026-09-17',
  tzdataVersion: '2026a',
  timeZoneTransitions: [
    { atUtc: '2025-11-02T07:00:00Z', utcOffsetMinutes: -360 },
    { atUtc: '2026-03-08T08:00:00Z', utcOffsetMinutes: -300 },
    { atUtc: '2026-11-01T07:00:00Z', utcOffsetMinutes: -360 },
  ],
  nights: [
    {
      night: '2026-09-17',
      noonStartUtc: '2026-09-17T17:00:00Z',
      noonEndUtc: '2026-09-18T17:00:00Z',
      nightWindowEndUtc: '2026-09-18T13:00:00Z',
    },
  ],
};

export const STARFRONT = { latitudeDeg: 31.5471, longitudeDeg: -99.3823, elevationM: 400 };
