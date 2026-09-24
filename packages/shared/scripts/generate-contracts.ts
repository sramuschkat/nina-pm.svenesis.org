/**
 * Erzeugt aus docs/contracts/errors.json und enums.json (TK 7.5, rules/api.md – nur generiert, nie von Hand):
 *   packages/shared/src/generated/errors.ts
 *   packages/shared/src/generated/enums.ts
 *   packages/i18n/src/generated/errors.ts   (errors.* DE/EN)
 *   docs/contracts/golden-plans/grid.schema.json (Grid-/Soll-Plan-Format, AP-13a)
 *   docs/contracts/plan/plan-input.schema.json, night-plan.schema.json (Planungsvertrag, AP-13c)
 * Aufruf: pnpm contracts:generate · Prüfung auf Aktualität: packages/shared/test/contracts.spec.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import {
  renderEnums,
  renderErrors,
  renderGridSchema,
  renderI18nErrors,
  renderPlanSchemas,
} from './render';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
writeFileSync(at('../src/generated/errors.ts'), renderErrors());
writeFileSync(at('../src/generated/enums.ts'), renderEnums());
writeFileSync(at('../../i18n/src/generated/errors.ts'), renderI18nErrors());
writeFileSync(at('../../../docs/contracts/golden-plans/grid.schema.json'), renderGridSchema());
mkdirSync(at('../../../docs/contracts/plan'), { recursive: true });
const plan = renderPlanSchemas();
writeFileSync(at('../../../docs/contracts/plan/plan-input.schema.json'), plan.planInput);
writeFileSync(at('../../../docs/contracts/plan/night-plan.schema.json'), plan.nightPlan);
console.log(
  'Verträge erzeugt: shared/errors.ts, shared/enums.ts, i18n/errors.ts, grid.schema.json',
);
