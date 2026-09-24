/**
 * Simulation speichern (AP-13f, TK 7.2, FA-SIM-01…08): der im Browser gerechnete Nachtplan eines Rigs
 * für eine Nacht als `night_plan(origin = 'web_simulation')`.
 */
import { z } from 'zod';
import { NightKey, UtcInstant, Uuid } from './common';
import { NightPlanSchema } from './plan';

export const SimulationCreate = z
  .object({ rigId: Uuid, night: NightKey, plan: NightPlanSchema })
  .strict()
  .meta({ id: 'SimulationCreate' });
export type SimulationCreate = z.infer<typeof SimulationCreate>;

export const SimulationSaved = z
  .object({ id: Uuid, createdAt: UtcInstant })
  .meta({ id: 'SimulationSaved' });
export type SimulationSaved = z.infer<typeof SimulationSaved>;
