/**
 * S-20 Sternkarte (FK 14.3; FA-FRM-02…12, AP-21; „Karte zuerst“ AP-26f): Werkzeugleiste über der Karte (Suche,
 * Rig, Datum/Uhrzeit, *Jetzt*, *Neues Projekt*), Himmelskarte über die übrige Höhe mit Zoom und Zeitsteuerung
 * in der Karte, Seitenbereich mit Reitern *Objekt* (gewähltes Objekt, Bildfeldmitte, Nachtdiagramm),
 * *Bildfeld & Mosaik* und *Ebenen* (*Himmelsfotos* · *Kataloge* · *Overlays*).
 * Der Zustand steht in der URL (`skymap/model.ts`). Ohne Rotator zeigt das Bildfeld den Kamerawinkel des
 * Rigs und warnt bei Abweichung (FA-FRM-05, NT-30). Die Übernahme des Mosaiks als Panels folgt mit AP-22.
 *
 * Nach der Vorlage `legacy/astro-tools-2026-09-21/js/sky-map.js` (28.09.2026): Rundblick als Start, runde
 * Knopfleiste rechts in der Karte (zoomen, zur vorigen/nächsten Himmelsrichtung drehen, Rundblick, Vollbild),
 * Dämmerung und Uhrzeit (Standort und bei dir) oben in der Karte, Sterne, Mond, Planeten und Katalogobjekte
 * anklickbar mit Ring und Infokarte über der Karte (auch im Vollbild), unter der Karte ein Zeitschieber über
 * die Nacht und die wichtigsten Ebenen als Chips samt Sprache der Sternbildnamen.
 */
import { formatNightKey, formatTzAbbr } from '@nina-pm/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { apparentAltitudeDeg, daysFromKey, keyFromDays, sky } from '@nina-pm/engine';
import {
  catalogApi,
  equipmentApi,
  projectsApi,
  type DsoMarker,
  type DsoView,
  type ProjectListItem,
  type RigView,
  type SiteNightsView,
  type SiteView,
} from '../../api/client';
import { useCan } from '../../auth';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CoordinateInput } from '../../components/CoordinateInput';
import { formatCoordinate } from '../../components/CoordinateInput/coords';
import { ICON_SIZE, actionIcons, uiIcons } from '../../components/icons';
import { NightChart } from '../../components/night-chart';
import { PageHeader } from '../../components/PageHeader';
import { ProblemMessage } from '../../components/ProblemMessage';
import type { RigOption } from '../../components/RigSelect';
import { MoonDarkness, moonDarkness } from '../../components/moon-darkness';
import { nightChartFromEngine } from '../../lib/night-chart-data';
import { problemCode } from '../admin/shared';
import { CatalogSearch } from '../catalog/CatalogSearch';
import { useEquipmentList, useNumber } from '../equipment/shared';
import { researchLinks } from '../projects/ProjectEditorPage';
import { useWikipedia, WikipediaMark } from '../catalog/wikipedia';
import { SeasonPanel } from '../projects/SeasonPanel';
import { PlanningContext } from './PlanningContext';
import { PlanningTabs } from './PlanningTabs';
import {
  FOV_MAX,
  FOV_MIN,
  OVERVIEW_ALT,
  OVERVIEW_FOV,
  angleDiffDeg,
  fovForFrame,
  newProjectCoords,
  paramsFromState,
  roundAngle,
  stateFromParams,
  type SkyMapState,
} from './skymap/model';
import {
  PROJECT_OVERLAYS,
  constellationName,
  hitBody,
  hitMarker,
  hitStar,
  horizonVec,
  toAltAz,
  twilightClass,
  type BodyId,
  type Bodies,
  type FrameSpec,
  type HitIndex,
  type Overlay,
  type ProjectFrame,
  type ProjectOverlay,
} from './skymap/render';
import { constellationAt } from './skymap/constellation';
import { SkyCanvas } from './skymap/SkyCanvas';
import { atNightClock, fromZoned, nightKeyAt, sceneAt, zonedParts } from './skymap/scene';
import { loadBrightSky, loadFaintStars, type BrightSky, type StarField } from './skymap/sky-data';
import { SURVEY_IDS, type SurveyId } from './skymap/surveys';
import { Tabs } from '../../components/Tabs';
import styles from './skymap/skymap.module.css';

const FRAME_COLORS = {
  frame: 'frame',
  'frame-compare': 'compare',
  'project-active': 'active',
  'project-submitted': 'submitted',
} as const;
const FRAME_COLOR_KEY = 'npm.skymap.frameColor';
/** Rückfrage vor „Ins Projekt übernehmen“, wenn das Mosaik um mehr als diesen Faktor wächst … */
const GROWTH_FACTOR_CONFIRM = 4;
/** … oder danach mehr Belichtungszeilen (Panels × Zeilen je Panel) entstehen. */
const LINES_CONFIRM = 100;
const DEFAULT_MIN_ALT = 30;

/** Projekt → Kategorie der Projekt-Overlays (FK 14.3 S-20). */
export function projectCategory(
  p: Pick<ProjectListItem, 'approvalStatus' | 'status'>,
): ProjectOverlay {
  if (p.approvalStatus === 'submitted') return 'submitted';
  if (p.status === 'active') return 'active';
  if (p.status === 'completed' || p.status === 'ready_to_process' || p.status === 'archived')
    return 'completed';
  if (p.status === 'unfinished' || p.status === 'on_hold') return 'unfinished';
  return 'planning';
}

/** Anfangsrotation: Projektwinkel bzw. Rig-Standard; ohne Rotator der Kamerawinkel (NT-30). */
export function effectiveRotation(
  rig: Pick<RigView, 'hasRotator' | 'defaultRotationDeg'> | null,
  rot: number | null,
) {
  const camera = rig?.defaultRotationDeg ?? 0;
  return rot ?? camera;
}

const readLocal = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeLocal = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // privater Modus: Einstellung gilt nur für diese Sitzung
  }
};

type Selected =
  | { kind: 'dso'; item: DsoMarker }
  | { kind: 'project'; item: ProjectListItem }
  | { kind: 'star'; index: number }
  | { kind: 'body'; id: BodyId }
  | null;

const PHASES = ['day', 'civil', 'nautical', 'astronomical', 'night'] as const;
const COMPASS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
/** Himmelsrichtung (Index 0–7 in `COMPASS`) eines Azimuts. */
const compassIndex = (azDeg: number) => Math.round(azDeg / 45) % 8;

/** Richtung eines Himmelskörpers zum Zeitpunkt der Szene. */
function bodyVec(b: Bodies, id: BodyId): sky.Vec3 | null {
  if (id === 'sun') return b.sun;
  if (id === 'moon') return b.moon?.vec ?? null;
  return b.planets.find((p) => p.id === id)?.vec ?? null;
}

const starVec = (b: BrightSky, i: number): sky.Vec3 => [
  b.stars.vec[i * 3] as number,
  b.stars.vec[i * 3 + 1] as number,
  b.stars.vec[i * 3 + 2] as number,
];

const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
};

