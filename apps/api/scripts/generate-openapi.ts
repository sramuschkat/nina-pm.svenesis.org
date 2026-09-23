import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openApiYaml } from '../src/openapi';

const target = fileURLToPath(new URL('../../../docs/api/openapi.yaml', import.meta.url));
mkdirSync(fileURLToPath(new URL('../../../docs/api/', import.meta.url)), { recursive: true });
writeFileSync(target, openApiYaml());
console.log(`OpenAPI geschrieben: ${target}`);
