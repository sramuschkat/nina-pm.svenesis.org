/**
 * *Himmelslage* im Projekt-Editor S-31 (AP-26b): kleine Übersichtskarte um das Ziel mit Sternbildern,
 * Milchstraße und dem Bildfeld des Rigs als Zielmarke. Zeichnet mit der Sternkarte (S-20, `SkyCanvas`),
 * ohne Fotos, Katalog und Himmelskörper; Ziehen und Zoomen verändern nur diese Ansicht. Die volle
 * Sternkarte öffnet der Link im Reiter *Ziel*. Dieselbe Ansicht steht im Objektbrowser (Reiter neben Höhen- und
 * Saisondiagramm) und bei den Exoplaneten (Wunsch Sven 02.10.2026).
 */
import { sky } from '@nina-pm/engine';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCoordinate } from '../../components/CoordinateInput/coords';
import { SkyCanvas } from '../planning/skymap/SkyCanvas';
import type { Overlay, ProjectOverlay } from '../planning/skymap/render';
import { loadBrightSky, type BrightSky } from '../planning/skymap/sky-data';
import styles from './projects.module.css';

const OVERLAYS: ReadonlySet<Overlay> = new Set<Overlay>([
  'milkyWay',
  'eqGrid',
  'constLines',
  'constLabels',
  'starNames',
]);
const NO_PROJECTS: ReadonlySet<ProjectOverlay> = new Set<ProjectOverlay>();
const START_FOV = 40;

export function SkyLocation({
  raDeg,
  decDeg,
  rotationDeg,
  fov,
  name,
  hint,
  frameClassName,
}: {
  raDeg: number | null;
  decDeg: number | null;
  rotationDeg: number;
  /** Bildfeld des Rigs (Grad); ohne Rig nur die Zielmarke. */
  fov: { widthDeg: number; heightDeg: number } | null;
  name: string;
  /** Hinweis unter der Karte; Standard: Projekt-Hinweis mit Verweis auf Ausrichten und Mosaik. */
  hint?: string;
  /** Zusätzliche Klasse für den Rahmen der Karte (Größe), z. B. quadratisch neben dem Sternfeld. */
  frameClassName?: string;
}) {
  const { t, i18n } = useTranslation();
  const [bright, setBright] = useState<BrightSky | null>(null);
  const [view, setView] = useState<{ center: sky.Vec3; fovDeg: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadBrightSky()
      .then((b) => alive && setBright(b))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  // Neues Ziel: Ansicht wieder auf das Ziel setzen.
  const [target, setTarget] = useState({ raDeg, decDeg });
  if (target.raDeg !== raDeg || target.decDeg !== decDeg) {
    setTarget({ raDeg, decDeg });
    setView(null);
  }
  if (raDeg === null || decDeg === null)
    return <p className={styles.note}>{t('projectEditor.sky.needsCoordinates')}</p>;
  // Ohne Rig: kleiner Rahmen (1°) als Zielmarke.
  const frame = {
    raDeg,
    decDeg,
    paDeg: rotationDeg,
    fovWidthDeg: fov?.widthDeg ?? 1,
    fovHeightDeg: fov?.heightDeg ?? 1,
    cols: 1,
    rows: 1,
    overlapPct: 0,
  };
  const center = view?.center ?? sky.radecToVec(raDeg, decDeg);
  const fovDeg = view?.fovDeg ?? START_FOV;
  return (
    <div className={styles.skyLocation}>
      <div className={frameClassName ? `${styles.skyCanvas} ${frameClassName}` : styles.skyCanvas}>
        <SkyCanvas
          input={{
            overlays: OVERLAYS,
            projectOverlays: NO_PROJECTS,
            bright,
            faint: null,
            dso: [],
            observer: null,
            bodies: null,
            projects: [],
            frame,
            compare: null,
            selectedId: null,
            selectedVec: null,
            names: 'local',
            frameColor: 'frame',
            lang: i18n.language === 'en' ? 'en' : 'de',
            planetNames: {},
            moonLabel: t('skymap.moonLabel'),
            sunLabel: t('skymap.sunLabel'),
            zenithLabel: t('skymap.zenithLabel'),
            compassLabels: [],
            milkyWayLabel: '',
          }}
          center={center}
          up={[0, 0, 1]}
          fovDeg={fovDeg}
          survey={null}
          photoAlpha={0}
          label={t('projectEditor.sky.label', { name })}
          description={t('projectEditor.sky.description', {
            ra: formatCoordinate('ra', raDeg, 'sexagesimal'),
            dec: formatCoordinate('dec', decDeg, 'sexagesimal'),
            fov: Math.round(fovDeg),
          })}
          onView={(c, f) => setView({ center: c, fovDeg: f })}
          onFrameMove={() => undefined}
          onPick={() => undefined}
        />
      </div>
      <p className={styles.muted}>{hint ?? t('projectEditor.sky.hint')}</p>
    </div>
  );
}
