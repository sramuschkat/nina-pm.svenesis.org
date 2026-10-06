/**
 * `GET /nina/v1/simulation?night=` (AP-53, FA-NIN-18, FA-SIM-05): Simulator im Plugin. Gleiche Eingabe wie
 * `POST /plan` (`nightPlanInput` → `planNight`) für eine Nacht der Bootstrap-Tabelle, ganze Nacht ab Beginn des
 * Nachtfensters (wie S-40: ohne `tonight` und offene Meldungen). **Läuft die angefragte Nacht schon** (aktuelle
 * Nacht, jetzt im Nachtfenster), rechnet sie ab jetzt – wie `POST /plan` mitten in der Nacht; sonst zeigte die
 * Vorschau Blöcke in der schon vergangenen Dämmerung, während die Rig dieselben Aufnahmen gerade macht
 * (Rig-Test 06.10.2026). **Ohne Nebenwirkung:** keine
 * Planrevision, keine Session, kein Übernahmestatus – der gespeicherte Plan des Plugins bleibt unberührt. Auswertung
 * (Protokoll, Zielkarten, Blöcke, Filterleiste) über `simulationView` wie im Web-Simulator.
 */
import type { NinaPrincipal } from '@nina-pm/db';
import { moonAt, targetAt, unixFromIso } from '@nina-pm/engine';
import { currentNightRow, formatTzAbbr, nina, ProblemError, simulationView } from '@nina-pm/shared';
import type { z } from 'zod';
import { isoUtc } from '../lib/format';
import { siteNights } from '../lib/night-table';
import type { ApiServices } from '../routes/services';
import { BOOTSTRAP_NIGHTS, nightPlanInput, rigData, runEngine } from './sync';

type Simulation = z.output<typeof nina.NinaSimulation>;

/** Raster der Höhenkurven (FA-SIM-07). */
export const ALTITUDE_STEP_S = 600;

const isoSec = (sec: number) => isoUtc(new Date(sec * 1000));
const round1 = (x: number) => Math.round(x * 10) / 10;

export async function simulation(
  svc: ApiServices,
  p: NinaPrincipal,
  night: string,
): Promise<Simulation> {
  const now = svc.now();
  const d = await rigData(svc, p);
  // Nur Nächte der Bootstrap-Tabelle (Mittagsnacht + 59): dieselben, die das Plugin zur Auswahl anbietet.
  const table = siteNights(d.site, now, undefined, BOOTSTRAP_NIGHTS);
  if (!table.nights.some((n) => n.night === night)) throw new ProblemError('nina.night_invalid');
  const current = currentNightRow(table, isoUtc(now)).night;
  const { input, projects } = await nightPlanInput(svc, p, d, {
    night,
    currentNight: current,
    now,
    startAtUtc: null,
    tonight: null,
    pendingByLine: {},
  });
  const whole = runEngine(input);
  const running =
    night === current &&
    now.getTime() > Date.parse(whole.nightWindow.startUtc) &&
    now.getTime() < Date.parse(whole.nightWindow.endUtc);
  const planInput = running ? { ...input, startAtUtc: isoUtc(now) } : input;
  const plan = running ? runEngine(planInput) : whole;
  const site = { latitudeDeg: d.site.latitudeDeg, longitudeDeg: d.site.longitudeDeg };
  const engineSite = { latDeg: site.latitudeDeg, lonDeg: site.longitudeDeg };
  const names = new Map(projects.map((x) => [x.id, x.name]));
  const view = simulationView(planInput, plan, {
    site,
    names,
    moonProfileNames: Object.fromEntries(d.profiles.map((m) => [m.id, m.name])),
  });
  const filterColor = new Map(d.filters.map((f) => [f.shortName, f.colorHex]));
  const colorOf = (filter: string) => filterColor.get(filter) ?? null;

  // Standortzeit der Nacht: Segment ab dem letzten Übergang vor dem Nachtfenster, dazu Übergänge im Fenster.
  const start = unixFromIso(plan.nightWindow.startUtc);
  const end = unixFromIso(plan.nightWindow.endUtc);
  const transitions = input.timeZoneTransitions
    .map((t) => ({ at: unixFromIso(t.atUtc), offset: t.utcOffsetMinutes }))
    .sort((a, b) => a.at - b.at);
  const first = [...transitions].reverse().find((t) => t.at <= start) ?? transitions[0];
  const segments = [
    ...(first ? [{ at: start, offset: first.offset }] : []),
    ...transitions.filter((t) => t.at > start && t.at < end),
  ].map((t) => ({
    fromUtc: isoSec(t.at),
    utcOffsetMinutes: t.offset,
    abbr: formatTzAbbr(isoSec(t.at), d.site.timeZone),
  }));

  // Höhenkurven je Ziel und Mondhöhe im 10-min-Raster über das Nachtfenster.
  const steps: number[] = [];
  for (let t = start; t <= end; t += ALTITUDE_STEP_S) steps.push(t);
  const moonMid = moonAt((start + end) / 2, engineSite);

  return {
    night,
    generatedAtUtc: isoUtc(now),
    engineVersion: plan.engineVersion,
    inputHash: plan.inputHash,
    ...(plan.outputHash ? { outputHash: plan.outputHash } : {}),
    settingsVersion: d.rig.settingsVersion,
    timeZone: d.site.timeZone,
    timeZoneSegments: segments,
    nightWindow: plan.nightWindow,
    darkness: plan.darkness,
    header: view.header,
    targets: input.projects.map((x, i) => ({
      projectId: x.id,
      name: names.get(x.id) ?? x.id,
      seriesIndex: i,
      minAltitudeDeg: x.minAltitudeDeg,
      altitude: steps.map((t) => ({
        atUtc: isoSec(t),
        altDeg: round1(
          targetAt({ raJ2000Deg: x.raDeg, decJ2000Deg: x.decDeg }, t, engineSite).altDeg,
        ),
      })),
    })),
    moon: {
      illuminationPct: Math.round(moonMid.illumPct),
      altitude: steps.map((t) => ({
        atUtc: isoSec(t),
        altDeg: round1(moonAt(t, engineSite).altDeg),
      })),
    },
    blocks: view.blocks.map((b) => ({
      id: b.id,
      projectId: b.projectId,
      kind: b.kind,
      label: b.label,
      seriesIndex: b.projectIndex,
      startUtc: isoSec(b.fromUtc),
      endUtc: isoSec(b.toUtc),
    })),
    filterBars: view.filterBars.map((f) => ({
      fromUtc: isoSec(f.fromUtc),
      toUtc: isoSec(f.toUtc),
      filter: f.filter,
      color: colorOf(f.filter),
      count: f.count,
    })),
    flips: view.flips.map((f) => ({ atUtc: isoSec(f.atUtc) })),
    cards: view.cards.map(({ projectIndex, ...c }) => ({
      ...c,
      seriesIndex: projectIndex,
      lines: c.lines.map((l) => ({ ...l, color: colorOf(l.filter) })),
      flips: [...c.flips],
    })),
    unallocated: view.unallocated as Simulation['unallocated'],
    // `key` (Block:Eintrag) braucht nur die Web-Tabelle; das Plugin führt `blockId`.
    protocol: view.protocol.map((r) => {
      const { key, ...row } = r;
      void key;
      return row;
    }) as Simulation['protocol'],
    warnings: plan.warnings as Simulation['warnings'],
  };
}
