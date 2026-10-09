// @vitest-environment jsdom
/**
 * Reiter „Bilder“ im Projekt (AP-72b): Anfang auf „markiert“, Chips mit Anzahl, Bezugsleiste mit Grenzwerten, Seitenleiste
 * mit Vorschlag und Grenze in ″, ↑/↓ wechseln das Bild, „Markierte verwerfen“ mit Rückfrage, Behalten, Bild aus der Nacht
 * vorgewählt; axe. Dazu das Modell (Auswahl, Zähler, CSV).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { ProjectImage, ProjectImagesView } from '../../api/client';
import { AuthProvider } from '../../auth';
import { gradeCounts, imagesCsv, selectImages } from './images-model';
import { ProjectImagesTab } from './ProjectImagesTab';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  view: null as unknown,
  reject: vi.fn(),
  keep: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: {
    me: () =>
      Promise.resolve({
        identity: {
          id: '1',
          discordUserId: '1',
          username: 'u',
          globalName: 'Uta',
          avatarHash: null,
          mfa: true,
        },
        context: 'tenant',
        tenant: { id: '2', key: 'demo', name: 'Demo', timeZone: 'America/Chicago' },
        member: { id: '3', displayName: 'Uta', role: 'owner', effectiveRole: 'admin' },
        isSuperUser: false,
        mfaRequired: false,
        memberships: [],
      }),
  },
  sessionsApi: {
    projectImages: () => Promise.resolve(state.view),
    rejectImages: (...a: unknown[]) => state.reject(...a) as Promise<unknown>,
    keepImage: (...a: unknown[]) => state.keep(...a) as Promise<unknown>,
  },
}));

const image = (n: number, over: Partial<ProjectImage> = {}): ProjectImage => ({
  id: ID(n),
  sessionId: ID(900),
  night: '2026-10-08',
  capturedAt: `2026-10-09T0${String(n % 9)}:10:00Z`,
  filter: 'R',
  exposureS: 180,
  gain: 125,
  offset: 50,
  binning: 1,
  isBonus: false,
  rejected: false,
  rejectReason: null,
  kept: false,
  grade: 'ok',
  flags: [],
  fileName: `img_${String(n)}.fits`,
  relativePath: `2026-10-09/LDN1228/LIGHT/img_${String(n)}.fits`,
  hfr: 3,
  hfrArcsec: 1.5,
  stars: 640,
  rmsArcsec: 0.6,
  rmsRaArcsec: 0.4,
  rmsDecArcsec: 0.45,
  cloudCoverPct: 0,
  skyQualityMag: 21.4,
  altitudeDeg: 42,
  airmass: 1.49,
  focusPosition: 2065,
  focuserTemperatureC: 9.8,
  medianAdu: 1480,
  saturatedPct: 0.02,
  sensorTempC: -10,
  setPointC: -10,
  ...over,
});

const view = (): ProjectImagesView => ({
  projectId: ID(10),
  rigId: ID(20),
  settings: { mode: 'mark', hfrPct: 30, starsPct: 50, rmsArcsec: 1.5, cloudPct: 50 },
  scaleArcsecPx: 0.5,
  minRef: 10,
  refs: [{ filter: 'R', hfr: 3.04, hfrArcsec: 1.52, stars: 640, rmsArcsec: 0.58, n: 214 }],
  items: [
    image(1, {
      grade: 'flagged',
      flags: [{ metric: 'hfr', value: 4.2, limit: 3.952 }],
      hfr: 4.2,
      hfrArcsec: 2.1,
    }),
    image(2, {
      grade: 'flagged',
      flags: [{ metric: 'rms', value: 1.7, limit: 1.5 }],
      rmsArcsec: 1.7,
    }),
    image(3),
    image(4, { grade: 'rejected', rejected: true, rejectReason: 'auto_quality' }),
    image(5, { filter: 'L', night: '2026-10-07' }),
  ],
  truncated: false,
  canCorrect: true,
});

const wrap = (initialImageId: string | null = null) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AuthProvider>
          <ProjectImagesTab projectId={ID(10)} initialImageId={initialImageId} />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.view = view();
  state.reject.mockReset().mockResolvedValue({ changed: 2, skipped: 0, projectStatus: null });
  state.keep.mockReset().mockResolvedValue({ captureId: ID(1), kept: true });
});

describe('Reiter „Bilder“ (AP-72b)', () => {
  it('beginnt mit den markierten, zeigt Bezug, Grenzwerte und den Vorschlag des ersten; axe', async () => {
    const { container } = wrap();
    const table = await screen.findByRole('table', { name: '2 Bilder' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    const grading = screen.getByRole('group', { name: 'Bewertung' });
    expect(
      within(grading)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Alle 5', 'markiert 2', 'verworfen 1', 'ok 2']);
    expect(
      screen.getByText(/Grenzwerte des Rigs: HFR \+30 % · Sterne unter 50 % · RMS 1,5″/),
    ).toBeTruthy();
    const side = screen.getByRole('complementary', { name: 'Bild-Details' });
    expect(within(side).getByText('Vorschlag: verwerfen')).toBeTruthy();
    // Grenze 3,952 px × 0,5 ″/px.
    expect(within(side).getByText('HFR 2,1″ · Grenze 1,98″')).toBeTruthy();
    expect(within(side).getByText('2026-10-09/LDN1228/LIGHT/img_1.fits')).toBeTruthy();
    await expectNoSeriousA11y(container);
  });

  it('↓ wechselt zum nächsten Bild; Behalten und Markierte verwerfen (mit Rückfrage)', async () => {
    wrap();
    await screen.findByRole('table', { name: '2 Bilder' });
    const side = screen.getByRole('complementary', { name: 'Bild-Details' });
    fireEvent.keyDown(side, { key: 'ArrowDown' });
    expect(within(side).getByText('Guiding-RMS 1,7″ · Grenze 1,5″')).toBeTruthy();
    fireEvent.click(within(side).getByRole('button', { name: 'Behalten' }));
    await waitFor(() => expect(state.keep).toHaveBeenCalledWith(ID(2), true));
    fireEvent.click(screen.getByRole('button', { name: 'Markierte verwerfen (2)' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Verwerfen' }),
    );
    await waitFor(() => expect(state.reject).toHaveBeenCalledWith(ID(10), [ID(1), ID(2)], true));
  });

  it('Bild aus der Nacht: vorgewählt mit seinem Filter und seiner Nacht', async () => {
    wrap(ID(5));
    const side = await screen.findByRole('complementary', { name: 'Bild-Details' });
    expect(within(side).getByText('Bewertung: ok')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'L' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Modell', () => {
  it('Auswahl, Zähler und CSV', () => {
    const items = view().items;
    expect(selectImages(items, { filter: 'R', grade: 'ok', night: null }).map((i) => i.id)).toEqual(
      [ID(3)],
    );
    expect(gradeCounts(items, { filter: null, night: '2026-10-07' })).toEqual({
      all: 1,
      flagged: 0,
      rejected: 0,
      ok: 1,
    });
    const csv = imagesCsv(items.slice(0, 1), ['a', 'b']);
    expect(csv.split('\n')[1]).toContain(
      'hfr;2.1;640;0.6;0;img_1.fits;2026-10-09/LDN1228/LIGHT/img_1.fits',
    );
  });
});
