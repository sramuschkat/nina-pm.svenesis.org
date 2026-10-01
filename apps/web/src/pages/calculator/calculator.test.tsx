// @vitest-environment jsdom
/**
 * S-23 Rechner (AP-61): Vorbelegung aus Rig und Filter, Reiter Belichtung, Sampling und Exoplanet-Stern (aus der
 * URL wie aus S-22), eigene Werte und *Aus Rig zurücksetzen*, fehlende Angaben; URL-Zustand; A11y.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { expectNoSeriousA11y } from '../../../test/setup';
import { CalculatorPage } from './CalculatorPage';
import { exoCalculatorHref, paramsFromUrl, parseNum, urlFromParams } from './model';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

vi.mock('../../api/client', () => ({
  equipmentApi: {
    list: (kind: string) =>
      Promise.resolve({
        items:
          kind === 'rigs'
            ? [
                {
                  id: ID(1),
                  name: 'Newton 200',
                  siteId: ID(2),
                  telescopeId: ID(3),
                  cameraId: ID(4),
                  showInPlanning: true,
                  derived: { scaleArcsecPx: 0.78, fovWidthDeg: 1.35, fovHeightDeg: 0.9 },
                  scheduler: { overhead: { downloadS: 3 } },
                  filterWheel: [
                    { position: 1, filterId: ID(5) },
                    { position: 2, filterId: ID(6) },
                  ],
                },
              ]
            : kind === 'sites'
              ? [{ id: ID(2), name: 'Garten', elevationM: 100, bortleClass: 3 }]
              : kind === 'telescopes'
                ? [
                    {
                      id: ID(3),
                      name: 'Newton',
                      apertureMm: 200,
                      focalLengthMm: 1000,
                      reducerFactor: null,
                      obstructionPct: 0,
                    },
                  ]
                : kind === 'cameras'
                  ? [
                      {
                        id: ID(4),
                        name: 'IMX571',
                        widthPx: 6248,
                        heightPx: 4176,
                        pixelSizeUm: 3.76,
                        bitDepth: 16,
                        readNoiseE: 1.5,
                        fullWellE: 50000,
                        gainEPerAdu: null,
                        quantumEfficiencyPct: 80,
                        darkCurrentES20c: 0.002,
                        isCooled: false,
                        coolingSetpointC: null,
                        defaultGain: 100,
                        gainModes: [],
                      },
                    ]
                  : kind === 'filters'
                    ? [
                        {
                          id: ID(5),
                          shortName: 'L',
                          colorHex: '#9e9e9e',
                          filterType: 'luminance',
                          photometricBand: 'none',
                          centerWavelengthNm: null,
                          bandwidthNm: null,
                          transmissionPct: null,
                        },
                        {
                          id: ID(6),
                          shortName: 'Ha',
                          colorHex: '#c62828',
                          filterType: 'narrowband',
                          photometricBand: 'none',
                          centerWavelengthNm: 656.3,
                          bandwidthNm: 7,
                          transmissionPct: 95,
                        },
                      ]
                    : [],
      }),
  },
}));

const wrap = (url = '/planung/rechner') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <CalculatorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const value = (label: RegExp) => (screen.getByLabelText(label) as HTMLInputElement).value;
const type = (label: RegExp, v: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value: v } });
  fireEvent.blur(input);
};

describe('S-23 Rechner', () => {
  it('Belichtung: Vorbelegung aus Rig und Filter, kürzeste Einzelbelichtung, Tabelle; axe', async () => {
    wrap();
    await waitFor(() => expect(value(/^Öffnung/)).toBe('200'));
    expect(value(/^Pixelgröße/)).toBe('3.76');
    expect(value(/^Ausleserauschen/)).toBe('1.5');
    expect(value(/^Sättigung/)).toBe('50000');
    expect(value(/^Himmelshelligkeit/)).toBe('21.4');
    expect(screen.getByText(/Standard aus Bortle 3/)).toBeTruthy();
    // Luminanz bei Bortle 3: 10 · 1,5² / 0,789 e⁻/px/s = 28,5 s → 30 s (calculator.md, Engine-Test)
    expect(screen.getByText('Kürzeste Einzelbelichtung').nextSibling?.textContent).toBe('30 s');
    const table = screen.getByRole('table', { name: 'Effizienz je Belichtungszeit' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(7);
    expect(rows[1]?.textContent).toContain('kürzeste');
    expect(rows[1]?.textContent).toContain('91,3 %');
    await expectNoSeriousA11y();
  });

  it('eigene Werte rechnen sofort; Aus Rig zurücksetzen; Filter Hα → Band Rc', async () => {
    wrap();
    await waitFor(() => expect(value(/^Ausleserauschen/)).toBe('1.5'));
    const reset = screen.getByRole('button', { name: 'Aus Rig zurücksetzen' });
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    type(/^Ausleserauschen/, '3');
    // 4 × 28,5 s = 114 s → 120 s
    await waitFor(() =>
      expect(screen.getByText('Kürzeste Einzelbelichtung').nextSibling?.textContent).toBe('120 s'),
    );
    expect((reset as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(reset);
    await waitFor(() => expect(value(/^Ausleserauschen/)).toBe('1.5'));

    // Filterauswahl in der Filterfarbe (Wunsch Sven 01.10.2026)
    const select = screen.getByLabelText('Filter') as HTMLSelectElement;
    expect(select.style.background).not.toBe('');
    expect(
      (select.querySelector(`option[value="${ID(6)}"]`) as HTMLOptionElement).style.background,
    ).not.toBe('');
    fireEvent.change(select, { target: { value: ID(6) } });
    await waitFor(() => expect(value(/^Bandbreite/)).toBe('7'));
    expect((screen.getByLabelText('Band des Modells') as HTMLSelectElement).value).toBe('Rc');
    expect(screen.getByText('Kürzeste Einzelbelichtung').nextSibling?.textContent).toBe('680 s');
  });

  it('fehlende Angaben werden genannt', async () => {
    wrap();
    await waitFor(() => expect(value(/^Öffnung/)).toBe('200'));
    type(/^Öffnung/, '');
    expect(await screen.findByText('Für diese Rechnung fehlen: Öffnung.')).toBeTruthy();
  });

  it('Sampling: Maßstab, FWHM, Einstufung und Bildfeld je Binning', async () => {
    wrap('/planung/rechner?tab=sampling');
    await waitFor(() => expect(value(/^Brennweite/)).toBe('1000'));
    const table = screen.getByRole('table', { name: 'Sampling je Binning' });
    const rows = within(table).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'BinningMaßstabFWHMEinstufungBildfeld',
      '1×10,78″/px3,2 pxpassend80,8′ × 54,0′',
      '2×21,55″/px1,6 pxpassend80,8′ × 54,0′',
      '3×32,33″/px1,1 pxunterabgetastet80,8′ × 54,0′',
      '4×43,10″/px0,8 pxunterabgetastet80,8′ × 54,0′',
    ]);
    expect(screen.getByText('Empfohlenes Binning').nextSibling?.textContent).toBe('1×1');
    type(/^Seeing/, '6');
    await waitFor(() =>
      expect(screen.getByText('Empfohlenes Binning').nextSibling?.textContent).toBe('3×3'),
    );
    await expectNoSeriousA11y();
  });

  it('Exoplanet-Stern aus der URL (wie aus S-22): Karte Belichtung mit den Werten', async () => {
    wrap(
      `/planung/rechner?tab=exo&rig=${ID(1)}&filter=${ID(5)}&band=lum&star=WASP-12&mag=11.6&depth=14&t14=3&k=0.117&window=5&altMax=70&altMid=60`,
    );
    expect(await screen.findByText(/Werte aus der Transitsuche für WASP-12/)).toBeTruthy();
    expect(value(/^Sternhelligkeit/)).toBe('11.6');
    const card = await screen.findByRole('region', { name: 'Belichtung – WASP-12' });
    expect(within(card).getByText(/Belichtung · L · Gain 100/)).toBeTruthy();
    expect(within(card).getByText(/Transit-SNR/)).toBeTruthy();
    await expectNoSeriousA11y();
  });
});

describe('URL und Link aus S-22', () => {
  it('Rundreise; ungültige Werte fallen weg', () => {
    const u = urlFromParams(
      new URLSearchParams('tab=exo&rig=r&filter=f&band=Rc&star=X&mag=12,5&depth=x&t14=2'),
    );
    expect(u).toEqual({
      tab: 'exo',
      rig: 'r',
      filter: 'f',
      band: 'Rc',
      star: 'X',
      target: { mag: '12,5', durationH: '2' },
    });
    expect(paramsFromUrl(u).toString()).toBe(
      'tab=exo&rig=r&filter=f&band=Rc&star=X&mag=12%2C5&t14=2',
    );
    expect(urlFromParams(new URLSearchParams('tab=nope&band=Q'))).toMatchObject({
      tab: 'exposure',
      band: null,
    });
    expect(parseNum(' 3,5 ')).toBe(3.5);
    expect(parseNum('')).toBeNull();
  });

  it('exoCalculatorHref', () => {
    expect(
      exoCalculatorHref({
        rigId: 'r',
        filterId: null,
        star: 'WASP-12',
        band: 'Rc',
        mag: 11.57,
        depthMmag: 14.1,
        durationH: 3.0,
        rpOverRs: null,
        windowS: 5.5 * 3600,
        altMaxDeg: 71.23,
        altMidDeg: 60,
      }),
    ).toBe(
      '/planung/rechner?tab=exo&rig=r&band=Rc&star=WASP-12&mag=11.57&depth=14.1&t14=3&window=5.5&altMax=71.2&altMid=60',
    );
  });
});
