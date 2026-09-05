import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnyValue, TagSymbol } from "./value.js";
import {
  buildArray,
  buildBoolean,
  buildNull,
  buildNumber,
  buildRecord,
  buildString,
} from "./value-builders.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type Vector = { name: string; input: JsonValue; tags: string[]; expected: unknown };
const vectors = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../zig/runtime/src/fixtures/value-vectors.json"),
    "utf8",
  ),
) as Vector[];

function fromJson(input: JsonValue, tags: readonly TagSymbol[] = []): AnyValue {
  if (input === null) return buildNull("unknown", tags);
  if (typeof input === "number") return buildNumber(input, tags);
  if (typeof input === "string") return buildString(input, tags);
  if (typeof input === "boolean") return buildBoolean(input, tags);
  if (Array.isArray(input))
    return buildArray(
      input.map((item) => fromJson(item)),
      tags,
    );
  return buildRecord(
    Object.fromEntries(Object.entries(input).map(([key, item]) => [key, fromJson(item)])),
    tags,
  );
}

function canonical(input: AnyValue): unknown {
  const base = { symbol: input.symbol, tags: input.tags };
  if (input.symbol === "array") return { ...base, value: input.value.map(canonical) };
  if (input.symbol === "record")
    return {
      ...base,
      value: Object.fromEntries(
        Object.entries(input.value).map(([key, item]) => [key, canonical(item)]),
      ),
    };
  if (input.symbol === "null") return { ...base, value: null, reason: input.subSymbol };
  return { ...base, value: input.value };
}

describe("shared Value vectors", () => {
  for (const vector of vectors) {
    it(vector.name, () => {
      expect(canonical(fromJson(vector.input, vector.tags as TagSymbol[]))).toEqual(
        vector.expected,
      );
    });
  }
});
