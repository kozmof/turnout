// Generates fn-map.generated.ts from spec/fn-aliases.json.
// Run: node --experimental-strip-types scripts/gen-fn-map.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const aliases = JSON.parse(
  readFileSync(resolve(root, 'spec/fn-aliases.json'), 'utf-8'),
) as Array<{ hcl: string; runtime: string }>;

const lines = aliases.map(({ hcl, runtime }) => {
  const pad = ' '.repeat(Math.max(0, 14 - hcl.length));
  return `  ${hcl}:${pad}'${runtime}',`;
});

const out = [
  '// AUTO-GENERATED — do not edit.',
  '// Source of truth: spec/fn-aliases.json',
  '// Regenerate: node --experimental-strip-types scripts/gen-fn-map.ts',
  "import type { BinaryFnNames } from 'runtime';",
  '',
  'export const FN_MAP: Record<string, BinaryFnNames> = {',
  ...lines,
  '};',
  '',
].join('\n');

const dest = resolve(
  root,
  'packages/ts/scene-runner/src/executor/fn-map.generated.ts',
);
writeFileSync(dest, out);
console.log(`Generated ${dest}`);
