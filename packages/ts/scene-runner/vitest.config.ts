import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Always resolve the `runtime` monorepo package to its TypeScript source
      // during testing so tests work without a prior `pnpm build`.
      runtime: fileURLToPath(new URL("../runtime/src/index.ts", import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/executor/types.ts",
        "src/server/index.ts",
        "src/types/harness-types.ts",
        "src/types/turnout-model_pb.ts",
        "src/state/state-types.ts",
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
        "src/runner.ts": { statements: 95, branches: 90, functions: 100, lines: 96 },
        "src/executor/scene-executor.ts": {
          statements: 96,
          branches: 88,
          functions: 100,
          lines: 95,
        },
        "src/executor/route-stepper.ts": {
          statements: 94,
          branches: 87,
          functions: 100,
          lines: 95,
        },
      },
    },
  },
});
