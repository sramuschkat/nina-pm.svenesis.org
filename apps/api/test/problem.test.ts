import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROBLEMS } from '../src/lib/problem';

// Codes nur aus docs/contracts/errors.json (rules/api.md, CLAUDE.md Regel 9).
const contract = JSON.parse(
  readFileSync(new URL('../../../docs/contracts/errors.json', import.meta.url), 'utf8'),
) as { errors: { code: string; http: number; titleDe: string }[] };

describe('Problem-Codes', () => {
  it.each(Object.entries(PROBLEMS))(
    '%s steht mit Status und Titel in errors.json',
    (code, { status, title }) => {
      const entry = contract.errors.find((e) => e.code === code);
      expect(entry, code).toBeDefined();
      expect(entry?.http).toBe(status);
      expect(entry?.titleDe).toBe(title);
    },
  );
});
