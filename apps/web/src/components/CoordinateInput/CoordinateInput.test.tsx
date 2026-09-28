// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { formatCoordinate, parseCoordinate } from './coords';
import { CoordinateInput } from './index';

describe('parseCoordinate (§2.6)', () => {
  it('Astronomie-Prüfung 28.09.2026: kein stilles Zerlegen, nur Stunden, keine 360, kein −00°', () => {
    // „12 345“ ohne Trenner zwischen Minuten und Sekunden ist ungültig (vorher 12°34′05″).
    expect(parseCoordinate('dec', '12 345')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseCoordinate('dec', '12 34 5')).toEqual({
      ok: true,
      valueDeg: Math.round((12 + 34 / 60 + 5 / 3600) * 1e6) / 1e6,
    });
    expect(parseCoordinate('dec', "12° 34'")).toEqual({
      ok: true,
      valueDeg: Math.round((12 + 34 / 60) * 1e6) / 1e6,
    });
    // Nur Stunden für RA.
    expect(parseCoordinate('ra', '12h')).toEqual({ ok: true, valueDeg: 180 });
    expect(parseCoordinate('ra', '5,5 h')).toEqual({ ok: true, valueDeg: 82.5 });
    expect(parseCoordinate('ra', '24h')).toEqual({ ok: true, valueDeg: 0 });
    // Dezimal nie „360“, sexagesimal nie „−00° 00′ 00″“.
    expect(formatCoordinate('ra', 359.9999999, 'decimal')).toBe('0');
    expect(formatCoordinate('dec', -0.0001, 'sexagesimal')).toBe('+00° 00′ 00″');
    expect(formatCoordinate('dec', -0.5, 'sexagesimal')).toBe('−00° 30′ 00″');
  });

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

  it('Himmelsrichtung bei Breite und Länge: Süd/West negativ, nicht zusammen mit Vorzeichen', () => {
    const w = Math.round(-(9 + 8 / 60) * 1e6) / 1e6;
    expect(parseCoordinate('lon', '9° 8′ W')).toEqual({ ok: true, valueDeg: w });
    expect(parseCoordinate('lon', '9 8 w')).toEqual({ ok: true, valueDeg: w });
    expect(parseCoordinate('lon', '9.7 E')).toEqual({ ok: true, valueDeg: 9.7 });
    expect(parseCoordinate('lon', '9,7 O')).toEqual({ ok: true, valueDeg: 9.7 });
    expect(parseCoordinate('lat', '33° 52′ S')).toEqual({
      ok: true,
      valueDeg: Math.round(-(33 + 52 / 60) * 1e6) / 1e6,
    });
    expect(parseCoordinate('lat', '52.5N')).toEqual({ ok: true, valueDeg: 52.5 });
    // „s“ direkt nach der Ziffer bleibt das Sekundenzeichen.
    expect(parseCoordinate('lat', '52 22 14s')).toEqual({
      ok: true,
      valueDeg: Math.round((52 + 22 / 60 + 14 / 3600) * 1e6) / 1e6,
    });
    expect(parseCoordinate('lon', '-9 W')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseCoordinate('lat', '10 W')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseCoordinate('lon', '190 W')).toEqual({ ok: false, reason: 'range' });
    expect(parseCoordinate('lon', 'W')).toEqual({ ok: false, reason: 'invalid' });
    // Deklination und RA kennen keine Himmelsrichtung.
    expect(parseCoordinate('dec', '10 S')).toEqual({ ok: false, reason: 'invalid' });
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
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(-12.5);
  });

  it('Prüfung 28.09.2026: Übernahme erst beim Verlassen bzw. mit Enter, nie Teilwerte je Tastendruck', async () => {
    const onChange = vi.fn();
    function Controlled() {
      const [value, setValue] = useState<number | null>(null);
      return (
        <CoordinateInput
          kind="ra"
          valueDeg={value}
          onChange={(v) => {
            onChange(v);
            setValue(v);
          }}
        />
      );
    }
    render(<Controlled />);
    const input = screen.getByLabelText('Rektaszension');
    await userEvent.type(input, '10h 42m 44s');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(
      Math.round((10 + 42 / 60 + 44 / 3600) * 15 * 1e6) / 1e6,
    );
    expect(input).toHaveValue('10h 42m 44.0s');
    // Enter übernimmt ebenfalls; unveränderter Wert meldet nichts erneut.
    await userEvent.clear(input);
    await userEvent.type(input, '12h{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(180);
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('ungültiger Text wird nie übernommen, bleibt stehen und meldet sich als ungültig', async () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    render(
      <CoordinateInput
        kind="lon"
        valueDeg={9.7}
        onChange={onChange}
        onValidityChange={onValidityChange}
      />,
    );
    const input = screen.getByLabelText('Länge');
    await userEvent.clear(input);
    await userEvent.type(input, '9° 8′ X');
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('9° 8′ X');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    // Himmelsrichtung W → West negativ; das Feld ist wieder gültig.
    await userEvent.clear(input);
    await userEvent.type(input, '9° 8′ W');
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(Math.round(-(9 + 8 / 60) * 1e6) / 1e6);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it('neuer Wert von außen ersetzt den Text und löscht einen Fehler', () => {
    const { rerender } = render(
      <CoordinateInput kind="lat" valueDeg={52} onChange={() => undefined} />,
    );
    const input = screen.getByLabelText('Breite');
    expect(input).toHaveValue('52° 00′ 00″');
    rerender(<CoordinateInput kind="lat" valueDeg={-33.5} onChange={() => undefined} />);
    expect(input).toHaveValue('−33° 30′ 00″');
    rerender(
      <CoordinateInput kind="lat" valueDeg={-33.5} format="decimal" onChange={() => undefined} />,
    );
    expect(input).toHaveValue('-33.5');
  });
});
