// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { formatCoordinate, parseCoordinate } from './coords';
import { CoordinateInput } from './index';

describe('parseCoordinate (§2.6)', () => {
  it.each([
    ['ra', '00h 52m 49s', 13.204167],
    ['ra', '00 52 49', 13.204167],
    ['ra', '00:52:49', 13.204167],
    ['ra', '13.2046', 13.2046],
    ['ra', '24h 00m', 0],
    ['dec', '+56° 37′ 48″', 56.63],
    ['dec', '56:37:48', 56.63],
    ['dec', '-12 30 00', -12.5],
    ['dec', '−12,5', -12.5],
    ['lat', '52.3705', 52.3705],
    ['lon', '-104.9', -104.9],
  ] as const)('%s „%s“ → %f', (kind, input, expected) => {
    expect(parseCoordinate(kind, input)).toEqual({ ok: true, valueDeg: expected });
  });

  it('Grenzfall: Dec über 90° → Fehler, kein stilles Abschneiden', () => {
    expect(parseCoordinate('dec', '+91° 00′')).toEqual({ ok: false, reason: 'range' });
    expect(parseCoordinate('dec', '90.5')).toEqual({ ok: false, reason: 'range' });
    expect(parseCoordinate('dec', '90')).toEqual({ ok: true, valueDeg: 90 });
  });

  it('ungültig und leer', () => {
    expect(parseCoordinate('ra', 'abc')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseCoordinate('ra', '10h 61m')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseCoordinate('ra', '  ')).toEqual({ ok: true, valueDeg: null });
  });

  it('Anzeige in beiden Schreibweisen', () => {
    expect(formatCoordinate('ra', 13.204167, 'sexagesimal')).toBe('00h 52m 49.0s');
    expect(formatCoordinate('dec', 56.63, 'sexagesimal')).toBe('+56° 37′ 48″');
    expect(formatCoordinate('dec', -12.5, 'sexagesimal')).toBe('−12° 30′ 00″');
    expect(formatCoordinate('ra', 359.9999999, 'sexagesimal')).toBe('00h 00m 00.0s');
    expect(formatCoordinate('ra', 13.204167, 'decimal')).toBe('13.204167');
  });
});

describe('CoordinateInput', () => {
  it('ein Feld, Format im aria-describedby, Umschalter wechselt die Anzeige; axe', async () => {
    const onChange = vi.fn();
    render(<CoordinateInput kind="ra" valueDeg={13.204167} onChange={onChange} />);
    const input = screen.getByLabelText('Rektaszension');
    expect(input).toHaveValue('00h 52m 49.0s');
    expect(input).toHaveAccessibleDescription('sexagesimal');
    await userEvent.click(screen.getByRole('button', { name: 'Schreibweise wechseln' }));
    expect(input).toHaveValue('13.204167');
    await expectNoSeriousA11y();
  });

  it('ungültige Eingabe → Fehler am Feld mit Beispiel; required leer → Fehler beim Verlassen', async () => {
    const onChange = vi.fn();
    render(<CoordinateInput kind="dec" valueDeg={null} onChange={onChange} required />);
    const input = screen.getByLabelText('Deklination');
    await userEvent.type(input, '+95');
    expect(screen.getByRole('alert')).toHaveTextContent('Wert außerhalb von -90 … 90°');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(input);
    await userEvent.type(input, 'xyz');
    expect(screen.getByRole('alert')).toHaveTextContent('+56° 37′ 48″');
    await userEvent.clear(input);
    await userEvent.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Pflichtfeld');
    await userEvent.click(input);
    await userEvent.type(input, '-12 30 00');
    expect(onChange).toHaveBeenLastCalledWith(-12.5);
  });
});