export function SkyMapPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'de';
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => stateFromParams(params), [params]);
  const projectParam = params.get('projekt');
  const objectParam = params.get('objekt');
  // Auf der zuletzt gesetzten Adresse aufbauen, nicht auf der des letzten Renderns: zwei schnelle Änderungen
  // (z. B. Mosaik horizontal, dann vertikal) überschrieben sich sonst gegenseitig. `setParams(prev => …)` reicht
  // dafür nicht – React Router übergibt als `prev` die Adresse des letzten Renderns; seit die Karte teurer zeichnet
  // (Landschaft, Milchstraße), ging so im E2E-Test „Mosaik 2×2“ die erste Änderung verloren (28.09.2026).
  const pending = useRef<URLSearchParams | null>(null);
  // Sobald eine Adresse gerendert ist, gilt wieder sie (auch nach Zurück-Taste oder Links von außen).
  useEffect(() => {
    pending.current = null;
  }, [params]);
  const update = (patch: Partial<SkyMapState>) => {
    const extra: Record<string, string> = {};
    if (projectParam) extra.projekt = projectParam;
    if (objectParam) extra.objekt = objectParam;
    const next = paramsFromState(
      { ...stateFromParams(pending.current ?? params), ...patch },
      extra,
    );
    pending.current = next;
    setParams(next, { replace: true });
  };
  const num = useNumber();
  const ids = { map: useId() };
  const canCreate = useCan('project.create');
  const canWriteRig = useCan('equipment.write');
  const client = useQueryClient();

  // ---- Ausrüstung ----------------------------------------------------------------------------
  const rigs = useEquipmentList('rigs');
  const sites = useEquipmentList('sites');
  const telescopes = useEquipmentList('telescopes');
  const cameras = useEquipmentList('cameras');
  const rigList = rigs.data ?? [];
  const rig =
    rigList.find((r) => r.id === state.rig) ??
    rigList.find((r) => r.showInPlanning) ??
    rigList[0] ??
    null;
  const compareRig = rigList.find((r) => r.id === state.compare) ?? null;
  const site = (sites.data ?? []).find((s) => s.id === rig?.siteId) ?? null;
  const telescope = (telescopes.data ?? []).find((x) => x.id === rig?.telescopeId) ?? null;
  const camera = (cameras.data ?? []).find((x) => x.id === rig?.cameraId) ?? null;
  const rigOptions: RigOption[] = rigList.map((r) => ({
    id: r.id,
    name: r.name,
    siteName: (sites.data ?? []).find((s) => s.id === r.siteId)?.name ?? '',
    telescopeName: (telescopes.data ?? []).find((x) => x.id === r.telescopeId)?.name ?? '',
    cameraName: (cameras.data ?? []).find((x) => x.id === r.cameraId)?.name ?? '',
    scaleArcsecPx: r.derived.scaleArcsecPx,
    fovDeg: [r.derived.fovWidthDeg, r.derived.fovHeightDeg],
    showInPlanning: r.showInPlanning,
  }));
  const cameraAngle = rig?.defaultRotationDeg ?? 0;
  const pa = effectiveRotation(rig, state.rot);
  const rotationLocked = rig !== null && !rig.hasRotator && !canWriteRig;
  // Über den Winkelabstand: 359,98° und 0° sind derselbe Kamerawinkel.
  const rotationMismatch = rig !== null && !rig.hasRotator && angleDiffDeg(pa, cameraAngle) > 0.05;

  const frame: FrameSpec | null = rig
    ? {
        raDeg: state.fra,
        decDeg: state.fdec,
        // Ohne Rotator nimmt NINA im Kamerawinkel auf, und „Ins Projekt übernehmen“ speichert ihn (NT-30) – also
        // zeigt die Karte das Bildfeld so; ein abweichend gewählter Winkel erscheint gestrichelt (`ghost`,
        // Astronomie-Prüfung 28.09.2026: vorher sah ein Admin den gewählten Winkel, gespeichert wurde ein anderer).
        paDeg: rig.hasRotator ? pa : cameraAngle,
        fovWidthDeg: rig.derived.fovWidthDeg,
        fovHeightDeg: rig.derived.fovHeightDeg,
        cols: state.cols,
        rows: state.rows,
        overlapPct: state.overlap,
      }
    : null;
  const compare: FrameSpec | null =
    compareRig && frame
      ? {
          ...frame,
          fovWidthDeg: compareRig.derived.fovWidthDeg,
          fovHeightDeg: compareRig.derived.fovHeightDeg,
          cols: 1,
          rows: 1,
        }
      : null;

  const [frameColor, setFrameColor] = useState<string>(() => {
    const v = readLocal(FRAME_COLOR_KEY);
    return v && v in FRAME_COLORS ? v : 'frame';
  });

  // ---- Zeit ------------------------------------------------------------------------------------
  const [clock, setClock] = useState(() => Date.now() / 1000);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    // „Jetzt“ läuft mit (alle 30 s); Abspielen schreitet sekündlich voran (Echtzeitlauf, FA-FRM-11).
    const id = window.setInterval(
      () => {
        if (playing) update({ t: (state.t ?? Date.now() / 1000) + 1 });
        else setClock(Date.now() / 1000);
      },
      playing ? 1000 : 30_000,
    );
    return () => window.clearInterval(id);
  });
  const time = state.t ?? clock;
  const zone = site?.timeZone ?? 'UTC';
  const devZone = useMemo(deviceZone, []);

  const scene = useMemo(
    () =>
      site
        ? sceneAt(time, site, { raDeg: state.fra, decDeg: state.fdec }, DEFAULT_MIN_ALT, state.heat)
        : null,
    [site, time, state],
  );

  // ---- Sterndaten und Katalog ------------------------------------------------------------------
  const [bright, setBright] = useState<BrightSky | null>(null);
  const [faint, setFaint] = useState<StarField | null>(null);
  useEffect(() => {
    let alive = true;
    void loadBrightSky().then((b) => alive && setBright(b));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (state.fov > 30 || faint) return;
    let alive = true;
    void loadFaintStars()
      .then((f) => alive && setFaint(f))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [state.fov, faint]);

  // „Horizont unten“ mit Standort: Blickrichtung am Horizont verankert (Azimut, Höhe), die Sterne ziehen
  // mit der Zeit durchs Bild. Ohne Azimut Süden (Südhalbkugel Norden), ohne Höhe die gespeicherte Blickmitte.
  const horizonView = state.orient === 'horizon' && scene !== null;
  const up: sky.Vec3 = horizonView
    ? sky.matVec(sky.transpose(scene.observer.toHorizon), [0, 0, 1])
    : [0, 0, 1];
  const center: sky.Vec3 =
    horizonView && state.valt !== null
      ? horizonVec(
          scene.observer.toHorizon,
          state.vaz ?? ((site?.latitudeDeg ?? 0) < 0 ? 0 : 180),
          state.valt,
        )
      : sky.radecToVec(state.ra, state.dec);
  const centerRd = sky.vecToRadec(center);
  const centerHor = scene ? toAltAz(scene.observer.toHorizon, center) : null;
  const regionRadius = Math.min(90, state.fov * 0.9);
  const bucket = Math.max(0.5, regionRadius / 2);
  // Weite Ansichten zeigen nur die helleren Objekte, sonst wird die Karte unlesbar.
  const magMax = Math.min(state.density, state.fov > 60 ? 8 : state.fov > 30 ? 9.5 : 16);
  const regionKey = [
    Math.round(centerRd.raDeg / bucket) * bucket,
    Math.round(centerRd.decDeg / bucket) * bucket,
    Math.round(regionRadius * 10) / 10,
    magMax,
  ];
  const dso = useQuery({
    queryKey: ['dso-region', ...regionKey],
    queryFn: () =>
      catalogApi.region({
        ra: (((regionKey[0] as number) % 360) + 360) % 360,
        dec: Math.max(-90, Math.min(90, regionKey[1] as number)),
        radius: Math.min(90, regionRadius + bucket),
        magMax,
        limit: 1500,
      }),
    enabled: state.overlays.has('dso'),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

  const projects = useQuery({
    queryKey: ['projects', 'skymap'],
    queryFn: async () => (await projectsApi.list()).items,
  });
  const projectFrames: ProjectFrame[] = useMemo(
    () =>
      (projects.data ?? [])
        .filter((p) => p.raDeg !== null && p.decDeg !== null)
        .map((p) => {
          const r = rigList.find((x) => x.id === p.rigId) ?? rig;
          return {
            id: p.id,
            name: p.name,
            category:
              p.favorite && state.projects.has('favorite') ? 'favorite' : projectCategory(p),
            frame: {
              raDeg: p.raDeg ?? 0,
              decDeg: p.decDeg ?? 0,
              paDeg: p.rotationDeg,
              fovWidthDeg: r?.derived.fovWidthDeg ?? 1,
              fovHeightDeg: r?.derived.fovHeightDeg ?? 1,
              cols: p.mosaic.cols,
              rows: p.mosaic.rows,
              overlapPct: p.mosaic.overlapPct,
            },
          };
        }),
    [projects.data, rigList, rig, state.projects],
  );

  // ---- Auswahl ---------------------------------------------------------------------------------
  const [selected, setSelected] = useState<Selected>(null);
  const [sideTab, setSideTab] = useState<SideTab>('field');
  const [chartTab, setChartTab] = useState<'altitude' | 'season'>('altitude');
  /** Seitenbereich einklappbar (AP-26i): zugeklappt nimmt er keine Breite, die Karte wird breiter. */
  const [sideOpen, setSideOpen] = useState(() => readLocal(SIDE_OPEN_KEY) !== 'false');
  useEffect(() => writeLocal(SIDE_OPEN_KEY, String(sideOpen)), [sideOpen]);
  const [photoStatus, setPhotoStatus] = useState({ shown: 0, pending: 0 });

  /** Blickmitte (und Sichtfeld) setzen; mit verankertem Horizont als Azimut und Höhe. */
  const viewPatch = (c: sky.Vec3, fov?: number): Partial<SkyMapState> => {
    const r = sky.vecToRadec(c);
    const patch: Partial<SkyMapState> = { ra: r.raDeg, dec: r.decDeg, ...(fov ? { fov } : {}) };
    if (!horizonView) return patch;
    const h = toAltAz(scene.observer.toHorizon, c);
    return { ...patch, vaz: h.azDeg, valt: h.altDeg };
  };
  const moveTo = (raDeg: number, decDeg: number, fov?: number) =>
    update({ ...viewPatch(sky.radecToVec(raDeg, decDeg), fov), fra: raDeg, fdec: decDeg });
  const centerOn = (v: sky.Vec3) => update(viewPatch(v));
  /** Zur vorigen (−1) bzw. nächsten (+1) Himmelsrichtung drehen (Vorlage ← →); schaltet auf „Horizont unten“. */
  const turn = (dir: -1 | 1) => {
    if (!centerHor) return;
    const k = centerHor.azDeg / 45;
    const next = dir > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1;
    update({
      orient: 'horizon',
      vaz: (((next * 45) % 360) + 360) % 360,
      valt: horizonView
        ? centerHor.altDeg
        : state.fov >= 100
          ? OVERVIEW_ALT
          : Math.max(10, centerHor.altDeg),
    });
  };
  const overview = () =>
    update({
      orient: 'horizon',
      fov: OVERVIEW_FOV,
      vaz: horizonView && centerHor ? (compassIndex(centerHor.azDeg) * 45) % 360 : null,
      valt: OVERVIEW_ALT,
    });

  const pickFromCatalog = (o: DsoView) => {
    const size = (o.sizeMajorArcmin ?? 0) / 60;
    const fov = rig
      ? fovForFrame(
          Math.max(rig.derived.fovWidthDeg, size),
          Math.max(rig.derived.fovHeightDeg, size),
          state.cols,
          state.rows,
        )
      : Math.max(1, size * 3);
    moveTo(o.raDeg, o.decDeg, fov);
    // Gewähltes Objekt merken: Infokarte und *Neues Projekt* übernehmen es (Katalogverknüpfung).
    setSelected({
      kind: 'dso',
      item: {
        id: o.id,
        primaryId: o.primaryId,
        displayName: o.displayName,
        group: o.group,
        raDeg: o.raDeg,
        decDeg: o.decDeg,
        mag: o.magV ?? o.magB,
        sizeMajorArcmin: o.sizeMajorArcmin,
        sizeMinorArcmin: o.sizeMinorArcmin,
        positionAngleDeg: o.positionAngleDeg,
      },
    });
  };

  // ---- Projekt: Übernahme ----------------------------------------------------------------------
  const project = useQuery({
    queryKey: ['projects', projectParam],
    queryFn: () => projectsApi.get(projectParam ?? ''),
    enabled: projectParam !== null,
  });
  const canUpdateProject = useCan(
    'project.update',
    project.data
      ? { createdBy: project.data.createdBy, approvalStatus: project.data.approvalStatus }
      : undefined,
  );
  // Raster des Projekts übernehmen, wenn die URL keins vorgibt (der Link aus dem Editor gibt es mit).
  const projectId = project.data?.id;
  useEffect(() => {
    const m = project.data?.mosaic;
    if (m && !params.has('h') && !params.has('v') && m.cols * m.rows > 1)
      update({ cols: m.cols, rows: m.rows, overlap: m.overlapPct });
    // Nur einmal je geladenem Projekt.
  }, [projectId]);
  const apply = useMutation({
    mutationFn: () => {
      const p = project.data;
      if (!p) throw new Error('kein Projekt');
      // Mosaik samt Mitte und Rotation; die Panels rechnet der Server mit der Engine (AP-22).
      return projectsApi.applyMosaic(
        p.id,
        {
          // Winkel nach dem Runden in [0, 360): 359,9999997° würde sonst 360 und von der API abgelehnt.
          raDeg: roundAngle(state.fra, 6),
          decDeg: Math.round(state.fdec * 1e6) / 1e6,
          rotationDeg: roundAngle(frame?.paDeg ?? 0, 2),
          cols: state.cols,
          rows: state.rows,
          overlapPct: state.overlap,
          copyPlan: true,
        },
        p.version,
      );
    },
    onSuccess: (view) => client.setQueryData(['projects', view.id], view),
    // 412: jemand hat das Projekt inzwischen geändert – neu laden, damit der nächste Versuch die neue Version
    // schickt (vorher blieb die alte Version im Cache und jeder weitere Versuch scheiterte ebenso).
    onError: (error) => {
      if (problemCode(error) === 'resource.version_conflict' && projectParam)
        void client.invalidateQueries({ queryKey: ['projects', projectParam] });
    },
  });
  const applyConflict = apply.isError && problemCode(apply.error) === 'resource.version_conflict';
  // Fallen Panels weg, fragt die Karte vorher nach (mit Aufnahmen weich gelöscht, FA-PRJ-06). Ebenso, wenn das
  // Mosaik stark wächst: jedes Panel erhält eine Kopie des Belichtungsplans (28.09.2026, P1-15).
  const [confirmApply, setConfirmApply] = useState(false);
  const currentPanels = project.data?.panels ?? [];
  const newPanelCount = state.cols * state.rows;
  const removedPanels = currentPanels.slice(newPanelCount);
  const removedWithCaptures = removedPanels.filter((p) =>
    p.lines.some((l) => l.hasCaptures),
  ).length;
  const linesPerPanel = Math.max(0, ...currentPanels.map((p) => p.lines.length));
  const largeGrowth =
    newPanelCount > Math.max(1, currentPanels.length) &&
    (newPanelCount > GROWTH_FACTOR_CONFIRM * Math.max(1, currentPanels.length) ||
      newPanelCount * linesPerPanel > LINES_CONFIRM);
  const startApply = () => {
    if (removedPanels.length > 0 || largeGrowth) setConfirmApply(true);
    else apply.mutate();
  };
  const pin = useMutation({
    mutationFn: () => {
      if (!rig) throw new Error('kein Rig');
      return equipmentApi.updateRig(
        rig.id,
        rigBody(rig, Math.round(pa * 100) / 100),
        rig.settingsVersion,
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['equipment', 'rigs'] });
      update({ rot: null });
    },
  });

  const newProjectHref = (() => {
    // Gewähltes Katalogobjekt außerhalb des Bildfelds: seine Koordinaten statt der Bildfeldmitte (P1-14).
    const target = newProjectCoords(
      { raDeg: state.fra, decDeg: state.fdec },
      selected?.kind === 'dso' ? selected.item : null,
      frame,
    );
    const q = new URLSearchParams({
      ra: String(roundAngle(target.raDeg, 6)),
      dec: String(Math.round(target.decDeg * 1e6) / 1e6),
      rot: String(roundAngle(frame?.paDeg ?? 0, 2)),
    });
    if (rig) q.set('rig', rig.id);
    // Das auf der Karte gewählte Objekt geht vor dem aus der Adresse (Objektbrowser → Sternkarte).
    const picked = selected?.kind === 'dso' ? selected.item.primaryId : objectParam;
    if (picked) q.set('objekt', picked);
    if (state.cols * state.rows > 1) {
      q.set('h', String(state.cols));
      q.set('v', String(state.rows));
      q.set('ueberlappung', String(state.overlap));
    }
    return `/projekte/neu?${q.toString()}`;
  })();

  // ---- Vollbild --------------------------------------------------------------------------------
  const mapArea = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const toggle = <T,>(set: ReadonlySet<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const fovText = (deg: number) => (deg >= 1 ? `${num(deg, 1)}°` : `${num(deg * 60, 1)}′`);
  const planetNames = Object.fromEntries(
    sky.PLANET_IDS.map((id) => [id, t(`skymap.planet.${id}`)]),
  );

  const dsoItems = dso.data?.items ?? [];
  const selectedVec: sky.Vec3 | null = !selected
    ? null
    : selected.kind === 'dso'
      ? sky.radecToVec(selected.item.raDeg, selected.item.decDeg)
      : selected.kind === 'star'
        ? bright
          ? starVec(bright, selected.index)
          : null
        : selected.kind === 'body'
          ? scene
            ? bodyVec(scene.bodies, selected.id)
            : null
          : null;
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) setSelected(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);
  const input = {
    overlays: state.overlays,
    projectOverlays: state.projects,
    bright,
    faint,
    dso: state.overlays.has('dso') ? dsoItems : [],
    observer: scene?.observer ?? null,
    bodies: scene?.bodies ?? null,
    projects: projectFrames,
    frame,
    compare,
    ghost: frame && rotationMismatch ? { ...frame, paDeg: pa } : null,
    selectedId: selected?.kind === 'dso' || selected?.kind === 'project' ? selected.item.id : null,
    selectedVec,
    names: state.names,
    compassLabels: COMPASS.map((c) => t(`bodies.compass.${c}`)),
    milkyWayLabel: t('skymap.milkyWay'),
    frameColor,
    lang: lang as 'de' | 'en',
    planetNames,
    moonLabel: t('skymap.moonLabel'),
    sunLabel: t('skymap.sunLabel'),
    zenithLabel: t('skymap.zenithLabel'),
  };

  // Was ein Klick trifft, in der Reihenfolge der Vorlage: Mond oder Planet, Katalogobjekt, Projekt, Stern.
  const onPick = (x: number, y: number, view: sky.SkyView, hits: HitIndex) => {
    const body = hitBody(hits, x, y);
    if (body) {
      setSelected({ kind: 'body', id: body });
      return;
    }
    const hitDso = state.overlays.has('dso') ? hitMarker(view, dsoItems, x, y, 14) : null;
    if (hitDso) {
      setSelected({ kind: 'dso', item: hitDso });
      return;
    }
    const visible = projectFrames.filter((p) => state.projects.has(p.category));
    const hitProject = hitMarker(
      view,
      visible.map((p) => ({ raDeg: p.frame.raDeg, decDeg: p.frame.decDeg, id: p.id })),
      x,
      y,
      16,
    );
    const item = hitProject ? (projects.data ?? []).find((p) => p.id === hitProject.id) : null;
    if (item) {
      setSelected({ kind: 'project', item });
      return;
    }
    const star = hitStar(hits, x, y);
    setSelected(star !== null ? { kind: 'star', index: star } : null);
  };

  // ---- Zeitleiste ------------------------------------------------------------------------------
  const nightKey = nightKeyAt(time, zone);
  const nights = useQuery({
    queryKey: ['site-nights', site?.id, 'from', nightKey],
    queryFn: () => equipmentApi.nights(site?.id ?? '', 2, nightKey),
    enabled: site !== null,
    staleTime: 60 * 60_000,
  });
  const parts = zonedParts(time, zone);
  const shift = (sec: number) => {
    setPlaying(false);
    update({ t: time + sec });
  };
  // Andere Nacht: dieselbe Uhrzeit an der entsprechenden Stelle der Nacht (auch über die Zeitumstellung).
  const goToNight = (night: string) => {
    const date = keyFromDays(daysFromKey(parts.date) + daysFromKey(night) - daysFromKey(nightKey));
    const v = fromZoned(date, parts.time, zone);
    setPlaying(false);
    if (v !== null) update({ t: v });
  };
  // ±1 Tag über den Nacht-Schlüssel statt ±86 400 s: dieselbe Uhrzeit auch über die Zeitumstellung.
  const shiftNight = (days: -1 | 1) => goToNight(keyFromDays(daysFromKey(nightKey) + days));
  const siteGeo = useMemo(
    () => (site ? { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg } : null),
    [site?.latitudeDeg, site?.longitudeDeg],
  );
  const moonData = useMemo(() => {
    if (!site || !nights.data) return null;
    try {
      return moonDarkness({
        site: { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg },
        night: nightKey,
        timeZoneTransitions: nights.data.timeZoneTransitions.map((z) => ({
          atUtc: Date.parse(z.atUtc) / 1000,
          utcOffsetMinutes: z.utcOffsetMinutes,
        })),
        timeZone: site.timeZone,
      });
    } catch {
      return null;
    }
  }, [site, nights.data, nightKey]);

  return (
    <div className={styles.page}>
      <PageHeader title={t('skymap.title')} nav={<PlanningTabs />} />

      {/* Kontextleiste der Planung wie im Objektbrowser (Wunsch Sven 27.09.2026): Rig, Nacht mit Mondkalender,
          „Heute Nacht“; rechts Uhrzeit in Standortzeit und „Jetzt“. */}
      <PlanningContext
        rigs={rigOptions}
        rigId={rig?.id ?? null}
        onRigChange={(id) => update({ rig: id, rot: null })}
        site={site}
        siteGeo={siteGeo}
        night={site ? nightKey : null}
        today={nights.data?.currentNight ?? null}
        onNightChange={goToNight}
        onTonight={() => {
          const today = nights.data?.currentNight;
          if (today) goToNight(today);
          else update({ t: null });
        }}
      >
        <Field id="skymap-clock" label={t('skymap.time.clock')}>
          <input
            id="skymap-clock"
            type="time"
            className={styles.input}
            value={parts.time}
            onChange={(e) => {
              // In der angezeigten Nacht bleiben: vor 12:00 der Morgen danach (P1-13).
              const v = atNightClock(nightKey, e.target.value, zone);
              if (v !== null) update({ t: v });
            }}
          />
        </Field>
        <span className={styles.muted}>
          {t('skymap.time.zone', { zone: formatTzAbbr(new Date(time * 1000), zone) })}
        </span>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            setPlaying(false);
            update({ t: null });
          }}
        >
          {t('skymap.time.now')}
        </button>
      </PlanningContext>

      {/* „Mond und Dunkelheit“ direkt nach Rig und Nacht, wie im Objektbrowser (Wunsch Sven 27.09.2026). */}
      {site && moonData ? (
        <section className={styles.moonDark} aria-label={t('moonDark.title')}>
          <MoonDarkness
            data={moonData}
            night={nightKey}
            timeZone={site.timeZone}
            southern={site.latitudeDeg < 0}
            nowUtc={nightKey === nights.data?.currentNight ? clock : undefined}
            cursorUtc={time}
            onCursorChange={(at) => {
              setPlaying(false);
              update({ t: at });
            }}
          />
        </section>
      ) : null}

      {/* Karte zuerst (AP-26f): eine Werkzeugleiste über der Karte, die Karte füllt die übrige Höhe, die
          Zeitsteuerung liegt unten in der Karte, Einstellungen in Seitenreitern rechts. */}
      <div className={styles.topbar} role="toolbar" aria-label={t('skymap.title')}>
        <div className={styles.searchBox}>
          <CatalogSearch onPick={pickFromCatalog} compact />
        </div>
        <span className={styles.spacer} />
        {canCreate ? (
          <Link className={styles.buttonPrimary} to={newProjectHref}>
            <actionIcons.add size={ICON_SIZE.button} aria-hidden />
            {selected?.kind === 'dso'
              ? t('skymap.newProjectWith', { name: selected.item.displayName })
              : t('skymap.newProject')}
          </Link>
        ) : null}
        {project.data && canUpdateProject ? (
          <button
            type="button"
            className={styles.button}
            disabled={apply.isPending}
            onClick={startApply}
          >
            <actionIcons.save size={ICON_SIZE.button} aria-hidden />
            {t('skymap.applyToProject')}
          </button>
        ) : null}
      </div>
      {apply.isSuccess ? (
        <p className={styles.success} role="status">
          {t('skymap.applied')}
        </p>
      ) : null}
      {applyConflict ? (
        <p className={styles.warning} role="alert">
          {t('skymap.applyConflict')}
        </p>
      ) : apply.isError ? (
        <ProblemMessage code={problemCode(apply.error)} />
      ) : null}
      <div className={styles.main} ref={mapArea} data-side={sideOpen ? 'open' : 'closed'}>
        <div className={styles.map} id={ids.map}>
          <div className={styles.stage}>
            <SkyCanvas
              input={input}
              center={center}
              up={up}
              fovDeg={state.fov}
              survey={state.survey === 'none' ? null : state.survey}
              photoAlpha={state.alpha}
              label={t('skymap.mapLabel')}
              description={t('skymap.mapDescription', {
                ra: formatCoordinate('ra', centerRd.raDeg, 'sexagesimal'),
                dec: formatCoordinate('dec', centerRd.decDeg, 'sexagesimal'),
                fov: fovText(state.fov),
                fra: formatCoordinate('ra', state.fra, 'sexagesimal'),
                fdec: formatCoordinate('dec', state.fdec, 'sexagesimal'),
                rot: num(frame?.paDeg ?? 0, 1),
              })}
              onView={(c, fov) => update(viewPatch(c, fov))}
              onFrameMove={(c) => {
                const r = sky.vecToRadec(c);
                update({ fra: r.raDeg, fdec: r.decDeg });
              }}
              onPick={onPick}
              onPhotoStatus={(s) => {
                if (s.shown !== photoStatus.shown || s.pending !== photoStatus.pending)
                  setPhotoStatus(s);
              }}
            />
            {/* Ecktexte wie in der Vorlage: links die Dämmerung, rechts Uhrzeit, Blickrichtung und Sichtfeld. */}
            {scene ? (
              <p className={styles.phase}>
                {t(`skymap.phase.${PHASES[twilightClass(scene.sunAltDeg)]}`)}
              </p>
            ) : null}
            <div className={styles.clockBox}>
              <span className={styles.clockMain}>
                {t('skymap.clock.site', {
                  time: parts.time,
                  zone: formatTzAbbr(new Date(time * 1000), zone),
                })}
              </span>
              {site && devZone !== zone ? (
                <span>
                  {t('skymap.clock.device', {
                    time: zonedParts(time, devZone).time,
                    zone: formatTzAbbr(new Date(time * 1000), devZone),
                  })}
                </span>
              ) : null}
              <span>
                {horizonView && centerHor
                  ? `${t('skymap.view.direction', {
                      dir: t(`skymap.compassLong.${COMPASS[compassIndex(centerHor.azDeg)] ?? 's'}`),
                    })} · `
                  : ''}
                {t('skymap.time.zoom', { fov: fovText(state.fov) })}
              </span>
            </div>
            {/* Runde Knopfleiste rechts (Vorlage `.op-map-ctrl`): zoomen, drehen, Rundblick, Vollbild. */}
            <div className={styles.mapCtrl} role="group" aria-label={t('skymap.ctrl.label')}>
              <MapButton
                label={t('skymap.time.zoomIn')}
                disabled={state.fov <= FOV_MIN + 1e-9}
                onClick={() => update({ fov: Math.max(FOV_MIN, state.fov / 1.5) })}
              >
                <uiIcons.zoomIn size={ICON_SIZE.button} aria-hidden />
              </MapButton>
              <MapButton
                label={t('skymap.time.zoomOut')}
                disabled={state.fov >= FOV_MAX - 1e-9}
                onClick={() => update({ fov: Math.min(FOV_MAX, state.fov * 1.5) })}
              >
                <uiIcons.zoomOut size={ICON_SIZE.button} aria-hidden />
              </MapButton>
              <span className={styles.ctrlSep} aria-hidden />
              <MapButton
                label={t('skymap.ctrl.turnLeft')}
                disabled={!scene}
                onClick={() => turn(-1)}
              >
                <uiIcons.turnLeft size={ICON_SIZE.button} aria-hidden />
              </MapButton>
              <MapButton
                label={t('skymap.ctrl.turnRight')}
                disabled={!scene}
                onClick={() => turn(1)}
              >
                <uiIcons.turnRight size={ICON_SIZE.button} aria-hidden />
              </MapButton>
              <MapButton label={t('skymap.ctrl.overview')} disabled={!scene} onClick={overview}>
                <uiIcons.overview size={ICON_SIZE.button} aria-hidden />
              </MapButton>
              <span className={styles.ctrlSep} aria-hidden />
              <MapButton
                label={fullscreen ? t('skymap.exitFullscreen') : t('skymap.fullscreen')}
                onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void mapArea.current?.requestFullscreen?.();
                }}
              >
                {fullscreen ? (
                  <uiIcons.exitFullscreen size={ICON_SIZE.button} aria-hidden />
                ) : (
                  <uiIcons.fullscreen size={ICON_SIZE.button} aria-hidden />
                )}
              </MapButton>
            </div>
            {/* Infokarte über der Karte unten rechts – auch im Vollbild sichtbar (Vorlage). */}
            {selected ? (
              <div className={styles.infoOverlay}>
                <InfoCard
                  selected={selected}
                  rigId={rig?.id ?? null}
                  canCreate={canCreate}
                  bright={bright}
                  scene={scene}
                  names={state.names}
                  onClose={() => setSelected(null)}
                  onCenter={centerOn}
                  onMoveFrame={(ra, dec) => update({ fra: ra, fdec: dec })}
                  charts={(target) =>
                    site ? (
                      <InfoCharts
                        site={site}
                        nights={nights.data ?? null}
                        nightsError={nights.isError}
                        onRetry={() => void nights.refetch()}
                        nightKey={nightKey}
                        target={target}
                        time={time}
                        tab={chartTab}
                        onTab={setChartTab}
                        onTime={(at) => {
                          setPlaying(false);
                          update({ t: at });
                        }}
                      />
                    ) : null
                  }
                />
              </div>
            ) : null}
          </div>
          <section className={styles.timebar} aria-label={t('skymap.time.label')}>
            {moonData ? (
              <div className={styles.sliderRow}>
                <input
                  type="range"
                  className={styles.timeSlider}
                  aria-label={t('skymap.timeSlider')}
                  aria-valuetext={parts.time}
                  min={moonData.window.fromUtc}
                  max={moonData.window.toUtc}
                  step={60}
                  value={Math.min(moonData.window.toUtc, Math.max(moonData.window.fromUtc, time))}
                  onChange={(e) => {
                    setPlaying(false);
                    update({ t: Number(e.target.value) });
                  }}
                />
              </div>
            ) : null}
            <div className={styles.timeButtons}>
              <button type="button" className={styles.button} onClick={() => shiftNight(-1)}>
                {t('skymap.time.minusDay')}
              </button>
              <button type="button" className={styles.button} onClick={() => shift(-3600)}>
                {t('skymap.time.minusHour')}
              </button>
              <button type="button" className={styles.button} onClick={() => shift(-600)}>
                {t('skymap.time.minusTen')}
              </button>
              <button
                type="button"
                className={styles.button}
                aria-pressed={playing}
                onClick={() => {
                  if (!playing && state.t === null) update({ t: time });
                  setPlaying(!playing);
                }}
              >
                {playing ? t('skymap.time.pause') : t('skymap.time.play')}
              </button>
              <button type="button" className={styles.button} onClick={() => shift(600)}>
                {t('skymap.time.plusTen')}
              </button>
              <button type="button" className={styles.button} onClick={() => shift(3600)}>
                {t('skymap.time.plusHour')}
              </button>
              <button type="button" className={styles.button} onClick={() => shiftNight(1)}>
                {t('skymap.time.plusDay')}
              </button>
              {scene ? (
                <span className={styles.moonInfo}>
                  {t('skymap.time.moonInfo', {
                    alt: num(scene.moonAltDeg, 0),
                    sep: num(scene.moonSepDeg, 0),
                    pct: num(scene.moonIllumPct, 0),
                  })}
                </span>
              ) : null}
            </div>
            {/* Ebenen als Chips und die Sprache der Sternbildnamen (Vorlage `.op-tb`). */}
            <div className={styles.chips} role="group" aria-label={t('skymap.chips.label')}>
              {(
                [
                  ['constLines', t('skymap.constLines')],
                  ['constLabels', t('skymap.constLabels')],
                  ['constBounds', t('skymap.constBounds')],
                  ['eqGrid', t('skymap.chips.grid')],
                  ['milkyWay', t('skymap.milkyWay')],
                ] as const
              ).map(([key, label]) => (
                <label className={styles.chip} key={key}>
                  <input
                    type="checkbox"
                    checked={state.overlays.has(key)}
                    onChange={() => update({ overlays: toggle(state.overlays, key) })}
                  />
                  {label}
                </label>
              ))}
              <label className={styles.chip}>
                <input
                  type="checkbox"
                  checked={state.survey !== 'none'}
                  onChange={() =>
                    update({ survey: state.survey === 'none' ? 'dss2color' : 'none' })
                  }
                />
                {t('skymap.chips.photos')}
              </label>
              <label className={styles.chipSelect}>
                <span aria-hidden>{t('skymap.names.label')}</span>
                <select
                  aria-label={t('skymap.names.label')}
                  className={styles.input}
                  value={state.names}
                  onChange={(e) =>
                    update({ names: e.target.value === 'latin' ? 'latin' : 'local' })
                  }
                >
                  <option value="local">{t('skymap.names.local')}</option>
                  <option value="latin">{t('skymap.names.latin')}</option>
                </select>
              </label>
            </div>
          </section>
        </div>

        <ConfirmDialog
          open={confirmApply}
          title={t('skymap.applyConfirmTitle', { name: project.data?.name ?? '' })}
          consequence={
            removedPanels.length > 0
              ? t('skymap.applyConfirm', {
                  count: removedPanels.length,
                  soft: removedWithCaptures,
                })
              : t('skymap.applyConfirmGrow', {
                  from: Math.max(1, currentPanels.length),
                  to: newPanelCount,
                  lines: newPanelCount * linesPerPanel,
                })
          }
          confirmLabel={t('skymap.applyToProject')}
          variant={removedPanels.length > 0 ? 'danger' : 'default'}
          onConfirm={() => {
            setConfirmApply(false);
            apply.mutate();
          }}
          onCancel={() => setConfirmApply(false)}
        />
        <aside
          className={styles.side}
          aria-label={t('skymap.sideLabel')}
          data-collapsed={sideOpen ? undefined : 'true'}
        >
          <button
            type="button"
            className={styles.sideToggle}
            aria-expanded={sideOpen}
            aria-label={sideOpen ? t('skymap.side.collapse') : t('skymap.side.expand')}
            title={sideOpen ? t('skymap.side.collapse') : t('skymap.side.expand')}
            onClick={() => setSideOpen(!sideOpen)}
          >
            {sideOpen ? (
              <uiIcons.panelClose size={ICON_SIZE.button} aria-hidden />
            ) : (
              <uiIcons.panelOpen size={ICON_SIZE.button} aria-hidden />
            )}
          </button>
          {sideOpen ? (
            <Tabs<SideTab>
              label={t('skymap.sideLabel')}
              tabs={SIDE_TABS.map((k) => ({ key: k, label: t(`skymap.side.${k}`) }))}
              value={sideTab}
              onChange={setSideTab}
              keepMounted
              panelClassName={styles.sidePanel}
              panels={{
                field: (
                  <>
                    {/* Bildfeldmitte im Seitenbereich; Höhen- und Saisondiagramm stehen seit 28.09.2026 in der
                        Infokarte des gewählten Objekts über der Karte. */}
                    <Section title={t('skymap.side.frameCenter')}>
                      <div className={styles.coords}>
                        <CoordinateInput
                          kind="ra"
                          label={t('skymap.ra')}
                          valueDeg={state.fra}
                          onChange={(v) => v !== null && update({ fra: v, ra: v })}
                        />
                        <CoordinateInput
                          kind="dec"
                          label={t('skymap.dec')}
                          valueDeg={state.fdec}
                          onChange={(v) => v !== null && update({ fdec: v, dec: v })}
                        />
                      </div>
                    </Section>
                    <Section title={t('skymap.section.equipment')}>
                      <dl className={styles.facts}>
                        <dt>{t('skymap.site')}</dt>
                        <dd>{site?.name ?? '–'}</dd>
                        <dt>{t('skymap.telescope')}</dt>
                        <dd>{telescope?.name ?? '–'}</dd>
                        <dt>{t('skymap.camera')}</dt>
                        <dd>{camera?.name ?? '–'}</dd>
                      </dl>
                      <Field id="skymap-color" label={t('skymap.frameColor')}>
                        <select
                          id="skymap-color"
                          className={styles.input}
                          value={frameColor}
                          onChange={(e) => {
                            setFrameColor(e.target.value);
                            writeLocal(FRAME_COLOR_KEY, e.target.value);
                          }}
                        >
                          {Object.entries(FRAME_COLORS).map(([token, key]) => (
                            <option key={token} value={token}>
                              {t(`skymap.frameColors.${key}`)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field id="skymap-compare" label={t('skymap.compareRig')}>
                        <select
                          id="skymap-compare"
                          className={styles.input}
                          value={compareRig?.id ?? ''}
                          onChange={(e) => update({ compare: e.target.value || null })}
                        >
                          <option value="">{t('skymap.compareNone')}</option>
                          {rigList
                            .filter((r) => r.id !== rig?.id)
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                    </Section>
                    <Section title={t('skymap.section.field')}>
                      {rig ? (
                        <>
                          <dl className={styles.facts}>
                            <dt>{t('skymap.fov')}</dt>
                            <dd>
                              {fovText(rig.derived.fovWidthDeg)} ×{' '}
                              {fovText(rig.derived.fovHeightDeg)}
                            </dd>
                            <dt>{t('skymap.scale')}</dt>
                            <dd>{num(rig.derived.scaleArcsecPx, 2)}″/px</dd>
                            <dt>{t('skymap.focal')}</dt>
                            <dd>
                              {telescope
                                ? `${num(telescope.focalLengthMm * (telescope.reducerFactor ?? 1), 0)} mm`
                                : '–'}
                            </dd>
                          </dl>
                          <div className={styles.rotation}>
                            <label htmlFor="skymap-rot">{t('skymap.rotation')}</label>
                            <input
                              id="skymap-rot"
                              type="range"
                              min={0}
                              max={359.9}
                              step={0.1}
                              value={rotationLocked ? cameraAngle : pa}
                              disabled={rotationLocked}
                              onChange={(e) => update({ rot: Number(e.target.value) })}
                            />
                            <input
                              aria-label={t('skymap.rotation')}
                              className={styles.numberInput}
                              type="number"
                              min={0}
                              max={359.9}
                              step={0.1}
                              value={Math.round((rotationLocked ? cameraAngle : pa) * 10) / 10}
                              disabled={rotationLocked}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v)) update({ rot: ((v % 360) + 360) % 360 });
                              }}
                            />
                            <button
                              type="button"
                              className={styles.button}
                              onClick={() => update({ rot: null })}
                            >
                              {t('skymap.rotationReset')}
                            </button>
                            {canWriteRig ? (
                              <button
                                type="button"
                                className={styles.button}
                                disabled={pin.isPending || angleDiffDeg(pa, cameraAngle) < 0.05}
                                onClick={() => pin.mutate()}
                              >
                                {t('skymap.rotationPin')}
                              </button>
                            ) : null}
                          </div>
                          {rotationLocked ? (
                            <p className={styles.muted}>
                              {t('skymap.rotationLocked', { deg: num(cameraAngle, 1) })}
                            </p>
                          ) : rotationMismatch ? (
                            <p className={styles.warning} role="status">
                              {t('skymap.rotationMismatch', { deg: num(cameraAngle, 1) })}
                            </p>
                          ) : null}
                          {pin.isSuccess ? (
                            <p className={styles.success} role="status">
                              {t('skymap.rotationPinned')}
                            </p>
                          ) : null}
                          {pin.isError ? <ProblemMessage code={problemCode(pin.error)} /> : null}
                        </>
                      ) : (
                        <p className={styles.muted}>{t('skymap.noRig')}</p>
                      )}{' '}
                    </Section>
                    <Section title={t('skymap.section.mosaic')}>
                      <div className={styles.mosaic}>
                        <NumberBox
                          id="skymap-cols"
                          label={t('skymap.cols')}
                          value={state.cols}
                          min={1}
                          max={16}
                          onChange={(v) => update({ cols: v })}
                        />
                        <NumberBox
                          id="skymap-rows"
                          label={t('skymap.rows')}
                          value={state.rows}
                          min={1}
                          max={16}
                          onChange={(v) => update({ rows: v })}
                        />
                        <NumberBox
                          id="skymap-overlap"
                          label={t('skymap.overlap')}
                          value={state.overlap}
                          min={0}
                          max={60}
                          onChange={(v) => update({ overlap: v })}
                        />
                      </div>
                      <p className={styles.muted}>{t('skymap.mosaicHint')}</p>{' '}
                    </Section>
                  </>
                ),
                layers: (
                  <LayerTabs
                    state={state}
                    update={update}
                    toggle={toggle}
                    hasSite={site !== null}
                    onOrient={(o) => {
                      if (o === 'north')
                        update({
                          orient: 'north',
                          ra: centerRd.raDeg,
                          dec: centerRd.decDeg,
                          vaz: null,
                          valt: null,
                        });
                      else if (centerHor)
                        update({ orient: 'horizon', vaz: centerHor.azDeg, valt: centerHor.altDeg });
                    }}
                    photoStatus={photoStatus}
                    dsoCount={{ shown: dsoItems.length, total: dso.data?.total ?? 0 }}
                  />
                ),
              }}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** Reiter des Seitenbereichs (AP-26f). */
const SIDE_TABS = ['field', 'layers'] as const;
const SIDE_OPEN_KEY = 'npm.skymap.side';
type SideTab = (typeof SIDE_TABS)[number];

/** Rig-Rumpf für `PUT /rigs/{id}` mit neuer Standardrotation (Anheften, S-20). */
function rigBody(r: RigView, rotationDeg: number) {
  return {
    name: r.name,
    siteId: r.siteId,
    telescopeId: r.telescopeId,
    cameraId: r.cameraId,
    showInPlanning: r.showInPlanning,
    ninaDeliveryEnabled: r.ninaDeliveryEnabled,
    defaultTemplateId: r.defaultTemplateId,
    defaultRotationDeg: rotationDeg % 360,
    hasRotator: r.hasRotator,
    rotationToleranceDeg: r.rotationToleranceDeg,
    skipOnRotationMismatch: r.skipOnRotationMismatch,
    sessionReportDiscord: r.sessionReportDiscord,
    notes: r.notes,
  };
}

// ---- Bausteine der Seite --------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

function NumberBox({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  // Eigener Text während der Eingabe (P1-15): Leeren ergab vorher Number('') = 0 → auf 1 geklemmt, und die
  // nächste Ziffer 5 wurde zu „15“. Übernommen wird nur eine gültige Zahl im Bereich; beim Verlassen geklemmt.
  const [text, setText] = useState<string | null>(null);
  const parse = (s: string) => {
    const v = Number(s);
    return s.trim() === '' || !Number.isFinite(v) ? null : Math.round(v);
  };
  return (
    <Field id={id} label={label}>
      <input
        id={id}
        type="number"
        className={styles.numberInput}
        min={min}
        max={max}
        value={text ?? String(value)}
        onChange={(e) => {
          setText(e.target.value);
          const v = parse(e.target.value);
          if (v !== null && v >= min && v <= max && v !== value) onChange(v);
        }}
        onBlur={() => {
          const v = text === null ? null : parse(text);
          setText(null);
          if (v !== null) {
            const clamped = Math.min(max, Math.max(min, v));
            if (clamped !== value) onChange(clamped);
          }
        }}
      />
    </Field>
  );
}

/** Ebenen der Karte (Reiter *Ebenen* des Seitenbereichs): Himmelsfotos, Kataloge, Overlays. */
function LayerTabs({
  state,
  update,
  toggle,
  hasSite,
  onOrient,
  photoStatus,
  dsoCount,
}: {
  state: SkyMapState;
  update: (p: Partial<SkyMapState>) => void;
  toggle: <T>(set: ReadonlySet<T>, v: T) => Set<T>;
  hasSite: boolean;
  onOrient: (o: 'north' | 'horizon') => void;
  photoStatus: { shown: number; pending: number };
  dsoCount: { shown: number; total: number };
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'photos' | 'catalogs' | 'overlays'>('photos');
  const check = (key: Overlay, label: string, disabled = false) => (
    <label className={styles.check} key={key}>
      <input
        type="checkbox"
        checked={state.overlays.has(key)}
        disabled={disabled}
        onChange={() => update({ overlays: toggle(state.overlays, key) })}
      />
      {label}
    </label>
  );
  return (
    <div className={styles.layers}>
      <Tabs
        label={t('skymap.sidebarLabel')}
        tabs={(['photos', 'catalogs', 'overlays'] as const).map((k) => ({
          key: k,
          label: t(`skymap.sidebar.${k}`),
        }))}
        value={tab}
        onChange={setTab}
        keepMounted
        panelClassName={styles.panel}
        panels={{
          photos: (
            <>
              <fieldset className={styles.group}>
                <legend>{t('skymap.sidebar.photos')}</legend>
                {(['none', ...SURVEY_IDS] as const).map((s) => (
                  <label className={styles.check} key={s}>
                    <input
                      type="radio"
                      name="skymap-survey"
                      checked={state.survey === s}
                      onChange={() => update({ survey: s as SurveyId | 'none' })}
                    />
                    {t(`skymap.survey.${s}`)}
                  </label>
                ))}
              </fieldset>
              <div className={styles.field}>
                <label htmlFor="skymap-alpha">{t('skymap.photoAlpha')}</label>
                <input
                  id="skymap-alpha"
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={state.alpha}
                  onChange={(e) => update({ alpha: Number(e.target.value) })}
                />
              </div>
              {photoStatus.pending > 0 ? (
                <p className={styles.muted} role="status">
                  {t('skymap.photoLoading', { count: photoStatus.pending })}
                </p>
              ) : null}
              <p className={styles.muted}>{t('skymap.surveyNote')}</p>
            </>
          ),
          catalogs: (
            <>
              {check('dso', t('skymap.dso'))}
              {check('dsoSizes', t('skymap.dsoSizes'))}
              <div className={styles.field}>
                <label htmlFor="skymap-density">
                  {t('skymap.density', { mag: state.density })}
                </label>
                <input
                  id="skymap-density"
                  type="range"
                  min={4}
                  max={16}
                  step={0.5}
                  value={state.density}
                  onChange={(e) => update({ density: Number(e.target.value) })}
                />
              </div>
              {state.overlays.has('dso') ? (
                <p className={styles.muted}>{t('skymap.dsoCount', dsoCount)}</p>
              ) : null}
              {check('starNames', t('skymap.starNames'))}
              {check('milkyWay', t('skymap.milkyWay'))}
              {check('constLines', t('skymap.constLines'))}
              {check('constBounds', t('skymap.constBounds'))}
              {check('constLabels', t('skymap.constLabels'))}
            </>
          ),
          overlays: (
            <>
              <fieldset className={styles.group}>
                <legend>{t('skymap.group.projects')}</legend>
                {PROJECT_OVERLAYS.map((p) => (
                  <label className={styles.check} key={p}>
                    <input
                      type="checkbox"
                      checked={state.projects.has(p)}
                      onChange={() => update({ projects: toggle(state.projects, p) })}
                    />
                    <span className={styles.swatch} data-category={p} aria-hidden />
                    {t(`skymap.project.${p}`)}
                  </label>
                ))}
              </fieldset>
              <fieldset className={styles.group}>
                <legend>{t('skymap.group.coords')}</legend>
                {check('eqGrid', t('skymap.eqGrid'))}
                {check('altAzGrid', t('skymap.altAzGrid'), !hasSite)}
                {check('ecliptic', t('skymap.ecliptic'))}
                {check('galactic', t('skymap.galactic'))}
              </fieldset>
              <fieldset className={styles.group}>
                <legend>{t('skymap.group.observer')}</legend>
                {check('horizon', t('skymap.horizon'), !hasSite)}
                {check('minAlt', t('skymap.minAlt', { deg: DEFAULT_MIN_ALT }), !hasSite)}
                {check('meridian', t('skymap.meridian'), !hasSite)}
                {check('zenith', t('skymap.zenith'), !hasSite)}
                {check('heatmap', t('skymap.heatmap'), !hasSite)}
                <div className={styles.field}>
                  <label htmlFor="skymap-heat">
                    {t('skymap.heatAlt')}: {state.heat}°
                  </label>
                  <input
                    id="skymap-heat"
                    type="range"
                    min={0}
                    max={90}
                    step={1}
                    value={state.heat}
                    disabled={!hasSite || !state.overlays.has('heatmap')}
                    onChange={(e) => update({ heat: Number(e.target.value) })}
                  />
                </div>
                {!hasSite ? <p className={styles.muted}>{t('skymap.needsSite')}</p> : null}
              </fieldset>
              <fieldset className={styles.group}>
                <legend>{t('skymap.group.solar')}</legend>
                {check('sun', t('skymap.sun'), !hasSite)}
                {check('daySky', t('skymap.daySky'), !hasSite)}
                {check('moon', t('skymap.moon'), !hasSite)}
                {check('planets', t('skymap.planets'), !hasSite)}
              </fieldset>
              <fieldset className={styles.group}>
                <legend>{t('skymap.orientation')}</legend>
                <label className={styles.check}>
                  <input
                    type="radio"
                    name="skymap-orient"
                    checked={state.orient === 'north'}
                    onChange={() => onOrient('north')}
                  />
                  {t('skymap.orientNorth')}
                </label>
                <label className={styles.check}>
                  <input
                    type="radio"
                    name="skymap-orient"
                    checked={state.orient === 'horizon'}
                    disabled={!hasSite}
                    onChange={() => onOrient('horizon')}
                  />
                  {t('skymap.orientHorizon')}
                </label>
              </fieldset>
            </>
          ),
        }}
      />
    </div>
  );
}

/** Runder Knopf der Knopfleiste in der Karte (Vorlage `.op-map-ctrl button`). */
function MapButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.ctrlButton}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const wikiArticle = (lang: 'de' | 'en', title: string) =>
  `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
const wikiSearch = (lang: 'de' | 'en', q: string) =>
  `https://${lang}.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`;

function InfoCard({
  selected,
  rigId,
  canCreate,
  bright,
  scene,
  names,
  onClose,
  onCenter,
  onMoveFrame,
  charts,
}: {
  selected: NonNullable<Selected>;
  rigId: string | null;
  canCreate: boolean;
  bright: BrightSky | null;
  scene: ReturnType<typeof sceneAt> | null;
  names: 'local' | 'latin';
  onClose: () => void;
  onCenter: (v: sky.Vec3) => void;
  onMoveFrame: (ra: number, dec: number) => void;
  /** Höhen- und Saisondiagramm des Objekts als Reiter (Wunsch Sven 28.09.2026). */
  charts: (target: { raDeg: number; decDeg: number; label: string }) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'de';
  const num = useNumber();
  const titleId = useId();
  const wikipedia = useWikipedia();
  const close = (
    <button
      type="button"
      className={styles.closeButton}
      aria-label={t('skymap.info.close')}
      title={t('skymap.info.close')}
      onClick={onClose}
    >
      <uiIcons.remove size={ICON_SIZE.button} aria-hidden />
    </button>
  );
  if (selected.kind === 'project') {
    const p = selected.item;
    return (
      <section className={styles.info} aria-labelledby={titleId}>
        <header className={styles.infoHead}>
          <h2 id={titleId}>{p.name}</h2>
          {close}
        </header>
        <p className={styles.muted}>
          {t('skymap.info.status')}: {t(`skymap.project.${projectCategory(p)}`)}
        </p>
        <div className={styles.actions}>
          <Link className={styles.button} to={`/projekte/${p.id}`}>
            {t('skymap.info.openProject')}
          </Link>
        </div>
        {p.raDeg !== null && p.decDeg !== null
          ? charts({ raDeg: p.raDeg, decDeg: p.decDeg, label: p.name })
          : null}
      </section>
    );
  }

  // Ort, Titel, Typ und Helligkeit je Art.
  let vec: sky.Vec3 | null = null;
  let title = '';
  let kind = '';
  let mag: number | null = null;
  let extra: { dt: string; dd: string } | null = null;
  const links: { name: string; href: string; title?: string; wiki?: boolean }[] = [];
  if (selected.kind === 'dso') {
    const o = selected.item;
    vec = sky.radecToVec(o.raDeg, o.decDeg);
    title = o.displayName;
    kind = t(`catalog.groups.${o.group}`);
    mag = o.mag;
    extra = {
      dt: t('skymap.info.size'),
      dd: o.sizeMajorArcmin === null ? '–' : `${num(o.sizeMajorArcmin, 1)}′`,
    };
    // Wikipedia zuerst: Artikel aus dem Website-Auszug (FA-FRM-14), sonst die Suche.
    const wiki = wikipedia(o);
    links.push({ name: wiki.label, href: wiki.href, title: wiki.title, wiki: true });
    links.push(...researchLinks(o.displayName));
  } else if (selected.kind === 'star' && bright) {
    const i = selected.index;
    vec = starVec(bright, i);
    const name = bright.stars.names?.get(i);
    const bayer = bright.stars.bayer?.get(i);
    const rd = sky.vecToRadec(vec);
    const con = constellationAt(bright.bounds, rd.raDeg, rd.decDeg);
    mag = bright.stars.mag[i] ?? null;
    title = name
      ? lang === 'en'
        ? name.en
        : name.de
      : bayer && con
        ? `${bayer} ${con}`
        : t('skymap.info.starUnnamed', { mag: num(mag ?? 0, 1) });
    kind = t('skymap.info.kind.star');
    if (name || (bayer && con))
      links.push({
        name: 'Wikipedia',
        href: wikiSearch(
          lang,
          name ? (lang === 'en' ? name.en : name.de) : `${bayer ?? ''} ${con ?? ''}`,
        ),
        wiki: true,
      });
  } else if (selected.kind === 'body' && scene) {
    const id = selected.id;
    vec = bodyVec(scene.bodies, id);
    title =
      id === 'sun'
        ? t('skymap.sunLabel')
        : id === 'moon'
          ? t('skymap.moonLabel')
          : t(`skymap.planet.${id}`);
    kind = t(`skymap.info.kind.${id === 'sun' ? 'sun' : id === 'moon' ? 'moon' : 'planet'}`);
    mag = scene.bodies.planets.find((p) => p.id === id)?.mag ?? null;
    if (id === 'moon')
      extra = { dt: t('skymap.info.illum'), dd: `${num(scene.moonIllumPct, 0)} %` };
    links.push({ name: 'Wikipedia', href: wikiArticle(lang, t(`skymap.wiki.${id}`)), wiki: true });
  }
  if (!vec) return null;
  const rd = sky.vecToRadec(vec);
  const conAbbr = bright ? constellationAt(bright.bounds, rd.raDeg, rd.decDeg) : null;
  const conLabel = bright?.labels.find((l) => l.abbr === conAbbr);
  // Scheinbare Höhe wie Planung und Zeitleiste (Astronomie-Prüfung 28.09.2026; vorher geometrisch).
  const geo = scene ? toAltAz(scene.observer.toHorizon, vec) : null;
  const hor = geo ? { ...geo, altDeg: apparentAltitudeDeg(geo.altDeg) } : null;
  const target = vec;
  const q = new URLSearchParams({ ra: String(rd.raDeg), dec: String(rd.decDeg) });
  if (selected.kind === 'dso') q.set('objekt', selected.item.primaryId);
  if (rigId) q.set('rig', rigId);
  return (
    <section className={styles.info} aria-labelledby={titleId}>
      <header className={styles.infoHead}>
        <div>
          <p className={styles.infoKind}>{kind}</p>
          <h2 id={titleId}>{title}</h2>
        </div>
        {close}
      </header>
      <dl className={styles.facts}>
        {hor ? (
          <>
            <dt>{t('skymap.info.position')}</dt>
            <dd>
              {t(hor.altDeg >= 0 ? 'skymap.info.positionValue' : 'skymap.info.belowHorizon', {
                alt: num(hor.altDeg, 0),
                dir: t(`bodies.compass.${COMPASS[compassIndex(hor.azDeg)] ?? 's'}`),
              })}
            </dd>
          </>
        ) : null}
        {mag !== null ? (
          <>
            <dt>{t('skymap.info.mag')}</dt>
            <dd>{num(mag, 1)}</dd>
          </>
        ) : null}
        {extra ? (
          <>
            <dt>{extra.dt}</dt>
            <dd>{extra.dd}</dd>
          </>
        ) : null}
        {conLabel ? (
          <>
            <dt>{t('skymap.info.constellation')}</dt>
            <dd>{constellationName(conLabel, names, lang).replace(/ (Caput|Cauda)$/, '')}</dd>
          </>
        ) : null}
        <dt>{t('skymap.info.coords')}</dt>
        <dd>
          {formatCoordinate('ra', rd.raDeg, 'sexagesimal')} ·{' '}
          {formatCoordinate('dec', rd.decDeg, 'sexagesimal')}
        </dd>
      </dl>
      {links.length > 0 ? (
        <p className={styles.links}>
          {t('skymap.info.research')}:{' '}
          {links.map((l, i) => (
            <span key={l.name}>
              {i > 0 ? ' · ' : ''}
              <a href={l.href} target="_blank" rel="noopener noreferrer" title={l.title}>
                {l.wiki ? <WikipediaMark /> : null}
                {l.name}
              </a>
            </span>
          ))}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => onCenter(target)}>
          {t('skymap.info.center')}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => onMoveFrame(rd.raDeg, rd.decDeg)}
        >
          {t('skymap.info.moveFrame')}
        </button>
        {canCreate && selected.kind === 'dso' ? (
          <Link className={styles.button} to={`/projekte/neu?${q.toString()}`}>
            {t('skymap.info.createProject')}
          </Link>
        ) : null}
      </div>
      {/* Sonne und Mond wandern in der Nacht zu weit für eine feste Zielkurve; der Mond steht ohnehin im
          Diagramm. */}
      {selected.kind === 'body' && (selected.id === 'sun' || selected.id === 'moon')
        ? null
        : charts({ raDeg: rd.raDeg, decDeg: rd.decDeg, label: title })}
    </section>
  );
}

/**
 * Höhen- und Saisondiagramm des gewählten Objekts als Reiter in der Infokarte (Wunsch Sven 28.09.2026; vorher
 * unter der Karte, AP-26j). Klick ins Höhendiagramm stellt die Uhrzeit der Karte.
 */
function InfoCharts({
  site,
  nights,
  nightsError,
  onRetry,
  nightKey,
  target,
  time,
  tab,
  onTab,
  onTime,
}: {
  site: SiteView;
  nights: SiteNightsView | null;
  nightsError: boolean;
  onRetry: () => void;
  nightKey: string;
  target: { raDeg: number; decDeg: number; label: string };
  time: number;
  tab: 'altitude' | 'season';
  onTab: (t: 'altitude' | 'season') => void;
  onTime: (at: number) => void;
}) {
  const { t } = useTranslation();
  const { raDeg, decDeg, label } = target;
  const chart = useMemo(() => {
    if (!nights) return null;
    try {
      return nightChartFromEngine({
        site: { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg },
        night: nightKey,
        timeZoneTransitions: nights.timeZoneTransitions.map((z) => ({
          atUtc: Date.parse(z.atUtc) / 1000,
          utcOffsetMinutes: z.utcOffsetMinutes,
        })),
        timeZone: site.timeZone,
        targets: [
          {
            id: 'object',
            label,
            color: 'var(--npm-chart-target)',
            target: { raJ2000Deg: raDeg, decJ2000Deg: decDeg },
          },
        ],
        minAltDeg: DEFAULT_MIN_ALT,
        twilight: 'astronomical',
        transitLabel: t('projectEditor.charts.meridian'),
      }).props;
    } catch {
      return null;
    }
  }, [site, nights, nightKey, raDeg, decDeg, label, t]);
  return (
    <Tabs<'altitude' | 'season'>
      label={t('skymap.chartsLabel')}
      value={tab}
      onChange={onTab}
      tabs={[
        { key: 'altitude', label: t('nightChart.tabs.altitude') },
        { key: 'season', label: t('nightChart.tabs.season') },
      ]}
      toolbar={
        tab === 'altitude' ? (
          <span className={styles.muted}>{formatNightKey(nightKey)}</span>
        ) : undefined
      }
      panelClassName={styles.chartPanel}
      panels={{
        altitude: chart ? (
          <NightChart
            {...chart}
            bands={false}
            crop={false}
            height={160}
            cursorUtc={time}
            onCursorChange={onTime}
          />
        ) : (
          <NightChart
            window={null}
            timeZone={site.timeZone}
            state={nightsError ? 'error' : 'loading'}
            onRetry={onRetry}
          />
        ),
        season: (
          <SeasonPanel
            site={site}
            target={{ raDeg, decDeg }}
            conditions={{
              minAltitudeDeg: DEFAULT_MIN_ALT,
              minTimeOnTargetH: 1,
              twilight: 'astronomical',
            }}
          />
        ),
      }}
    />
  );
}
