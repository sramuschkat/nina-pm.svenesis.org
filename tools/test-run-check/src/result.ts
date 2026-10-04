/**
 * Schema von `result.json` (ops/plugin-test-protocol.md, „Schema `result.json`“). Von Hand geprüft statt mit
 * einer Schema-Bibliothek: wenige Felder, und die Meldungen sollen Sven sagen, was genau fehlt.
 */
export interface Step {
  readonly n: number;
  readonly ok: boolean;
  readonly note: string;
}

export interface LogCheck {
  readonly status: 'pass' | 'fail' | 'not_run';
  readonly missing: string[];
  readonly unexpected: string[];
}

export interface RunResult {
  readonly protocol: string;
  readonly date: string;
  readonly pluginVersion: string;
  readonly ninaVersion: string;
  readonly server: 'nina_test_server' | 'prod';
  readonly scenario: string | null;
  readonly result: 'go' | 'no_go';
  readonly steps: Step[];
  logCheck?: LogCheck;
  readonly deviations: string[];
  readonly artifacts: string[];
}

/** `P-01 … P-38` und `P-15b`. */
export const PROTOCOL = /^P-(0[1-9]|[12][0-9]|3[0-8]|15b)$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Fehlerliste (leer = gültig); `expectedSteps` aus `expectations.json`, falls für das Protokoll bekannt. */
export function validateResult(raw: unknown, expectedSteps: number | null): string[] {
  const errors: string[] = [];
  if (!isObj(raw)) return ['result.json ist kein Objekt'];
  const str = (key: string) => {
    if (typeof raw[key] !== 'string' || raw[key] === '') errors.push(`${key}: Zeichenkette fehlt`);
  };
  if (typeof raw.protocol !== 'string' || !PROTOCOL.test(raw.protocol))
    errors.push(`protocol: „${String(raw.protocol)}“ ist nicht P-01 … P-38 oder P-15b`);
  if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date))
    errors.push('date: JJJJ-MM-TT erwartet');
  str('pluginVersion');
  str('ninaVersion');
  if (raw.server !== 'nina_test_server' && raw.server !== 'prod')
    errors.push('server: genau „nina_test_server“ oder „prod“');
  if (raw.scenario !== null && typeof raw.scenario !== 'string')
    errors.push('scenario: Szenarioname oder null');
  if (raw.result !== 'go' && raw.result !== 'no_go') errors.push('result: „go“ oder „no_go“');
  if (!isStrArray(raw.deviations)) errors.push('deviations: Liste von Zeichenketten');
  if (!isStrArray(raw.artifacts)) errors.push('artifacts: Liste von Zeichenketten');
  if (!Array.isArray(raw.steps)) {
    errors.push('steps: Liste fehlt');
  } else {
    raw.steps.forEach((s, i) => {
      if (!isObj(s)) return errors.push(`steps[${String(i)}]: kein Objekt`);
      if (s.n !== i + 1)
        errors.push(`steps[${String(i)}].n: ${String(i + 1)} erwartet (fortlaufend ab 1)`);
      if (typeof s.ok !== 'boolean') errors.push(`steps[${String(i)}].ok: true/false fehlt`);
      if (typeof s.note !== 'string')
        errors.push(`steps[${String(i)}].note: Zeichenkette fehlt (darf leer sein)`);
      return undefined;
    });
    if (expectedSteps !== null && raw.steps.length !== expectedSteps)
      errors.push(
        `steps: ${String(expectedSteps)} Schritte erwartet, ${String(raw.steps.length)} vorhanden`,
      );
  }
  return errors;
}
