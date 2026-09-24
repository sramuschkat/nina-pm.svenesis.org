import { describe, expect, it } from 'vitest';
import { fragmentFiles, mergeFragments } from '../src/changelog';

describe('Changelog aus Einzeldateien', () => {
  it('fügt Einträge unter „Unveröffentlicht“ ein, neueste zuerst', () => {
    const changelog =
      '# Changelog\n\nText.\n\n## [Unveröffentlicht]\n\n### Alt (2026-09-01)\n\n- a\n';
    const files = fragmentFiles(['README.md', '2026-09-24-ap-07d.md', '2026-09-25-ap-09a.md']);
    expect(files).toEqual(['2026-09-25-ap-09a.md', '2026-09-24-ap-07d.md']);
    const out = mergeFragments(changelog, [
      '### AP-09a (2026-09-25)\n\n- neu\n',
      '### AP-07d (2026-09-24)\n\n- b\n',
    ]);
    expect(out).toBe(
      '# Changelog\n\nText.\n\n## [Unveröffentlicht]\n\n### AP-09a (2026-09-25)\n\n- neu\n\n### AP-07d (2026-09-24)\n\n- b\n\n### Alt (2026-09-01)\n\n- a\n',
    );
  });

  it('ohne Einträge unverändert; fehlende Überschrift ist ein Fehler', () => {
    expect(mergeFragments('## [Unveröffentlicht]\n\nx\n', [])).toBe('## [Unveröffentlicht]\n\nx\n');
    expect(() => mergeFragments('# leer', ['x'])).toThrow(/Unveröffentlicht/);
  });
});
