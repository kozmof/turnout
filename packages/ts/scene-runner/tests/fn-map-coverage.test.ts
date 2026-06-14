import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { FN_MAP } from "../src/executor/hcl-context-builder.js";
import { getBinaryFnReturnType } from "runtime";
import type { BinaryFnNames } from "runtime";

// Load the shared fn-aliases.json fixture from the repo root.
// This is the single source of truth for the HCL alias ↔ runtime name mapping.
const __dirname = dirname(fileURLToPath(import.meta.url));
const fnAliases = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../spec/fn-aliases.json"), "utf-8"),
) as Array<{ hcl: string; runtime: string }>;

describe("FN_MAP coverage", () => {
  it("covers all HCL aliases declared in spec/fn-aliases.json", () => {
    for (const { hcl } of fnAliases) {
      expect(FN_MAP, `FN_MAP is missing entry for Go builtin "${hcl}"`).toHaveProperty(hcl);
    }
  });

  it("FN_MAP entries match exact runtime names in spec/fn-aliases.json", () => {
    for (const { hcl, runtime } of fnAliases) {
      expect(FN_MAP[hcl], `FN_MAP["${hcl}"] should be "${runtime}"`).toBe(runtime);
    }
  });

  it("all non-array FN_MAP values are valid runtime BinaryFnNames", () => {
    for (const [hclName, runtimeName] of Object.entries(FN_MAP)) {
      if (runtimeName.startsWith("binaryFnArray::")) continue;
      const returnType = getBinaryFnReturnType(runtimeName as BinaryFnNames);
      expect(
        returnType,
        `FN_MAP["${hclName}"] = "${runtimeName}" is not a known runtime BinaryFnName`,
      ).not.toBeNull();
    }
  });

  it("all array FN_MAP values follow the binaryFnArray:: namespace pattern", () => {
    const arrayFns = ["arr_concat", "arr_get", "arr_includes"] as const;
    for (const name of arrayFns) {
      expect(FN_MAP[name], `FN_MAP["${name}"] should start with "binaryFnArray::"`).toMatch(
        /^binaryFnArray::/,
      );
    }
  });
});
