// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { importX } from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';

// ---------------------------------------------------------------------------------------------
// Layer boundaries (ARCHITECTURE.md §10). This table is the single source of truth: each layer
// lists the other layers it may import from. Everything not listed is a lint error.
// ---------------------------------------------------------------------------------------------
const LAYERS = ['main', 'preload', 'renderer', 'core', 'tools', 'security', 'integrations', 'shared'];
/** @type {Record<string, string[]>} */
const MAY_IMPORT = {
  main: ['core', 'tools', 'security', 'integrations', 'shared'],
  preload: ['shared'],
  renderer: ['shared'],
  core: ['shared'],
  tools: ['core', 'shared'],
  security: ['core', 'shared'],
  integrations: ['core', 'security', 'tools', 'shared'],
  shared: [],
};

const layerZones = LAYERS.map((layer) => ({
  target: `./src/${layer}`,
  from: LAYERS.filter((other) => other !== layer && !MAY_IMPORT[layer]?.includes(other)).map(
    (other) => `./src/${other}`,
  ),
  message: `src/${layer} may only import from: ${MAY_IMPORT[layer]?.join(', ') || 'nothing'} (ARCHITECTURE.md §10).`,
})).filter((zone) => zone.from.length > 0);

// Modules a layer must never touch, regardless of where they are imported from.
const NODE_BUILTINS = ['fs', 'path', 'os', 'child_process', 'net', 'http', 'https', 'crypto', 'process'];
const noElectron = { name: 'electron', message: 'Only src/main and src/preload may import electron.' };
const noChildProcess = [
  { name: 'child_process', message: 'Pure layers must not spawn processes; do it in src/tools.' },
  { name: 'node:child_process', message: 'Pure layers must not spawn processes; do it in src/tools.' },
];

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'spikes/**', 'node_modules/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: ['tsconfig.node.json', 'tsconfig.web.json'],
          noWarnOnMultipleProjects: true, // intentional: one tsconfig per runtime (Node vs browser)
        }),
      ],
    },
    rules: {
      'import-x/no-restricted-paths': ['error', { zones: layerZones }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/core/**', 'src/shared/**'],
    rules: { 'no-restricted-imports': ['error', { paths: [noElectron, ...noChildProcess] }] },
  },
  {
    files: ['src/tools/**', 'src/security/**', 'src/integrations/**'],
    rules: { 'no-restricted-imports': ['error', { paths: [noElectron] }] },
  },
  {
    files: ['src/renderer/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            noElectron,
            ...NODE_BUILTINS.map((name) => ({ name, message: 'Renderers are sandboxed: no Node APIs.' })),
          ],
          patterns: [{ group: ['node:*'], message: 'Renderers are sandboxed: no Node APIs.' }],
        },
      ],
    },
  },
);
