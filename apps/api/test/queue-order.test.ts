/**
 * Sortierung der Warteschlange (FA-FRG-04, AP-43): Fristen unter 24 h zuerst (früheste zuerst), danach Stimmen,
 * Rang beim Einreicher und Einreichungszeit – für alle Arten (Projekt, Änderungsantrag, Transit-Bestätigung).
 */
import { describe, expect, it } from 'vitest';
import { queueOrder } from '../src/routes/web-approval';

type Item = Parameters<ReturnType<typeof queueOrder>>[0];
const now = Date.parse('2026-10-10T12:00:00Z');
const item = (id: string, over: Partial<Item>): Item =>
  ({
    id,
    kind: 'project',
    expiresAt: null,
    votes: { count: 0, voters: [], mine: false, mineChangedSince: false },
    submitterRank: null,
    submittedAt: '2026-10-01T00:00:00Z',
    ...over,
  }) as Item;

describe('queueOrder', () => {
  it('Fristen < 24 h vor Stimmen, untereinander nach Frist', () => {
    const items = [
      item('votes', { votes: { count: 5, voters: [], mine: false, mineChangedSince: false } }),
      item('late', { kind: 'transit', expiresAt: '2026-10-11T08:00:00Z' }),
      item('soon', { expiresAt: '2026-10-10T20:00:00Z' }),
      item('far', { expiresAt: '2026-10-20T00:00:00Z' }),
    ];
    expect(items.sort(queueOrder(now)).map((i) => i.id)).toEqual(['soon', 'late', 'votes', 'far']);
  });
});
