import { describe, expect, it } from 'vitest';
import { wikiDesignation, wikipediaLink } from '../src/catalog';

describe('wikiDesignation', () => {
  it('schreibt Bezeichnungen wie Wikipedia', () => {
    expect(wikiDesignation('M 31')).toBe('Messier 31');
    expect(wikiDesignation('C 41')).toBe('Caldwell 41');
    expect(wikiDesignation('Mel 20')).toBe('Melotte 20');
    expect(wikiDesignation('Cl 399')).toBe('Collinder 399');
    expect(wikiDesignation('NGC 224')).toBe('NGC 224');
    expect(wikiDesignation('ESO 56-115')).toBe('ESO 56-115');
    expect(wikiDesignation('Sh2-155')).toBe('Sh2-155');
    expect(wikiDesignation('Pferdekopfnebel')).toBe('Pferdekopfnebel');
  });
});

describe('wikipediaLink', () => {
  it('Artikel in der Sprache der Oberfläche, Leerzeichen als Unterstrich', () => {
    expect(
      wikipediaLink(['Andromedagalaxie', 'Andromeda Galaxy'], 'NGC 224', 'M 31', 'de'),
    ).toEqual({
      href: 'https://de.wikipedia.org/wiki/Andromedagalaxie',
      lang: 'de',
      search: false,
    });
    expect(
      wikipediaLink(['Andromedagalaxie', 'Andromeda Galaxy'], 'NGC 224', 'M 31', 'en'),
    ).toEqual({
      href: 'https://en.wikipedia.org/wiki/Andromeda_Galaxy',
      lang: 'en',
      search: false,
    });
  });
  it('1 = Artikel unter der Bezeichnung der Zeile', () => {
    expect(wikipediaLink([1, 1], 'NGC 1990', 'NGC 1990', 'de').href).toBe(
      'https://de.wikipedia.org/wiki/NGC_1990',
    );
  });
  it('sonst der Artikel der anderen Sprache', () => {
    expect(wikipediaLink([0, 'PGC 17223'], 'ESO 56-115', 'ESO 56-115', 'de')).toEqual({
      href: 'https://en.wikipedia.org/wiki/PGC_17223',
      lang: 'en',
      search: false,
    });
  });
  it('ohne Artikel die Suche nach dem Anzeigenamen', () => {
    expect(wikipediaLink(undefined, 'NGC 7000', 'NGC 7000', 'en')).toEqual({
      href: 'https://en.wikipedia.org/wiki/Special:Search?search=NGC%207000',
      lang: 'en',
      search: true,
    });
    expect(wikipediaLink([0, 0], 'NGC 5194', 'M 51', 'de').href).toBe(
      'https://de.wikipedia.org/wiki/Special:Search?search=Messier%2051',
    );
  });
  it('Sonderzeichen im Titel werden kodiert', () => {
    expect(wikipediaLink(['Ptolemäus-Haufen', 0], 'NGC 6475', 'M 7', 'de').href).toBe(
      'https://de.wikipedia.org/wiki/Ptolem%C3%A4us-Haufen',
    );
  });
});
