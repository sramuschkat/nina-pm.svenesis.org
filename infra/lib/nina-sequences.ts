import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Ordner der Beispielsequenzen im Repository (FA-NIN-25, TK 12). */
export const NINA_SEQUENCES_DIR = fileURLToPath(
  new URL('../../apps/nina-plugin/NinaPm.Nina/Samples/', import.meta.url),
);

/** Plugin-Version aus `NinaPm.Nina.csproj` – Pfadteil unter `downloads/nina-sequences/`. */
export function ninaPluginVersion(
  csproj = fileURLToPath(
    new URL('../../apps/nina-plugin/NinaPm.Nina/NinaPm.Nina.csproj', import.meta.url),
  ),
): string {
  const m = /<Version>\s*(\d+\.\d+\.\d+)\s*<\/Version>/.exec(readFileSync(csproj, 'utf8'));
  if (!m?.[1]) throw new Error(`${csproj}: <Version>x.y.z</Version> fehlt`);
  return m[1];
}
