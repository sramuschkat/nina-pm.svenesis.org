/**
 * NINA-Ausschnitt der OpenAPI für den Plugin-Client (AP-16a, TK 10.1): nur die Pfade unter `/api/nina/`, nur die
 * davon erreichten Schemas, als **OpenAPI 3.0.3**. NSwag (NJsonSchema) liest 3.1 nicht zuverlässig, deshalb wird
 * umgesetzt: `type: [T, "null"]` → `type: T` + `nullable: true`; `exclusiveMinimum/Maximum: n` → `minimum/maximum: n`
 * + `exclusiveMinimum/Maximum: true`. **Vereinigungen** (`oneOf` über `cmd`, `type`, `frameType`, `mode`) übernimmt
 * NSwag nur mit der ersten Variante; sie werden zu **einem** Objekt mit allen Feldern zusammengeführt – Pflicht ist,
 * was jede Variante verlangt, Aufzählungen werden vereinigt. Welche Felder je Variante gelten, entscheidet das Plugin
 * am Unterscheidungsfeld; verbindlich bleiben die zod-Schemas. Eingecheckt unter `docs/api/openapi.nina.json`, CI
 * prüft den Diff (test/openapi.test.ts); `NinaPm.Core` erzeugt daraus beim Build den ApiClient.
 */
import { openApiDocument } from './openapi';

type Json = null | boolean | number | string | Json[] | JsonObject;
interface JsonObject {
  [key: string]: Json;
}

const isObject = (v: Json | undefined): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const same = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a) === JSON.stringify(b);

/** Zwei Varianten eines Felds zusammenführen (Objekte rekursiv, Aufzählungen vereinigt). */
function mergeSchema(a: Json, b: Json): Json {
  if (same(a, b) || !isObject(a) || !isObject(b)) return a;
  // Feld nur in einer Variante belegt, in der anderen `null` (z. B. `exoplanet` bei Deep-Sky-Projekten).
  if (a.type === 'null') return nullable(b);
  if (b.type === 'null') return nullable(a);
  if (isObject(a.properties) && isObject(b.properties)) return mergeObjects([a, b]);
  if (Array.isArray(a.enum) && Array.isArray(b.enum) && same(a.type, b.type)) {
    const values = [
      ...a.enum,
      ...b.enum.filter((v) => !(a.enum as Json[]).some((w) => same(v, w))),
    ];
    return { ...a, enum: values };
  }
  if (same(a.type, b.type)) return a;
  // Gleicher Typ, einmal mit `null`: die erlaubende Fassung.
  const types = (t: Json | undefined): Json[] =>
    (Array.isArray(t) ? t : t === undefined ? [] : [t]).filter((x) => x !== 'null');
  if (same(types(a.type), types(b.type))) return Array.isArray(a.type) ? a : b;
  throw new Error(`Varianten nicht zusammenführbar: ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
}

/** Schema zusätzlich `null` erlauben (3.1-Schreibweise, `down` setzt daraus `nullable`). */
function nullable(schema: JsonObject): JsonObject {
  if (Array.isArray(schema.type))
    return schema.type.includes('null') ? schema : { ...schema, type: [...schema.type, 'null'] };
  if (typeof schema.type === 'string') return { ...schema, type: [schema.type, 'null'] };
  return { ...schema, nullable: true };
}

/** Objekt-Varianten einer Vereinigung zu einem Objekt (alle Felder, Pflicht nur in allen Varianten). */
function mergeObjects(variants: JsonObject[]): JsonObject {
  const properties: JsonObject = {};
  for (const v of variants)
    for (const [name, schema] of Object.entries(v.properties as JsonObject))
      properties[name] =
        name in properties ? mergeSchema(properties[name] as Json, schema) : schema;
  const required = Object.keys(properties).filter((name) =>
    variants.every((v) => Array.isArray(v.required) && v.required.includes(name)),
  );
  const out: JsonObject = { type: 'object', properties };
  if (required.length > 0) out.required = required;
  return out;
}

/** Schema-Knoten von 3.1 nach 3.0 (rekursiv, ohne den Eingang zu verändern). */
function down(node: Json): Json {
  if (Array.isArray(node)) return node.map(down);
  if (!isObject(node)) return node;
  if (Array.isArray(node.oneOf)) {
    const variants = node.oneOf;
    if (!variants.every((v) => isObject(v) && isObject(v.properties)))
      throw new Error(`oneOf nur mit Objekt-Varianten: ${JSON.stringify(node).slice(0, 200)}`);
    const rest = Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'oneOf'));
    return down({ ...rest, ...mergeObjects(variants as JsonObject[]) });
  }
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' && Array.isArray(value)) {
      const types = value.filter((t) => t !== 'null');
      if (types.length !== 1) throw new Error(`Typliste nicht umsetzbar: ${JSON.stringify(value)}`);
      out.type = types[0] as Json;
      if (types.length !== value.length) out.nullable = true;
    } else if (
      (key === 'exclusiveMinimum' || key === 'exclusiveMaximum') &&
      typeof value === 'number'
    ) {
      out[key === 'exclusiveMinimum' ? 'minimum' : 'maximum'] = value;
      out[key] = true;
    } else {
      out[key] = down(value);
    }
  }
  return out;
}

/** Alle `#/components/schemas/<Name>` unterhalb eines Knotens. */
function refs(node: Json, into: Set<string>): void {
  if (Array.isArray(node)) node.forEach((n) => refs(n, into));
  else if (isObject(node))
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith('#/components/schemas/'))
        into.add(value.slice('#/components/schemas/'.length));
      else refs(value, into);
    }
}

export function openApiNinaDocument(): JsonObject {
  const doc = openApiDocument() as unknown as JsonObject;
  const allPaths = doc.paths as JsonObject;
  const components = doc.components as JsonObject;
  const schemas = components.schemas as JsonObject;

  const paths: JsonObject = {};
  for (const [path, item] of Object.entries(allPaths))
    if (path.startsWith('/api/nina/')) paths[path] = item;

  const needed = new Set<string>();
  refs(paths, needed);
  for (let size = -1; size !== needed.size;) {
    size = needed.size;
    for (const name of [...needed]) refs(schemas[name] ?? null, needed);
  }
  const picked: JsonObject = {};
  for (const name of [...needed].sort()) {
    const schema = schemas[name];
    if (schema === undefined) throw new Error(`Schema ${name} fehlt`);
    picked[name] = schema;
  }

  return down({
    openapi: '3.0.3',
    info: {
      title: 'Svenesis NINA-PM – NINA-API',
      version: '1',
      description:
        'NINA-Ausschnitt aus docs/api/openapi.yaml als OpenAPI 3.0.3 für den Plugin-Client (NSwag). Generiert – nicht von Hand ändern.',
    },
    servers: doc.servers ?? [],
    paths,
    components: {
      schemas: picked,
      securitySchemes: { ninaToken: (components.securitySchemes as JsonObject).ninaToken ?? null },
    },
  }) as JsonObject;
}

export function openApiNinaJson(): string {
  return `${JSON.stringify(openApiNinaDocument(), null, 2)}\n`;
}
