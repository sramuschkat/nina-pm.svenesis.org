/**
 * Auswertungs-Demo (ops-cli demo-evaluation): Filterrollen auf Kurznamen des Mandanten, Determinismus (gleicher
 * Seed → gleicher Verlauf; IDs je Salz verschieden), vorhandene Projekte (`fixed`) exakt auf ihrem Stand und ohne
 * Endstatus, Geschichten der Demo-Projekte.
 */
import { describe, expect, it } from 'vitest';
import { DEMO_PROJECTS, demoEvaluation, demoFilterName, type DemoProject } from '../src';

const nights = Array.from({ length: 90 }, (_, i) =>
  new Date(Date.UTC(2026, 5, 28 + i)).toISOString().slice(0, 10),
);
const meta = (_s: string, n: string) => ({
  darkFromUtc: `${n}T01:30:00Z`,
  darkToUtc: new Date(Date.parse(`${n}T01:30:00Z`) + 9 * 3600e3).toISOString().replace('.000', ''),
  moonIllumPct: 40,
});
const names = ['BLUE', 'GREEN', 'HA', 'LUMINOS', 'OIII', 'RED', 'SII'];
const fixed: DemoProject = {
  id: 'fixed',
  name: 'IC 1848 – Seelennebel',
  rigId: 'r',
  raDeg: 42.8,
  decDeg: 60.4,
  rotationDeg: 0,
  story: 'fixed',
  lines: ['SII', 'HA', 'OIII'].map((f) => ({
    id: `fixed-${f}`,
    panelId: 'p',
    filter: f,
    exposureS: 600,
    planned: 4,
    gain: 150,
    offsetAdu: 50,
    binning: 1,
    readoutMode: null,
  })),
};
const demo: DemoProject[] = DEMO_PROJECTS.map((d) => ({
  id: d.name,
  name: d.name,
  rigId: 'r',
  raDeg: d.raDeg,
  decDeg: d.decDeg,
  rotationDeg: 0,
  story: d.story,
  lines: d.lines.map((l) => ({
    id: `${d.name}-${l.filter}`,
    panelId: 'p',
    filter: demoFilterName(l.filter, names) ?? '',
    exposureS: l.exposureS,
    planned: l.planned,
    gain: 150,
    offsetAdu: 50,
    binning: 1,
    readoutMode: null,
  })),
}));
const run = (idSalt: string) =>
  demoEvaluation({
    seed: 'demo-evaluation',
    idSalt,
    nights,
    rigs: [{ id: 'r', siteId: 's', ninaInstanceId: 'n' }],
    projects: [fixed, ...demo],
    meta,
  });

describe('demoEvaluation', () => {
  it('Filterrollen auf die Kurznamen des Mandanten', () => {
    expect(['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII'].map((r) => demoFilterName(r, names))).toEqual([
      'LUMINOS',
      'RED',
      'GREEN',
      'BLUE',
      'HA',
      'OIII',
      'SII',
    ]);
    expect(demoFilterName('Ha', ['L', 'R'])).toBeNull();
  });

  it('deterministisch: gleicher Verlauf, IDs je Salz verschieden', () => {
    const a = run('tenant-a');
    const b = run('tenant-a');
    const c = run('tenant-b');
    expect(b.summary).toEqual(a.summary);
    expect(b.nights[40]?.captures.map((x) => x.id)).toEqual(
      a.nights[40]?.captures.map((x) => x.id),
    );
    expect(c.summary).toEqual(a.summary);
    expect(c.nights[40]?.captures[0]?.id).not.toBe(a.nights[40]?.captures[0]?.id);
  });

  it('vorhandenes Projekt exakt auf seinem Stand, in den letzten Nächten, ohne Endstatus', () => {
    const r = run('t');
    const captures = r.nights.flatMap((n) => n.captures).filter((c) => c.projectId === 'fixed');
    const accepted = (f: string) => captures.filter((c) => c.filter === f && !c.rejected).length;
    expect(['SII', 'HA', 'OIII'].map(accepted)).toEqual([4, 4, 4]);
    expect(Math.min(...captures.map((c) => nights.indexOf(c.night)))).toBeGreaterThanOrEqual(78);
    expect(r.finalStatus.has('fixed')).toBe(false);
    expect(r.nights.flatMap((n) => n.sessions).every((s) => s.ninaInstanceId === 'n')).toBe(true);
  });

  it('Geschichten: fertig, aktiv mit Kanalbalance, pausiert, Saison vorbei', () => {
    const r = run('t');
    expect(Object.fromEntries(r.finalStatus)).toEqual({
      'Demo – M 31 Andromedagalaxie (LRGB)': 'completed',
      'Demo – NGC 7000 Nordamerikanebel (HOO)': 'active',
      'Demo – IC 1396 Elefantenrüssel (SHO)': 'active',
      'Demo – M 33 Dreiecksgalaxie (LRGB)': 'on_hold',
      'Demo – NGC 6888 Mondsichelnebel (HOO)': 'unfinished',
    });
    // Pausiert/Saison vorbei: keine Aufnahmen nach der jeweiligen Nacht.
    const last = (name: string) =>
      Math.max(
        ...r.nights
          .flatMap((n) => n.captures)
          .filter((c) => c.projectId === name)
          .map((c) => nights.indexOf(c.night)),
      );
    expect(last('Demo – M 33 Dreiecksgalaxie (LRGB)')).toBeLessThan(45);
    expect(last('Demo – NGC 6888 Mondsichelnebel (HOO)')).toBeLessThan(70);
    expect(r.summary.usableNights).toBeGreaterThan(40);
    expect(r.summary.usableNights).toBeLessThan(70);
  });
});
