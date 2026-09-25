/**
 * S-20 Sternkarte (FK 14.3; FA-FRM-02…12, AP-21): Werkzeugleiste in Abschnitten (Suche & Position, Rig,
 * Ausrüstung, Bildfeld, Mosaik, Aktionen), Himmelskarte in der Mitte, Seitenleiste mit Reitern
 * *Himmelsfotos* · *Kataloge* · *Overlays*, Zeitsteuerung unten mit Mondinfo und 24-h-Zeitleiste.
 * Der Zustand steht in der URL (`skymap/model.ts`). Ohne Rotator zeigt das Bildfeld den Kamerawinkel des
 * Rigs und warnt bei Abweichung (FA-FRM-05, NT-30). Die Übernahme des Mosaiks als Panels folgt mit AP-22.
 */
import { formatNightKey, formatTzAbbr, formatZonedTime } from '@nina-pm/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { sky } from '@nina-pm/engine';
import {
  catalogApi,
  equipmentApi,
  projectsApi,
  type DsoMarker,
  type DsoView,
  type ProjectListItem,
  type RigView,
} from '../../api/client';
import { useCan } from '../../auth';
import { CoordinateInput } from '../../components/CoordinateInput';
import { formatCoordinate } from '../../components/CoordinateInput/coords';
import { ICON_SIZE, actionIcons, uiIcons } from '../../components/icons';
import { NightChart } from '../../components/night-chart';
import { ProblemMessage } from '../../components/ProblemMessage';
import { RigSelect, type RigOption } from '../../components/RigSelect';
import { nightChartFromEngine } from '../../lib/night-chart-data';
import { problemCode } from '../admin/shared';
import { CatalogSearch } from '../catalog/CatalogSearch';
import { useEquipmentList, useNumber } from '../equipment/shared';
import { researchLinks } from '../projects/ProjectEditorPage';
import { PlanningTabs } from './PlanningTabs';
import {
  FOV_MAX,
  fovForFrame,
  paramsFromState,
  stateFromParams,
  type SkyMapState,
} from './skymap/model';
import {
  PROJECT_OVERLAYS,
  hitMarker,
  type FrameSpec,
  type Overlay,
  type ProjectFrame,
  type ProjectOverlay,
} from './skymap/render';
import { SkyCanvas } from './skymap/SkyCanvas';
import { fromZoned, nightKeyAt, sceneAt, zonedParts } from './skymap/scene';
import { loadBrightSky, loadFaintStars, type BrightSky, type StarField } from './skymap/sky-data';
import { SURVEY_IDS, type SurveyId } from './skymap/surveys';
import styles from './skymap/skymap.module.css';

const FRAME_COLORS = {
  frame: 'frame',
  'frame-compare': 'compare',
  'project-active': 'active',
  'project-submitted': 'submitted',
} as const;
const FRAME_COLOR_KEY = 'npm.skymap.frameColor';
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
  { kind: 'dso'; item: DsoMarker } | { kind: 'project'; item: ProjectListItem } | null;

