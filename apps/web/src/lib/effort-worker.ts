/**
 * Web Worker für das Live-Aufwand-Kennzeichen im Projekt-Editor (AP-13e, TK 7.4: Browser rechnet mit
 * derselben Engine, `stride` 5). Keine Netzwerk- oder DOM-Zugriffe; Nachrichten nur `EffortRequest` →
 * `EffortResponse`. Abbruch bei neuer Eingabe beendet den Worker von außen (`terminate`).
 */
import { EFFORT_STRIDE_BROWSER } from '@nina-pm/engine';
import { projectEffort } from '@nina-pm/shared';
import type { EffortRequest, EffortResponse } from './effort-messages';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<EffortRequest>) => void) | null;
  postMessage: (message: EffortResponse) => void;
};

scope.onmessage = (e) => {
  const { seq, project, rig, moonProfiles, site, nights, computedAt } = e.data;
  try {
    const r = projectEffort(project, rig, moonProfiles, {
      site,
      nights,
      stride: EFFORT_STRIDE_BROWSER,
      computedAt,
    });
    scope.postMessage({ seq, ok: true, view: r?.view ?? null });
  } catch {
    scope.postMessage({ seq, ok: false, view: null });
  }
};
