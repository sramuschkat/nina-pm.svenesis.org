/**
 * Bausteinübersicht `/_bausteine` – nur mit `VITE_GALLERY=1` (Playwright: Theme-, Dichte-, Breiten- und
 * a11y-Tests je Baustein, components.md §4). Nie im prod-Build. Theme/Dichte über `?theme=&density=`.
 */
import { BUILT_IN_MOON_PROFILES } from '@nina-pm/shared';
import { DENSITIES, THEMES, type Density, type Theme } from '@nina-pm/ui-tokens';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAppearance } from '../app/theme';
import { CheckList } from '../components/CheckList';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CoordinateInput } from '../components/CoordinateInput';
import { FilterChip } from '../components/FilterChip';
import { NightChart } from '../components/night-chart';
import { nightChartFromEngine } from '../lib/night-chart-data';
import { NotificationList } from '../components/NotificationList';
import { ProgressBar } from '../components/ProgressBar';
import { RigSelect, type RigOption } from '../components/RigSelect';
import { SiteTime } from '../components/SiteTime';
import { StatusBadge } from '../components/StatusBadge';
import { EffortChip } from '../components/EffortChip';

const RIGS: RigOption[] = [
  {
    id: 'r1',
    name: 'Starfront RC8',
    siteName: 'Starfront',
    telescopeName: 'RC8',
    cameraName: 'ASI2600MM',
    scaleArcsecPx: 0.96,
    fovDeg: [1.7, 1.1],
    showInPlanning: true,
  },
  {
    id: 'r2',
    name: 'Heim-Refraktor',
    siteName: 'Hannover',
    telescopeName: 'FSQ-106',
    cameraName: 'ASI2600MC',
    scaleArcsecPx: 2.03,
    fovDeg: [3.4, 2.3],
    showInPlanning: false,
  },
];

/** NGC 281 an Starfront, Nacht 17./18.09.2026 (menschliche Freigabe AP-10: „Diagramm NGC 281 plausibel“). */
const NGC281_NIGHT = nightChartFromEngine({
  site: { latDeg: 31.5471, lonDeg: -99.3823 },
  night: '2026-09-17',
  timeZoneTransitions: [
    { atUtc: Date.UTC(2026, 2, 8, 8) / 1000, utcOffsetMinutes: -300 },
    { atUtc: Date.UTC(2026, 10, 1, 7) / 1000, utcOffsetMinutes: -360 },
  ],
  timeZone: 'America/Chicago',
  targets: [
    {
      id: 'ngc281',
      label: 'NGC 281',
      color: 'var(--npm-chart-target)',
      target: { raJ2000Deg: 13.2458, decJ2000Deg: 56.6194 },
    },
    {
      id: 'hat-p-17',
      label: 'HAT-P-17',
      color: 'var(--npm-chart-target-2)',
      target: { raJ2000Deg: 324.536375, decJ2000Deg: 30.488722 },
    },
  ],
  minAltDeg: 30,
  twilight: 'astronomical',
  transitLabel: 'Meridian',
  moonProfile: BUILT_IN_MOON_PROFILES.find((p) => p.name === 'moonProfile.moderate') ?? null,
}).props;

const GALLERY_EFFORT = {
  tag: 'single_night' as const,
  nights: 1,
  achievablePct: null,
  requiredHours: 4.2,
  bestNight: '2026-10-12',
  bestNightHoursByStage: [
    { moonProfileId: null, filters: ['Ha', 'OIII'], hours: 2.1 },
    { moonProfileId: 'p', filters: ['L'], hours: 2.1 },
  ],
  limitingFactor: null,
  earliestCompletion: '2026-10-12',
  fullyObservable: null,
  coveragePct: null,
  fromNight: '2026-09-24',
  toNight: '2027-01-15',
};

