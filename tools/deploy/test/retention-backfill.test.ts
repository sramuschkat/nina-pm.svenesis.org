import { describe, expect, it } from 'vitest';
import {
  backfillTags,
  expiredAfterTagging,
  retentionDaysFor,
} from '../src/retention-backfill-model';

const T = '00000000-0000-4000-8000-000000000001';
const DAY = 86_400_000;

describe('Nachkennzeichnung npm-retention (einmalig, Nachtrag zu #101)', () => {
  it('Frist aus der Kategorie im Schlüssel wie beim Schreiben', () => {
    expect(retentionDaysFor(`tenant/${T}/jobs/abc.json`)).toBe(2);
    expect(retentionDaysFor(`tenant/${T}/imports/abc.json`)).toBe(7);
    expect(retentionDaysFor(`tenant/${T}/plans/abc.json.gz`)).toBe(400);
    // Transit-Ergebnisse und Unbekanntes bleiben unbefristet.
    expect(retentionDaysFor(`tenant/${T}/results/x/y.csv`)).toBeNull();
    expect(retentionDaysFor(`tenant/${T}/other/y`)).toBeNull();
    expect(retentionDaysFor('catalog/thumbs/a.jpg')).toBeNull();
  });

  it('Tag dazu, vorhandene Tags bleiben, vorhandenes npm-retention nie überschreiben', () => {
    expect(backfillTags(`tenant/${T}/jobs/a.json`, [])).toEqual([
      { Key: 'npm-retention', Value: '2d' },
    ]);
    expect(backfillTags(`tenant/${T}/plans/a.json.gz`, [{ Key: 'x', Value: '1' }])).toEqual([
      { Key: 'x', Value: '1' },
      { Key: 'npm-retention', Value: '400d' },
    ]);
    expect(
      backfillTags(`tenant/${T}/jobs/a.json`, [{ Key: 'npm-retention', Value: '7d' }]),
    ).toBeNull();
    expect(backfillTags(`tenant/${T}/results/a/b.csv`, [])).toBeNull();
  });

  it('abgelaufen nach Kennzeichnung, wenn älter als die Frist', () => {
    const now = Date.UTC(2026, 8, 28);
    expect(expiredAfterTagging(`tenant/${T}/jobs/a.json`, now - 3 * DAY, now)).toBe(true);
    expect(expiredAfterTagging(`tenant/${T}/jobs/a.json`, now - 1 * DAY, now)).toBe(false);
    expect(expiredAfterTagging(`tenant/${T}/plans/a.json.gz`, now - 30 * DAY, now)).toBe(false);
    expect(expiredAfterTagging(`tenant/${T}/results/a/b.csv`, 0, now)).toBe(false);
  });
});
