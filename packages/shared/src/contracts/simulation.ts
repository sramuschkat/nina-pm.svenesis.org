/**
 * Simulation speichern (AP-13f, TK 7.2, FA-SIM-01…08): der im Browser gerechnete Nachtplan eines Rigs
 * für eine Nacht als `night_plan(origin = 'web_simulation')`.
 */
import { z } from 'zod';
import { NightKey, UtcInstant, Uuid } from './common';
import { ExecutedNight, StoredPlan } from './executed';
import { NightPlanSchema, PlanInputSchema } from './plan';

export const SimulationCreate = z
  .object({ rigId: Uuid, night: NightKey, plan: NightPlanSchema })
  .strict()
  .meta({ id: 'SimulationCreate' });
export type SimulationCreate = z.infer<typeof SimulationCreate>;

export const SimulationSaved = z
  .object({ id: Uuid, createdAt: UtcInstant })
  .meta({ id: 'SimulationSaved' });
export type SimulationSaved = z.infer<typeof SimulationSaved>;

/** `GET /api/web/v1/simulations/transits`: Rig und Nacht des Web-Simulators. */
export const SimulationTransitsQuery = z
  .object({ rigId: Uuid, night: NightKey })
  .meta({ id: 'SimulationTransitsQuery' });
export type SimulationTransitsQuery = z.infer<typeof SimulationTransitsQuery>;

/**
 * Festgelegte Transits einer Nacht an einem Rig (AP-44, transit.md §9) – dieselbe Auswahl wie `POST /plan`
 * (primär, Fensterende nach jetzt, aktive Transit-Zeile, je Projekt der früheste), damit der Web-Simulator
 * Exoplaneten-Projekte wie der Plan einplant (`buildPlanInput` Option `transits`, 06.10.2026).
 */
export const SimulationTransits = z
  .object({
    items: z.array(
      z.object({
        projectId: Uuid,
        observationId: Uuid,
        lineId: Uuid,
        windowStartUtc: UtcInstant,
        windowEndUtc: UtcInstant,
        lockedAtUtc: UtcInstant,
      }),
    ),
  })
  .meta({ id: 'SimulationTransits' });
export type SimulationTransits = z.infer<typeof SimulationTransits>;

/** `GET /api/web/v1/simulations/input`: Rig und Nacht des Web-Simulators bzw. von „Heute Nacht“ (AP-53c). */
export const SimulationInputQuery = z
  .object({ rigId: Uuid, night: NightKey })
  .meta({ id: 'SimulationInputQuery' });
export type SimulationInputQuery = z.infer<typeof SimulationInputQuery>;

/**
 * Engine-Eingabe einer Nacht vom Server (AP-53c, FA-SIM-05): dieselbe Funktion wie `POST /plan` und
 * `GET /nina/v1/simulation` (`nightPlanInput`), ganze Nacht ohne `startAtUtc` und ohne `tonight`. Der Browser rechnet
 * damit weiter selbst (Was-wäre-wenn als Überlagerung). Dazu Namen, Filterfarben, das Ist der Nacht und die letzte
 * gespeicherte Planrevision mit dem Hinweis, ob die Rig noch mit einer älteren Eingabe plant, sowie Revision 1 der ersten
 * Session (Ursprungsplan).
 */
export const SimulationInput = z
  .object({
    night: NightKey,
    currentNight: NightKey,
    /** `sha256:` über `canonicalInputJson(input)`. */
    inputHash: z.string().max(80),
    input: PlanInputSchema,
    projectNames: z.record(z.string(), z.string().max(300)),
    moonProfileNames: z.record(z.string(), z.string().max(300)),
    filterColors: z.record(z.string(), z.string().max(16)),
    executed: ExecutedNight.nullable(),
    storedPlan: StoredPlan.nullable(),
    firstPlan: StoredPlan.nullable(),
  })
  .meta({ id: 'SimulationInput' });
export type SimulationInput = z.infer<typeof SimulationInput>;
