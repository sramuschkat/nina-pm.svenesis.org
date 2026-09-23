/**
 * Erzeugt aus docs/contracts/errors.json und enums.json (TK 7.5, rules/api.md – nur generiert, nie von Hand):
 *   packages/shared/src/generated/errors.ts
 *   packages/shared/src/generated/enums.ts
 *   packages/i18n/src/generated/errors.ts   (errors.* DE/EN)
 * Aufruf: pnpm contracts:generate · Prüfung auf Aktualität: packages/shared/test/contracts.spec.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderEnums, renderErrors, renderI18nErrors } from './render';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
writeFileSync(at('../src/generated/errors.ts'), renderErrors());
writeFileSync(at('../src/generated/enums.ts'), renderEnums());
writeFileSync(at('../../i18n/src/generated/errors.ts'), renderI18nErrors());
console.log('Verträge erzeugt: shared/errors.ts, shared/enums.ts, i18n/errors.ts');