export function SkyMapPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'en' ? 'en' : 'de';
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => stateFromParams(params), [params]);
  const projectParam = params.get('projekt');
  const objectParam = params.get('objekt');
  const update = (patch: Partial<SkyMapState>) => {
    const extra: Record<string, string> = {};
    if (projectParam) extra.projekt = projectParam;
    if (objectParam) extra.objekt = objectParam;
    setParams(paramsFromState({ ...state, ...patch }, extra), { replace: true });
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
  const rotationMismatch = rig !== null && !rig.hasRotator && Math.abs(pa - cameraAngle) > 0.05;

  const frame: FrameSpec | null = rig
    ? {
        raDeg: state.fra,
        decDeg: state.fdec,
        paDeg: rotationLocked ? cameraAngle : pa,
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

  const up: sky.Vec3 =
    state.orient === 'horizon' && scene
      ? sky.matVec(sky.transpose(scene.observer.toHorizon), [0, 0, 1])
      : [0, 0, 1];
  const center = sky.radecToVec(state.ra, state.dec);
  const regionRadius = Math.min(90, state.fov * 0.9);
  const bucket = Math.max(0.5, regionRadius / 2);
  // Weite Ansichten zeigen nur die helleren Objekte, sonst wird die Karte unlesbar.
  const magMax = Math.min(state.density, state.fov > 60 ? 8 : state.fov > 30 ? 9.5 : 16);
  const regionKey = [
    Math.round(state.ra / bucket) * bucket,
    Math.round(state.dec / bucket) * bucket,
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
              cols: 1,
              rows: 1,
              overlapPct: 0,
            },
          };
        }),
    [projects.data, rigList, rig, state.projects],
  );

  // ---- Auswahl ---------------------------------------------------------------------------------
  const [selected, setSelected] = useState<Selected>(null);
  const [photoStatus, setPhotoStatus] = useState({ shown: 0, pending: 0 });

  const moveTo = (raDeg: number, decDeg: number, fov?: number) =>
    update({ ra: raDeg, dec: decDeg, fra: raDeg, fdec: decDeg, ...(fov ? { fov } : {}) });

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
  const apply = useMutation({
    mutationFn: () => {
      const p = project.data;
      if (!p) throw new Error('kein Projekt');
      return projectsApi.patch(
        p.id,
        {
          raDeg: Math.round(state.fra * 1e6) / 1e6,
          decDeg: Math.round(state.fdec * 1e6) / 1e6,
          rotationDeg: Math.round(((frame?.paDeg ?? 0) % 360) * 100) / 100,
        },
        p.version,
      );
    },
    onSuccess: (view) => client.setQueryData(['projects', view.id], view),
  });
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
    const q = new URLSearchParams({
      ra: String(Math.round(state.fra * 1e6) / 1e6),
      dec: String(Math.round(state.fdec * 1e6) / 1e6),
      rot: String(Math.round((frame?.paDeg ?? 0) * 100) / 100),
    });
    if (rig) q.set('rig', rig.id);
    if (objectParam) q.set('objekt', objectParam);
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
    selectedId: selected ? selected.item.id : null,
    frameColor,
    lang: lang as 'de' | 'en',
    planetNames,
    moonLabel: t('skymap.moonLabel'),
    sunLabel: t('skymap.sunLabel'),
    zenithLabel: t('skymap.zenithLabel'),
  };

  const onPick = (x: number, y: number, view: sky.SkyView) => {
    const hitDso = state.overlays.has('dso') ? hitMarker(view, dsoItems, x, y) : null;
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
    setSelected(item ? { kind: 'project', item } : null);
  };

  // ---- Zeitleiste ------------------------------------------------------------------------------
  const nightKey = nightKeyAt(time, zone);
  const nights = useQuery({
    queryKey: ['site-nights', site?.id, 'from', nightKey],
    queryFn: () => equipmentApi.nights(site?.id ?? '', 2, nightKey),
    enabled: site !== null,
    staleTime: 60 * 60_000,
  });
  const chart = useMemo(() => {
    if (!site || !nights.data) return null;
    try {
      return nightChartFromEngine({
        site: { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg },
        night: nightKey,
        timeZoneTransitions: nights.data.timeZoneTransitions.map((z) => ({
          atUtc: Date.parse(z.atUtc) / 1000,
          utcOffsetMinutes: z.utcOffsetMinutes,
        })),
        timeZone: site.timeZone,
        targets: [
          {
            id: 'frame',
            label: t('skymap.time.target'),
            color: 'var(--npm-chart-target)',
            target: { raJ2000Deg: state.fra, decJ2000Deg: state.fdec },
          },
        ],
        minAltDeg: DEFAULT_MIN_ALT,
        twilight: 'astronomical',
        transitLabel: t('projectEditor.charts.meridian'),
      }).props;
    } catch {
      return null;
    }
  }, [site, nights.data, nightKey, state.fra, state.fdec, t]);

  const parts = zonedParts(time, zone);
  const shift = (sec: number) => {
    setPlaying(false);
    update({ t: time + sec });
  };

  return (
    <div className={styles.page}>
      <PlanningTabs />
      <nav aria-label={t('skymap.crumbs')} className={styles.muted}>
        {t('skymap.crumbs')}
      </nav>
      <h1 className={styles.title}>{t('skymap.title')}</h1>

      <div className={styles.toolbar} role="toolbar" aria-label={t('skymap.title')}>
        <Section title={t('skymap.section.search')}>
          <div className={styles.searchBox}>
            <CatalogSearch onPick={pickFromCatalog} />
          </div>
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
        <Section title={t('skymap.section.rig')}>
          <RigSelect
            rigs={rigOptions}
            value={rig?.id ?? null}
            onChange={(id) => update({ rig: id, rot: null })}
            label={t('skymap.section.rig')}
          />
          <span className={styles.muted}>
            {site ? `${t('skymap.site')}: ${site.name}` : t('skymap.noRig')}
          </span>
        </Section>
        <Section title={t('skymap.section.equipment')}>
          <dl className={styles.facts}>
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
                  {fovText(rig.derived.fovWidthDeg)} × {fovText(rig.derived.fovHeightDeg)}
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
                    disabled={pin.isPending || Math.abs(pa - cameraAngle) < 0.05}
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
          )}
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
          <p className={styles.muted}>{t('skymap.mosaicHint')}</p>
        </Section>
        <Section title={t('skymap.section.actions')}>
          <div className={styles.actions}>
            {canCreate ? (
              <Link className={styles.buttonPrimary} to={newProjectHref}>
                <actionIcons.add size={ICON_SIZE.button} aria-hidden />
                {t('skymap.newProject')}
              </Link>
            ) : null}
            {project.data && canUpdateProject ? (
              <button
                type="button"
                className={styles.button}
                disabled={apply.isPending}
                onClick={() => apply.mutate()}
              >
                <actionIcons.save size={ICON_SIZE.button} aria-hidden />
                {t('skymap.applyToProject')}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void mapArea.current?.requestFullscreen?.();
              }}
            >
              {fullscreen ? t('skymap.exitFullscreen') : t('skymap.fullscreen')}
            </button>
          </div>
          {apply.isSuccess ? (
            <p className={styles.success} role="status">
              {t('skymap.applied')}
            </p>
          ) : null}
          {apply.isError ? <ProblemMessage code={problemCode(apply.error)} /> : null}
        </Section>
      </div>

      <div className={styles.main} ref={mapArea}>
        <div className={styles.mapColumn}>
          <div className={styles.map} id={ids.map}>
            <SkyCanvas
              input={input}
              center={center}
              up={up}
              fovDeg={state.fov}
              survey={state.survey === 'none' ? null : state.survey}
              photoAlpha={state.alpha}
              label={t('skymap.mapLabel')}
              description={t('skymap.mapDescription', {
                ra: formatCoordinate('ra', state.ra, 'sexagesimal'),
                dec: formatCoordinate('dec', state.dec, 'sexagesimal'),
                fov: fovText(state.fov),
                fra: formatCoordinate('ra', state.fra, 'sexagesimal'),
                fdec: formatCoordinate('dec', state.fdec, 'sexagesimal'),
                rot: num(frame?.paDeg ?? 0, 1),
              })}
              onView={(c, fov) => {
                const r = sky.vecToRadec(c);
                update({ ra: r.raDeg, dec: r.decDeg, fov });
              }}
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
            {selected ? (
              <InfoCard
                selected={selected}
                rigId={rig?.id ?? null}
                canCreate={canCreate}
                onClose={() => setSelected(null)}
                onMoveFrame={(ra, dec) => update({ fra: ra, fdec: dec })}
              />
            ) : null}
          </div>

          <section className={styles.timebar} aria-label={t('skymap.time.label')}>
            <div className={styles.timeRow}>
              <Field id="skymap-date" label={t('skymap.time.date')}>
                <input
                  id="skymap-date"
                  type="date"
                  className={styles.input}
                  value={parts.date}
                  onChange={(e) => {
                    const v = fromZoned(e.target.value, parts.time, zone);
                    if (v !== null) update({ t: v });
                  }}
                />
              </Field>
              <Field id="skymap-clock" label={t('skymap.time.clock')}>
                <input
                  id="skymap-clock"
                  type="time"
                  className={styles.input}
                  value={parts.time}
                  onChange={(e) => {
                    const v = fromZoned(parts.date, e.target.value, zone);
                    if (v !== null) update({ t: v });
                  }}
                />
              </Field>
              <span className={styles.muted}>
                {t('skymap.time.zone', { zone: formatTzAbbr(new Date(time * 1000), zone) })}
              </span>
              <div className={styles.timeButtons}>
                <button type="button" className={styles.button} onClick={() => shift(-86400)}>
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
                <button type="button" className={styles.button} onClick={() => shift(86400)}>
                  {t('skymap.time.plusDay')}
                </button>
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
              </div>
              {scene ? (
                <span className={styles.moonInfo}>
                  {t('skymap.time.moonInfo', {
                    alt: num(scene.moonAltDeg, 0),
                    sep: num(scene.moonSepDeg, 0),
                    pct: num(scene.moonIllumPct, 0),
                  })}
                </span>
              ) : null}
              <div className={styles.timeButtons}>
                <button
                  type="button"
                  className={styles.button}
                  aria-label={t('skymap.time.zoomOut')}
                  title={t('skymap.time.zoomOut')}
                  onClick={() => update({ fov: Math.min(FOV_MAX, state.fov * 1.5) })}
                >
                  <uiIcons.unchecked size={ICON_SIZE.button} aria-hidden />
                </button>
                <span className={styles.muted}>
                  {t('skymap.time.zoom', { fov: fovText(state.fov) })}
                </span>
                <button
                  type="button"
                  className={styles.button}
                  aria-label={t('skymap.time.zoomIn')}
                  title={t('skymap.time.zoomIn')}
                  onClick={() => update({ fov: Math.max(0.1, state.fov / 1.5) })}
                >
                  <actionIcons.add size={ICON_SIZE.button} aria-hidden />
                </button>
              </div>
            </div>
            {site ? (
              <div className={styles.timeline}>
                <h2 className={styles.muted}>
                  {t('skymap.time.timeline')} · {formatNightKey(nightKey)}
                </h2>
                {chart ? (
                  <NightChart
                    {...chart}
                    markers={[
                      ...(chart.markers ?? []),
                      {
                        atUtc: time,
                        kind: 'now',
                        label: formatZonedTime(new Date(time * 1000), zone),
                      },
                    ]}
                    height={160}
                    onSelect={(at) => {
                      setPlaying(false);
                      update({ t: at });
                    }}
                  />
                ) : (
                  <NightChart
                    window={null}
                    timeZone={zone}
                    state={nights.isError ? 'error' : 'loading'}
                    onRetry={() => void nights.refetch()}
                  />
                )}
              </div>
            ) : null}
          </section>
        </div>

        <Sidebar
          state={state}
          update={update}
          toggle={toggle}
          hasSite={site !== null}
          photoStatus={photoStatus}
          dsoCount={{ shown: dsoItems.length, total: dso.data?.total ?? 0 }}
        />
      </div>
    </div>
  );
}

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
  return (
    <Field id={id} label={label}>
      <input
        id={id}
        type="number"
        className={styles.numberInput}
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, Math.round(v))));
        }}
      />
    </Field>
  );
}