export default function Gallery() {
  const [params] = useSearchParams();
  const { setTheme, setDensity } = useAppearance();
  const [ra, setRa] = useState<number | null>(13.204167);
  const [dialog, setDialog] = useState(false);
  const theme = params.get('theme');
  const density = params.get('density');

  useEffect(() => {
    if ((THEMES as readonly string[]).includes(theme ?? '')) setTheme(theme as Theme);
    if ((DENSITIES as readonly string[]).includes(density ?? '')) setDensity(density as Density);
  }, [theme, density, setTheme, setDensity]);

  return (
    <main
      id="main"
      style={{
        padding: 'var(--npm-space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--npm-space-5)',
      }}
    >
      <h1>Bausteine</h1>
      <section data-component="FilterChip" style={{ display: 'flex', gap: 'var(--npm-space-2)' }}>
        <FilterChip shortName="L" color="#9e9e9e" />
        <FilterChip shortName="Ha" color="#d32f2f" selected onToggle={() => undefined} />
        <FilterChip shortName="OIII" color="#00e5ff" onToggle={() => undefined} />
        <FilterChip shortName="SII" color="#ffeb3b" size="sm" />
      </section>
      <section data-component="ProgressBar">
        <ProgressBar acquired={22} planned={60} rejected={3} bonus={2} exposureS={300} />
        <ProgressBar acquired={62} planned={60} exposureS={300} />
        <ProgressBar acquired={0} planned={0} />
      </section>
      <section
        data-component="StatusBadge"
        style={{ display: 'flex', gap: 'var(--npm-space-2)', flexWrap: 'wrap' }}
      >
        <StatusBadge kind="project" value="active" />
        <StatusBadge kind="approval" value="submitted" />
        <StatusBadge kind="approval" value="rejected" />
        <StatusBadge kind="session" value="stale" />
        <StatusBadge kind="transit" value="locked" />
        <StatusBadge kind="project" value="unknown_value" />
      </section>
      <section
        data-component="EffortChip"
        style={{ display: 'flex', gap: 'var(--npm-space-2)', flexWrap: 'wrap' }}
      >
        <EffortChip effort={GALLERY_EFFORT} />
        <EffortChip effort={{ ...GALLERY_EFFORT, tag: 'multi_night', nights: 4 }} stale />
        <EffortChip
          effort={{
            ...GALLERY_EFFORT,
            tag: 'not_feasible',
            nights: 20,
            achievablePct: 66,
            earliestCompletion: null,
            limitingFactor: { lineId: 'l', filterShortName: 'L', reason: 'moon_blocked' },
          }}
          size="sm"
        />
        <EffortChip
          effort={{ ...GALLERY_EFFORT, tag: 'transit', fullyObservable: false, coveragePct: 80 }}
        />
        <EffortChip effort={{ ...GALLERY_EFFORT, tag: null }} />
        <EffortChip effort={null} />
        <EffortChip effort={null} state="loading" />
        <EffortChip effort={null} state="error" onRetry={() => undefined} />
      </section>
      <section data-component="CheckList">
        <CheckList
          items={[
            { id: 'a', label: 'Koordinaten', ok: true },
            { id: 'b', label: 'Belichtungsplan', ok: false, detail: 'keine aktive Zeile' },
            { id: 'c', label: 'Rig-Wunsch', ok: null },
          ]}
        />
      </section>
      <section data-component="CoordinateInput" style={{ maxWidth: 'none' }}>
        <CoordinateInput kind="ra" valueDeg={ra} onChange={setRa} />
        <CoordinateInput kind="dec" valueDeg={56.63} onChange={() => undefined} />
      </section>
      <section data-component="RigSelect">
        <RigSelect rigs={RIGS} value="r1" onChange={() => undefined} label="Rig" />
      </section>
      <section data-component="SiteTime">
        <SiteTime atUtc="2026-09-18T02:08:00Z" siteTimeZone="America/Chicago" />
      </section>
      <section data-component="NotificationList" style={{ maxWidth: 420 }}>
        <NotificationList
          state="ready"
          tenantTimeZone="Europe/Berlin"
          onMarkRead={() => undefined}
          items={[
            {
              id: 'n1',
              kind: 'role.changed',
              payload: { from: 'user', to: 'admin' },
              readAt: null,
              createdAt: '2026-09-24T10:00:00Z',
            },
            {
              id: 'n2',
              kind: 'approval.returned',
              payload: { subject: 'NGC 7380 – Fischkopfnebel, sehr langer Objektname mit Umbruch' },
              readAt: null,
              createdAt: '2026-09-23T19:30:00Z',
            },
            {
              id: 'n3',
              kind: 'alert.session_no_heartbeat',
              payload: {},
              readAt: '2026-09-23T06:00:00Z',
              createdAt: '2026-09-23T02:08:00Z',
            },
          ]}
        />
        <NotificationList state="ready" tenantTimeZone="Europe/Berlin" items={[]} />
      </section>
      <section data-component="Table">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ height: 'var(--npm-row-h)' }}>
              <th style={{ textAlign: 'left', padding: '0 var(--npm-space-2)' }}>Projekt</th>
              <th style={{ textAlign: 'left', padding: '0 var(--npm-space-2)' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {['NGC 7380', 'M 31', 'IC 1805'].map((name) => (
              <tr
                key={name}
                style={{ height: 'var(--npm-row-h)', borderTop: '1px solid var(--npm-border)' }}
              >
                <td style={{ padding: '0 var(--npm-space-2)' }}>{name}</td>
                <td style={{ padding: '0 var(--npm-space-2)' }}>
                  <StatusBadge kind="project" value="active" size="sm" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section data-component="NightChart">
        <NightChart {...NGC281_NIGHT} secondaryTimeZone="Europe/Berlin" />
        <NightChart window={NGC281_NIGHT.window} series={[]} timeZone="America/Chicago" />
      </section>
      <section data-component="ConfirmDialog">
        <button type="button" onClick={() => setDialog(true)}>
          Dialog öffnen
        </button>
        <ConfirmDialog
          open={dialog}
          title="Projekt NGC 7380 löschen?"
          consequence="Das Projekt wird in den Papierkorb verschoben und kann von Admins wiederhergestellt werden."
          confirmLabel="Löschen"
          variant="danger"
          onConfirm={() => setDialog(false)}
          onCancel={() => setDialog(false)}
        />
      </section>
    </main>
  );
}
