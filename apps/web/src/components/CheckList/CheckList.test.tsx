// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { CheckList } from './index';

const items = [
  { id: 'a', label: 'Koordinaten', ok: true },
  { id: 'b', label: 'Belichtungsplan', ok: false, detail: 'keine aktive Zeile' },
  { id: 'c', label: 'Rig-Wunsch', ok: null },
];

describe('CheckList (§2.9)', () => {
  it('Zustand trägt die Symbolform und einen Text, nicht nur die Farbe (Rot-Grün-Sehschwäche)', async () => {
    render(<CheckList items={items} />);
    const rows = document.querySelectorAll('li');
    expect([...rows].map((r) => r.getAttribute('data-state'))).toEqual([
      'ok',
      'failed',
      'unchecked',
    ]);
    const icons = [...rows].map((r) => r.querySelector('svg')?.getAttribute('class') ?? '');
    expect(new Set(icons).size).toBe(3);
    const hidden = [...rows].map((r) => r.querySelector('.visually-hidden')?.textContent);
    expect(hidden).toEqual(['erfüllt: ', 'nicht erfüllt: ', 'nicht geprüft: ']);
    await expectNoSeriousA11y();
  });

  it('leer → empty', () => {
    render(<CheckList items={[]} />);
    expect(screen.getByText('Keine Prüfpunkte')).toBeInTheDocument();
  });

  it('Grenzfall: mehr als 8 Einträge und compact → „n von m erfüllt“ mit Aufklappen', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      label: `Punkt ${i}`,
      ok: i < 7,
    }));
    render(<CheckList items={many} compact />);
    expect(screen.getByText('7 von 10 erfüllt')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Alle anzeigen' });
    await userEvent.click(toggle);
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Weniger anzeigen' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
