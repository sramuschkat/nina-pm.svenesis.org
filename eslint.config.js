import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Engine-Regel (docs/rules/engine.md Nr. 1, 2, 4, 7, 9): Allowlist statt Verbotsliste.
 * Erlaubt sind ausschließlich diese Math-Member; alles andere kommt aus packages/engine/src/math.
 */
const ENGINE_MATH_ALLOWED = ['abs', 'floor', 'ceil', 'trunc', 'min', 'max', 'sign', 'sqrt', 'PI'];
const ENGINE_HINT = 'Engine rein und deterministisch (docs/rules/engine.md).';

export const engineRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: `MemberExpression[object.name='Math']:not([computed=false][property.name=/^(${ENGINE_MATH_ALLOWED.join('|')})$/])`,
      message: `Nur Math.${ENGINE_MATH_ALLOWED.join('/')} erlaubt; Trigonometrie, exp, log, pow und Rundung aus src/math bzw. q(). ${ENGINE_HINT}`,
    },
    {
      selector: "VariableDeclarator[init.type='Identifier'][init.name='Math']",
      message: `Math nicht zerlegen oder umbenennen. ${ENGINE_HINT}`,
    },
    {
      selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
      message: `Der Operator ** entspricht Math.pow und ist verboten; pow aus src/math verwenden. ${ENGINE_HINT}`,
    },
    {
      selector: 'CallExpression[callee.property.name=/^(toFixed|toPrecision)$/]',
      message: `toFixed/toPrecision verboten; Rundung nur über q(x, inv) (canonical-json.md). ${ENGINE_HINT}`,
    },
    {
      selector: "CallExpression[callee.property.name='toString'][arguments.length>0]",
      message: `toString(radix) verboten. ${ENGINE_HINT}`,
    },
    {
      selector: 'Literal[bigint]',
      message: `BigInt läuft nicht in Jint (ES2020 ohne BigInt). ${ENGINE_HINT}`,
    },
  ],
  'no-restricted-globals': [
    'error',
    ...[
      'Date',
      'Intl',
      'crypto',
      'setTimeout',
      'setInterval',
      'setImmediate',
      'queueMicrotask',
      'performance',
      'process',
      'fetch',
      'BigInt',
    ].map((name) => ({ name, message: `${name} ist in der Engine verboten. ${ENGINE_HINT}` })),
  ],
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          regex: '^(?!\\.)',
          message: `Die Engine hat keine Abhängigkeiten und kein I/O; nur relative Importe. ${ENGINE_HINT}`,
        },
      ],
    },
  ],
};

/**
 * Datumswerte (NT-04, rules/ui.md): nie `new Date('YYYY-MM-DD')` (UTC-Mitternacht, in Amerika der Vortag)
 * – Datumslogik mit Temporal. Markdown/HTML (SV-05): `dangerouslySetInnerHTML` verboten (entspricht
 * `react/no-danger`; eslint-plugin-react unterstützt ESLint 10 noch nicht).
 */
const DATE_LITERAL_MESSAGE =
  'Kein new Date(<Zeichenkette>) – Datumslogik mit Temporal (@js-temporal/polyfill), Anzeige mit Intl (NT-04, rules/ui.md).';
export const webSyntaxRules = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.0.type='Literal']",
    message: DATE_LITERAL_MESSAGE,
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.0.type='TemplateLiteral']",
    message: DATE_LITERAL_MESSAGE,
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message:
      'dangerouslySetInnerHTML ist verboten (SV-05, react/no-danger); Markdown nur über components/Markdown.',
  },
];

/** TK 3.2: kein Import von packages/db/src/connection außerhalb von packages/db/src/repositories. */
const DB_CONNECTION_MESSAGE =
  'Datenbankzugriff nur in packages/db/src/repositories (CLAUDE.md Regel 2, TK 3.2).';

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/dist-e2e/',
    'test-results/',
    'playwright-report/',
    '**/build/',
    '**/coverage/',
    'docs/',
    'legacy/',
    'packages/catalog-data/',
    'apps/nina-plugin/',
    'infra/cdk.out/',
    // CloudFront Functions Runtime 2.0, Wortlaut nach TK 4.3; getestet in infra/test/viewer-request.test.ts
    'infra/edge/',
    // generiert aus docs/api/openapi.yaml (openapi-typescript)
    'apps/web/src/api/schema.d.ts',
  ]),
  js.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['**/*.{ts,tsx,js}'],
    ignores: ['packages/db/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '(^|/)db/src/connection(\\.[jt]s)?$', message: DB_CONNECTION_MESSAGE },
            { regex: '^@nina-pm/db/(src/)?connection', message: DB_CONNECTION_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/db/src/**/*.ts'],
    ignores: ['packages/db/src/repositories/**', 'packages/db/src/connection.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '(^|/)connection(\\.[jt]s)?$', message: DB_CONNECTION_MESSAGE }] },
      ],
    },
  },
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: engineRules,
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'packages/shared/src/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...webSyntaxRules] },
  },
  {
    // Bausteine ohne Rechteprüfung, Datenabfrage oder Repository (components.md §1, §4 Nr. 5).
    files: ['apps/web/src/components/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/components/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-query',
              message: 'Bausteine fragen keine Daten ab (components.md §1).',
            },
          ],
          patterns: [
            {
              regex: '(^|/)auth(/.*)?$',
              message:
                'Bausteine kennen useCan/Auth nicht – die Seite entscheidet (components.md §1).',
            },
            {
              regex: '(^|/)api(/.*)?$',
              message: 'Bausteine rufen keine API auf (components.md §1).',
            },
            {
              regex: '^@nina-pm/db',
              message: 'Bausteine greifen nie auf Repositories zu (components.md §1).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Bausteine rufen keine API auf (components.md §1).' },
      ],
    },
  },
  prettier,
]);
