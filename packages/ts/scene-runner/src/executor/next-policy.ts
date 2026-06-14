import type { NextPolicy } from "../types/harness-types.js";
import { SceneRuntimeError } from "./errors.js";

export function parseNextPolicy(value: string | undefined, sceneId: string): NextPolicy {
  if (value === undefined || value === "first-match") return "first-match";
  if (value === "all-match") return "all-match";
  throw new SceneRuntimeError(
    "UnsupportedConstruct",
    sceneId,
    `unsupported next_policy "${value}"; expected "first-match" or "all-match"`,
  );
}