function Sidebar({
  state,
  update,
  toggle,
  hasSite,
  photoStatus,
  dsoCount,
}: {
  state: SkyMapState;
  update: (p: Partial<SkyMapState>) => void;
  toggle: <T>(set: ReadonlySet<T>, v: T) => Set<T>;
  hasSite: boolean;
  photoStatus: { shown: number; pending: number };
  dsoCount: { shown: number; total: number };
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'photos' | 'catalogs' | 'overlays'>('photos');
  const tabIds = { base: useId() };
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
    <aside className={styles.sidebar} aria-label={t('skymap.sidebarLabel')}>
      <div role="tablist" className={styles.tabs} aria-label={t('skymap.sidebarLabel')}>
        {(['photos', 'catalogs', 'overlays'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`${tabIds.base}-${k}`}
            aria-selected={tab === k}
            aria-controls={`${tabIds.base}-${k}-panel`}
            className={tab === k ? styles.tabActive : styles.tab}
            onClick={() => setTab(k)}
          >
            {t(`skymap.sidebar.${k}`)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${tabIds.base}-photos-panel`}
        aria-labelledby={`${tabIds.base}-photos`}
        hidden={tab !== 'photos'}
        className={styles.panel}
      >
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
      </div>
      <div
        role="tabpanel"
        id={`${tabIds.base}-catalogs-panel`}
        aria-labelledby={`${tabIds.base}-catalogs`}
        hidden={tab !== 'catalogs'}
        className={styles.panel}
      >
        {check('dso', t('skymap.dso'))}
        {check('dsoSizes', t('skymap.dsoSizes'))}
        <div className={styles.field}>
          <label htmlFor="skymap-density">{t('skymap.density', { mag: state.density })}</label>
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
      </div>
      <div
        role="tabpanel"
        id={`${tabIds.base}-overlays-panel`}
        aria-labelledby={`${tabIds.base}-overlays`}
        hidden={tab !== 'overlays'}
        className={styles.panel}
      >
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
              onChange={() => update({ orient: 'north' })}
            />
            {t('skymap.orientNorth')}
          </label>
          <label className={styles.check}>
            <input
              type="radio"
              name="skymap-orient"
              checked={state.orient === 'horizon'}
              disabled={!hasSite}
              onChange={() => update({ orient: 'horizon' })}
            />
            {t('skymap.orientHorizon')}
          </label>
        </fieldset>
      </div>
    </aside>
  );
}

function InfoCard({
  selected,
  rigId,
  canCreate,
  onClose,
  onMoveFrame,
}: {
  selected: NonNullable<Selected>;
  rigId: string | null;
  canCreate: boolean;
  onClose: () => void;
  onMoveFrame: (ra: number, dec: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const num = useNumber();
  const titleId = useId();
  if (selected.kind === 'project') {
    const p = selected.item;
    return (
      <section className={styles.info} aria-labelledby={titleId}>
        <h2 id={titleId}>{p.name}</h2>
        <p className={styles.muted}>
          {t('skymap.info.status')}: {t(`skymap.project.${projectCategory(p)}`)}
        </p>
        <div className={styles.actions}>
          <Link className={styles.button} to={`/projekte/${p.id}`}>
            {t('skymap.info.openProject')}
          </Link>
          <button type="button" className={styles.button} onClick={onClose}>
            {t('skymap.info.close')}
          </button>
        </div>
      </section>
    );
  }
  const o = selected.item;
  const wiki = `https://${i18n.language === 'en' ? 'en' : 'de'}.wikipedia.org/w/index.php?search=${encodeURIComponent(o.displayName)}`;
  const links = [...researchLinks(o.displayName), { name: 'Wikipedia', href: wiki }];
  const q = new URLSearchParams({
    objekt: o.primaryId,
    ra: String(o.raDeg),
    dec: String(o.decDeg),
  });
  if (rigId) q.set('rig', rigId);
  return (
    <section className={styles.info} aria-labelledby={titleId}>
      <h2 id={titleId}>{o.displayName}</h2>
      <dl className={styles.facts}>
        <dt>{t('skymap.info.type')}</dt>
        <dd>{t(`catalog.groups.${o.group}`)}</dd>
        <dt>{t('skymap.info.mag')}</dt>
        <dd>{o.mag === null ? '–' : num(o.mag, 1)}</dd>
        <dt>{t('skymap.info.size')}</dt>
        <dd>{o.sizeMajorArcmin === null ? '–' : `${num(o.sizeMajorArcmin, 1)}′`}</dd>
      </dl>
      <p className={styles.links}>
        {t('skymap.info.research')}:{' '}
        {links.map((l, i) => (
          <span key={l.name}>
            {i > 0 ? ' · ' : ''}
            <a href={l.href} target="_blank" rel="noopener noreferrer">
              {l.name}
            </a>
          </span>
        ))}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={() => onMoveFrame(o.raDeg, o.decDeg)}
        >
          {t('skymap.info.moveFrame')}
        </button>
        {canCreate ? (
          <Link className={styles.button} to={`/projekte/neu?${q.toString()}`}>
            {t('skymap.info.createProject')}
          </Link>
        ) : null}
        <button type="button" className={styles.button} onClick={onClose}>
          {t('skymap.info.close')}
        </button>
      </div>
    </section>
  );
}
