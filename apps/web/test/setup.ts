/** Gemeinsame Vorbereitung der Komponententests (jsdom): jest-dom-Matcher, i18n (DE), Aufräumen. */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, expect } from 'vitest';
import i18n from '../src/app/i18n';

void i18n.changeLanguage('de');
afterEach(() => cleanup());

/**
 * axe ohne Verstöße der Stufen *serious* und *critical* (rules/ui.md, CC5-9). Farbkontraste prüft jsdom
 * nicht (keine Layout-/CSS-Berechnung) – das übernehmen Playwright (`pnpm test:a11y`) und der Token-Test.
 */
export async function expectNoSeriousA11y(root: Element = document.body): Promise<void> {
  const result = await axe.run(root, { rules: { 'color-contrast': { enabled: false } } });
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}
