/**
 * Verträge synchron (AP-05): jeder Fehlercode hat einen i18n-Schlüssel DE/EN, die generierten Dateien
 * entsprechen docs/contracts (sonst `pnpm contracts:generate`), Pflichtwerte der Nachtablauf-Prüfung.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { errorMessages } from '@nina-pm/i18n';
import { describe, expect, it } from 'vitest';
import {
  loadEnums,
  loadErrors,
  renderEnums,
  renderErrors,
  renderGridSchema,
  renderI18nErrors,
  renderNinaSchemas,
  renderPlanSchemas,
} from '../scripts/render';
import * as enums from '../src/enums';
import { ERRORS } from '../src/errors';

const message = (lang: 'de' | 'en', key: string): string | undefined =>
  (errorMessages[lang] as Readonly<Record<string, string>>)[key];
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

describe('Verträge (docs/contracts ↔ packages/shared, packages/i18n)', () => {
  it('generierte Dateien sind aktuell', () => {
    expect(read('../src/generated/errors.ts')).toBe(renderErrors());
    expect(read('../src/generated/enums.ts')).toBe(renderEnums());
    expect(read('../../i18n/src/generated/errors.ts')).toBe(renderI18nErrors());
    expect(read('../../../docs/contracts/golden-plans/grid.schema.json')).toBe(renderGridSchema());
    const plan = renderPlanSchemas();
    expect(read('../../../docs/contracts/plan/plan-input.schema.json')).toBe(plan.planInput);
    expect(read('../../../docs/contracts/plan/night-plan.schema.json')).toBe(plan.nightPlan);
    for (const [file, content] of Object.entries(renderNinaSchemas()))
      expect(read(`../../../docs/contracts/nina/${file}`), file).toBe(content);
  });

  it('jeder Fehlercode hat i18n-Schlüssel errors.* mit DE- und EN-Text', () => {
    for (const e of loadErrors()) {
      expect(e.i18nKey, e.code).toMatch(/^errors\./);
      expect(message('de', e.i18nKey), e.code).toBe(e.titleDe);
      expect(message('en', e.i18nKey), e.code).toBe(e.titleEn);
      expect(ERRORS[e.code as keyof typeof ERRORS].http).toBe(e.http);
    }
  });

  it.each([
    ['line.locked_by_captures', 409],
    ['nina.night_invalid', 422],
    ['engine.input_invalid', 422],
    ['auth.csrf_missing', 403],
    ['auth.rate_limited', 429],
    ['job.not_found', 404],
    ['validation.failed', 422],
  ] as const)('Code %s mit HTTP %i und i18n-Schlüssel', (code, http) => {
    expect(ERRORS[code].http).toBe(http);
    expect(message('de', ERRORS[code].i18nKey)).toBeTruthy();
    expect(message('en', ERRORS[code].i18nKey)).toBeTruthy();
  });

  it('Enums synchron mit enums.json', () => {
    for (const [name, value] of Object.entries(loadEnums())) {
      expect((enums as Record<string, unknown>)[name], name).toEqual(value);
    }
  });

  it('Nachtablauf-Prüfung: blockEndReasons ohne flats, mit interrupted/replanned; Pflicht-Enums vorhanden', () => {
    expect(enums.blockEndReasons).not.toContain('flats');
    expect(enums.blockEndReasons).toEqual(expect.arrayContaining(['interrupted', 'replanned']));
    expect(enums.heartbeatStates).toEqual(expect.arrayContaining(['idle', 'paused']));
    expect(enums.ninaSettingsMismatchCodes).toEqual(
      expect.arrayContaining(['rotator_range_quarter', 'af_time_trigger_missing']),
    );
    for (const list of [enums.pluginWarningCodes, enums.flatsSources, enums.photometricBands]) {
      expect(list.length).toBeGreaterThan(0);
    }
    expect(enums.jobKinds).toContain('noop');
  });
});
