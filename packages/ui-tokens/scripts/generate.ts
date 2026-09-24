import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderTokensCss } from '../src/tokens';

writeFileSync(fileURLToPath(new URL('../src/tokens.css', import.meta.url)), renderTokensCss());
console.log('tokens.css erzeugt');
