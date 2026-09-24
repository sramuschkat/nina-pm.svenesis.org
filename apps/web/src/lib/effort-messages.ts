/** Nachrichten zwischen Editor und Aufwand-Worker (AP-13e). */
import type { EffortView, projectEffort } from '@nina-pm/shared';

type Args = Parameters<typeof projectEffort>;

export interface EffortRequest {
  readonly seq: number;
  readonly project: Args[0];
  readonly rig: Args[1];
  readonly moonProfiles: Args[2];
  readonly site: Args[3]['site'];
  readonly nights: Args[3]['nights'];
  readonly computedAt: string;
}

export interface EffortResponse {
  readonly seq: number;
  readonly ok: boolean;
  readonly view: EffortView | null;
}
