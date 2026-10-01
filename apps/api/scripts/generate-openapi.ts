import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openApiYaml } from '../src/openapi';
import { openApiNinaJson } from '../src/openapi-nina';

const target = fileURLToPath(new URL('../../../docs/api/openapi.yaml', import.meta.url));
mkdirSync(fileURLToPath(new URL('../../../docs/api/', import.meta.url)), { recursive: true });
writeFileSync(target, openApiYaml());
console.log(`OpenAPI geschrieben: ${target}`);
// NINA-Ausschnitt als OpenAPI 3.0.3 für den Plugin-Client (NSwag, AP-16a).
const nina = fileURLToPath(new URL('../../../docs/api/openapi.nina.json', import.meta.url));
writeFileSync(nina, openApiNinaJson());
console.log(`OpenAPI (NINA) geschrieben: ${nina}`);
