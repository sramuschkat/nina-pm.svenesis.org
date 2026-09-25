// @vitest-environment jsdom
/**
 * AP-22: Panel-Liste im Projekt-Editor (FA-PRJ-06) – Nummer = NINA-Nummer, Umsortieren mit If-Match,
 * aktiv/inaktiv, Löschen nur über ConfirmDialog (mit Aufnahmen weich), Rig-Schalter „Panels getrennt
 * planen“ nur mit `rig.settings.write`, Link „Mosaik in der Sternkarte bearbeiten“; axe.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import type { ProjectView, RigView } from '../../api/client';
import { PanelList } from './PanelList';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = vi.hoisted(() => ({
  reorder: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  scheduler: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  projectsApi: {
    reorderPanels: (...a: unknown[]) => state.reorder(...a) as Promise<unknown>,
    patchPanel: (...a: unknown[]) => state.patch(...a) as Promise<unknown>,
    deletePanel: (...a: unknown[]) => state.remove(...a) as Promise<unknown>,
    addPanel: () => Promise.resolve({ id: ID(1) }),
  },
  equipmentApi: {
    schedulerSettings: (...a: unknown[]) => state.scheduler(...a) as Promise<unknown>,
  },
}));

const panel = (n: number, over: Record<string, unknown> = {}) => ({
  id: ID(100 + n),
  panelIndex: n - 1,
  label: `Panel ${String(n)}`,
  raDeg: 314 + n * 0.1,
  decDeg: 44.5,
  rotationDeg: 30,
  notes: '',
  enabled: true,
  lines: [] as { hasCaptures: boolean }[],
  ...over,
});

const project = (): ProjectView =>
  ({
    id: ID(1),
    version: 5,
    raDeg: 314.75,
    decDeg: 44.53,
    rotationDeg: 30,
    rigId: ID(500),
    mosaic: { cols: 3, rows: 1, overlapPct: 15 },
    panels: [panel(1), panel(2, { lines: [{ hasCaptures: true }] }), panel(3, { enabled: false })],
  }) as unknown as ProjectView;

const rig = {
  id: ID(500),
  name: 'Rig A',
  settingsVersion: 2,
  scheduler: { mosaicPanelsIndependent: true, strategy: 'proportional' },
  derived: { fovWidthDeg: 2.8, fovHeightDeg: 1.9 },
} as unknown as RigView;

const renderList = (o: { canEdit?: boolean; canRigSettings?: boolean } = {}) => {
  const onChange = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <PanelList
          project={project()}
          rig={rig}
          canEdit={o.canEdit ?? true}
          canRigSettings={o.canRigSettings ?? false}
          onChange={onChange}
          onReload={() => Promise.resolve()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onChange;
};

beforeEach(() => {
  for (const fn of Object.values(state)) fn.mockReset();
});

describe('Panel-Liste (FA-PRJ-06)', () => {
  it('zeigt Nummer, Bezeichnung, Rotation, aktiv; Mosaik und Link zur Sternkarte', async () => {
    renderList();
    expect(screen.getByText('Mosaik 3 × 1 · 15 % Überlappung')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByLabelText('Bezeichnung Panel 1')).toHaveValue(
      'Panel 1',
    );
    expect(screen.getByLabelText('Panel 3 aktiv')).not.toBeChecked();
    const link = screen.getByRole('link', { name: 'Mosaik in der Sternkarte bearbeiten' });
    const q = new URLSearchParams(link.getAttribute('href')?.split('?')[1]);
    expect(q.get('h')).toBe('3');
    expect(q.get('projekt')).toBe(ID(1));
    await expectNoSeriousA11y();
  });

  it('Umsortieren sendet die neue Reihenfolge mit If-Match', async () => {
    state.reorder.mockResolvedValue({ id: ID(1) });
    const onChange = renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Panel 2 nach oben' }));
    await waitFor(() =>
      expect(state.reorder).toHaveBeenCalledWith(ID(1), [ID(102), ID(101), ID(103)], 5),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Panel 1 nach oben' })).toBeDisabled();
  });

  it('aktiv umschalten', async () => {
    state.patch.mockResolvedValue({ id: ID(1) });
    renderList();
    fireEvent.click(screen.getByLabelText('Panel 3 aktiv'));
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith(ID(1), ID(103), { enabled: true }),
    );
  });

  it('Löschen nur über ConfirmDialog; mit Aufnahmen wird ausgeblendet', async () => {
    state.remove.mockResolvedValue({ soft: true });
    renderList();
    fireEvent.click(screen.getByRole('button', { name: '„Panel 2“ löschen' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Das Panel hat Aufnahmen');
    expect(state.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith(ID(1), ID(102)));
  });

  it('Rig-Schalter „Panels getrennt planen“ nur mit Rig-Recht', async () => {
    renderList({ canRigSettings: false });
    expect(
      screen.getByLabelText('Panels getrennt planen (Einstellung des Rigs Rig A)'),
    ).toBeDisabled();
  });

  it('Admin schaltet die Rig-Einstellung um (If-Match)', async () => {
    state.scheduler.mockResolvedValue({});
    renderList({ canRigSettings: true });
    fireEvent.click(screen.getByLabelText('Panels getrennt planen (Einstellung des Rigs Rig A)'));
    await waitFor(() =>
      expect(state.scheduler).toHaveBeenCalledWith(
        ID(500),
        expect.objectContaining({ mosaicPanelsIndependent: false, strategy: 'proportional' }),
        2,
      ),
    );
  });

  it('ohne Bearbeitungsrecht nur lesend', () => {
    renderList({ canEdit: false });
    expect(screen.getByLabelText('Panel 1 aktiv')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Panel hinzufügen' })).not.toBeInTheDocument();
  });
});
