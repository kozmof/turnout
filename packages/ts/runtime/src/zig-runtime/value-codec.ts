import {
  nullReasonSubSymbols,
  type AnyValue,
  type ArrayElemSubSymbol,
  type NullReasonSubSymbol,
} from "../state-control/value.js";

type CanonicalValue = {
  symbol: "number" | "string" | "boolean" | "null" | "array" | "record";
  value: unknown;
  tags: string[];
  reason?: NullReasonSubSymbol;
  subSymbol?: ArrayElemSubSymbol;
};

export function toCanonicalValue(input: unknown): CanonicalValue {
  if (!isRecord(input) || typeof input.symbol !== "string" || !Array.isArray(input.tags)) {
    throw new TypeError("expected a tagged Value");
  }
  const tags = input.tags;
  if (!tags.every((tag) => typeof tag === "string")) {
    throw new TypeError("Value tags must be strings");
  }
  switch (input.symbol) {
    case "number":
      if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
        throw new TypeError("number Value must be finite");
      }
      return { symbol: "number", value: input.value, tags };
    case "string":
      if (typeof input.value !== "string") throw new TypeError("string Value is invalid");
      return { symbol: "string", value: input.value, tags };
    case "boolean":
      if (typeof input.value !== "boolean") throw new TypeError("boolean Value is invalid");
      return { symbol: "boolean", value: input.value, tags };
    case "null": {
      if (
        input.value !== null ||
        typeof input.subSymbol !== "string" ||
        !nullReasonSubSymbols.includes(input.subSymbol as NullReasonSubSymbol)
      ) {
        throw new TypeError("null Value reason is invalid");
      }
      return {
        symbol: "null",
        value: null,
        reason: input.subSymbol as NullReasonSubSymbol,
        tags,
      };
    }
    case "array":
      if (!Array.isArray(input.value)) throw new TypeError("array Value is invalid");
      const subSymbol = canonicalArraySubSymbol(input.subSymbol);
      return {
        symbol: "array",
        value: input.value.map(toCanonicalValue),
        tags,
        ...(subSymbol !== undefined && { subSymbol }),
      };
    case "record":
      if (!isRecord(input.value)) throw new TypeError("record Value is invalid");
      return {
        symbol: "record",
        value: mapRecord(input.value, toCanonicalValue),
        tags,
      };
    default:
      throw new TypeError("unknown Value symbol");
  }
}

export function fromCanonicalValue(input: unknown): AnyValue {
  if (!isRecord(input) || typeof input.symbol !== "string" || !Array.isArray(input.tags)) {
    throw new TypeError("invalid canonical Value");
  }
  const tags = input.tags;
  if (!tags.every((tag) => typeof tag === "string")) {
    throw new TypeError("canonical Value tags must be strings");
  }
  switch (input.symbol) {
    case "number":
      if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
        throw new TypeError("canonical number is invalid");
      }
      return { symbol: "number", value: input.value, subSymbol: undefined, tags };
    case "string":
      if (typeof input.value !== "string") throw new TypeError("canonical string is invalid");
      return { symbol: "string", value: input.value, subSymbol: undefined, tags };
    case "boolean":
      if (typeof input.value !== "boolean") throw new TypeError("canonical boolean is invalid");
      return { symbol: "boolean", value: input.value, subSymbol: undefined, tags };
    case "null":
      if (typeof input.reason !== "string") throw new TypeError("canonical null reason is invalid");
      if (!nullReasonSubSymbols.includes(input.reason as NullReasonSubSymbol)) {
        throw new TypeError("canonical null reason is invalid");
      }
      return {
        symbol: "null",
        value: null,
        subSymbol: input.reason as NullReasonSubSymbol,
        tags,
      };
    case "array":
      if (!Array.isArray(input.value)) throw new TypeError("canonical array is invalid");
      return {
        symbol: "array",
        value: input.value.map(fromCanonicalValue),
        subSymbol: canonicalArraySubSymbol(input.subSymbol),
        tags,
      } as AnyValue;
    case "record":
      if (!isRecord(input.value)) throw new TypeError("canonical record is invalid");
      return {
        symbol: "record",
        value: mapRecord(input.value, fromCanonicalValue),
        subSymbol: undefined,
        tags,
      };
    default:
      throw new TypeError("unknown canonical Value symbol");
  }
}

function canonicalArraySubSymbol(input: unknown): ArrayElemSubSymbol {
  if (input === undefined) return undefined;
  if (input === "number" || input === "string" || input === "boolean" || input === "null") {
    return input;
  }
  throw new TypeError("canonical array subSymbol is invalid");
}

function mapRecord<T>(
  input: Record<string, unknown>,
  convert: (value: unknown) => T,
): Record<string, T> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, convert(value)]));
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
