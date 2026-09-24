/**
 * Bausteinübersicht `/_bausteine` – nur mit `VITE_GALLERY=1` (Playwright: Theme-, Dichte-, Breiten- und
 * a11y-Tests je Baustein, components.md §4). Nie im prod-Build. Theme/Dichte über `?theme=&density=`.
 */
import { DENSITIES, THEMES, type Density, type Theme } from '@nina-pm/ui-tokens';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAppearance } from '../app/theme';
import { CheckList } from '../components/CheckList';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CoordinateInput } from '../components/CoordinateInput';
import { FilterChip } from '../components/FilterChip';
import { ProgressBar } from '../components/ProgressBar';
import { RigSelect, type RigOption } from '../components/RigSelect';
import { SiteTime } from '../components/SiteTime';
import { StatusBadge } from '../components/StatusBadge';

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
