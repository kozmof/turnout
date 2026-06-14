// Test-only utilities for the executor package.
// Import from this module in tests; never import these in production code.
import { _testHooks as hclTestHooks } from "./hcl-context-builder.js";

export const executorTestHooks = {
  /** Replace module-level WeakMap caches with fresh instances for test isolation. */
  clearContextCaches: () => hclTestHooks().clearContextCaches(),
};
