import type { TFunction } from 'i18next';

/** Anzeigename eines Mondprofils: mitgelieferte Profile heißen `moonProfile.<key>` (moon.md, FA-MON-02). */
export const moonProfileLabel = (t: TFunction, name: string): string =>
  name.startsWith('moonProfile.') ? t(`moonProfile.${name.slice('moonProfile.'.length)}`) : name;
