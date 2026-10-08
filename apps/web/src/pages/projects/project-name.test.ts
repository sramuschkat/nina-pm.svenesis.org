/**
 * Projekt ohne Katalogsuche (08.10.2026): Ein User gab die Koordinaten von LDN 1228 von Hand ein und trug als Name
 * seinen Vornamen ein; Objekttyp und Katalognamen blieben leer. Jetzt läuft der Projektname mit dem Zielnamen mit,
 * fällt leer auf Zielname bzw. Koordinaten zurück, und der Objekttyp ist eine Auswahl.
 */
import { describe, expect, it } from 'vitest';
import { draftBody, effectiveName, emptyDraft, withTargetName, type ProjectDraft } from './model';
import { targetTypeOptions } from './ProjectEditorPage';

const draft = (over: Partial<ProjectDraft> = {}): ProjectDraft => ({
  ...emptyDraft({} as ProjectDraft['conditions']),
  ...over,
});

describe('Projektname ohne Katalogsuche', () => {
  it('läuft mit dem Zielnamen mit, solange er leer ist oder ihm entspricht', () => {
    let d = withTargetName(draft(), 'LDN');
    expect(d.name).toBe('LDN');
    d = withTargetName(d, 'LDN 1228');
    expect(d).toMatchObject({ name: 'LDN 1228', targetName: 'LDN 1228' });
    // eigener Name bleibt
    d = withTargetName({ ...d, name: 'Cepheus-Dunkelwolke' }, 'LDN 1228 ');
    expect(d.name).toBe('Cepheus-Dunkelwolke');
  });

  it('fällt beim Speichern auf Zielname bzw. Koordinaten zurück', () => {
    expect(effectiveName(draft({ name: '  ', targetName: 'LDN 1228' }))).toBe('LDN 1228');
    expect(effectiveName(draft({ raDeg: 314.546, decDeg: 78.5644 }))).toBe(
      '20h 58m 11.0s +78° 33′ 52″',
    );
    expect(effectiveName(draft())).toBe('');
    expect(draftBody(draft({ targetName: 'LDN 1228' })).name).toBe('LDN 1228');
  });
});

describe('Objekttyp als Auswahl', () => {
  const t = (key: string) => (key === 'projectEditor.field.targetTypeNone' ? '– kein Typ –' : key);

  it('Gruppen der Katalogsuche plus „kein Typ“', () => {
    const options = targetTypeOptions('', t);
    expect(options[0]).toEqual({ value: '', label: '– kein Typ –' });
    expect(options.map((o) => o.value)).toContain('catalog.groups.dark_nebula');
    expect(options).toHaveLength(11);
  });

  it('ein bisher frei eingegebener Typ bleibt wählbar', () => {
    const options = targetTypeOptions('exoplanet', t);
    expect(options.at(-1)).toEqual({ value: 'exoplanet', label: 'exoplanet' });
  });
});
