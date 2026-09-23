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

/** TK 3.2: kein Import von packages/db/src/connection außerhalb von packages/db/src/repositories. */
const DB_CONNECTION_MESSAGE =
  'Datenbankzugriff nur in packages/db/src/repositories (CLAUDE.md Regel 2, TK 3.2).';

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/build/',
    '**/coverage/',
    'docs/',
    'legacy/',
    'packages/catalog-data/',
    'apps/nina-plugin/',
    'infra/cdk.out/',
    // CloudFront Functions Runtime 2.0, Wortlaut nach TK 4.3; getestet in infra/test/viewer-request.test.ts
    'infra/edge/',
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
  prettier,
]);
