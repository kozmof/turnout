import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        'src/index.ts',
        'src/compute-graph/index.ts',
        'src/compute-graph/types.ts',
        'src/compute-graph/builder/context.ts',
        'src/compute-graph/builder/index.ts',
        'src/compute-graph/builder/types.ts',
        'src/compute-graph/literal-schema/binaryFnNames.ts',
        'src/compute-graph/literal-schema/input-types.ts',
        'src/compute-graph/literal-schema/schema.ts',
        'src/compute-graph/literal-schema/transformFnNames.ts',
        'src/compute-graph/runtime/tree-types.ts',
        'src/compute-graph/runtime/validateContext.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
