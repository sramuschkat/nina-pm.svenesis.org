import { describe, expect, it } from 'vitest';
import { rebaseDraft, sameValue } from './draft-rebase';

describe('rebaseDraft (Prüfung 28.09.2026, verlorene Änderungen)', () => {
  const base = { name: 'A', notes: '', tags: ['x'], cond: { alt: 30, moon: true } };

  it('eigene und fremde Änderungen an verschiedenen Feldern werden zusammengeführt', () => {
    const draft = { ...base, name: 'Mein Name' };
    const next = { ...base, notes: 'fremd', cond: { alt: 40, moon: true } };
    expect(rebaseDraft(draft, base, next)).toEqual({
      name: 'Mein Name',
      notes: 'fremd',
      tags: ['x'],
      cond: { alt: 40, moon: true },
    });
  });

  it('Unterobjekte je Schlüssel: verschiedene Bedingungen sind kein Konflikt', () => {
    const draft = { ...base, cond: { alt: 30, moon: false } };
    const next = { ...base, cond: { alt: 40, moon: true } };
    expect(rebaseDraft(draft, base, next)?.cond).toEqual({ alt: 40, moon: false });
  });

  it('dasselbe Feld verschieden geändert → Konflikt; gleich geändert → kein Konflikt', () => {
    expect(rebaseDraft({ ...base, name: 'X' }, base, { ...base, name: 'Y' })).toBeNull();
    expect(rebaseDraft({ ...base, tags: ['y'] }, base, { ...base, tags: ['z'] })).toBeNull();
    expect(rebaseDraft({ ...base, name: 'X' }, base, { ...base, name: 'X' })).toEqual({
      ...base,
      name: 'X',
    });
  });

  it('unveränderter Entwurf übernimmt die neue Fassung vollständig', () => {
    const next = { name: 'B', notes: 'n', tags: [], cond: { alt: 10, moon: false } };
    expect(rebaseDraft(base, base, next)).toEqual(next);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(0, null)).toBe(false);
  });
});
