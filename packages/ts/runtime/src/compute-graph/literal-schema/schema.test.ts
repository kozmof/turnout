import { describe, it, expect } from "vitest";
import { safeParse } from "valibot";
import { binaryFnNames } from "./binaryFnNames";
import { transformFnNames } from "./transformFnNames";
import { combineFuncSchema, pipeFuncSchema } from "./schema";

describe("literal-schema", () => {
  describe("binaryFnNames()", () => {
    it("validates number binary function names", () => {
      const schema = binaryFnNames();
      expect(safeParse(schema, "binaryFnNumber::add").success).toBe(true);
      expect(safeParse(schema, "binaryFnNumber::multiply").success).toBe(true);
      expect(safeParse(schema, "binaryFnNumber::greaterThan").success).toBe(true);
    });

    it("validates boolean binary function names", () => {
      const schema = binaryFnNames();
      expect(safeParse(schema, "binaryFnBoolean::and").success).toBe(true);
      expect(safeParse(schema, "binaryFnBoolean::or").success).toBe(true);
      expect(safeParse(schema, "binaryFnBoolean::xor").success).toBe(true);
    });

    it("validates generic binary function names", () => {
      const schema = binaryFnNames();
      expect(safeParse(schema, "binaryFnGeneric::isEqual").success).toBe(true);
      expect(safeParse(schema, "binaryFnGeneric::isNotEqual").success).toBe(true);
    });

    it("validates array binary function names", () => {
      const schema = binaryFnNames();
      expect(safeParse(schema, "binaryFnArray::concat").success).toBe(true);
      expect(safeParse(schema, "binaryFnArray::includes").success).toBe(true);
    });

    it("validates string binary function names", () => {
      const schema = binaryFnNames();
      expect(safeParse(schema, "binaryFnString::concat").success).toBe(true);
      expect(safeParse(schema, "binaryFnString::includes").success).toBe(true);
    });

    it("rejects invalid function names", () => {
      const schema = binaryFnNames();
      expect(safeParse(schema, "invalid").success).toBe(false);
      expect(safeParse(schema, "").success).toBe(false);
      expect(safeParse(schema, 42).success).toBe(false);
      expect(safeParse(schema, null).success).toBe(false);
    });
  });

  describe("transformFnNames()", () => {
    it("validates number transform function names", () => {
      const schema = transformFnNames();
      expect(safeParse(schema, "transformFnNumber::pass").success).toBe(true);
      expect(safeParse(schema, "transformFnNumber::abs").success).toBe(true);
    });

    it("validates boolean transform function names", () => {
      const schema = transformFnNames();
      expect(safeParse(schema, "transformFnBoolean::pass").success).toBe(true);
      expect(safeParse(schema, "transformFnBoolean::not").success).toBe(true);
    });

    it("validates string transform function names", () => {
      const schema = transformFnNames();
      expect(safeParse(schema, "transformFnString::pass").success).toBe(true);
    });

    it("validates null transform function names", () => {
      const schema = transformFnNames();
      expect(safeParse(schema, "transformFnNull::pass").success).toBe(true);
    });

    it("validates array transform function names", () => {
      const schema = transformFnNames();
      expect(safeParse(schema, "transformFnArray::pass").success).toBe(true);
      expect(safeParse(schema, "transformFnArray::length").success).toBe(true);
    });

    it("rejects invalid transform function names", () => {
      const schema = transformFnNames();
      expect(safeParse(schema, "invalid").success).toBe(false);
      expect(safeParse(schema, "").success).toBe(false);
      expect(safeParse(schema, 42).success).toBe(false);
    });
  });

  describe("combineFuncSchema", () => {
    const baseValue = { symbol: "number", subSymbol: undefined, value: 5, tags: [] };
    const baseFuncInterface = { name: "x", type: "value", value: baseValue };

    it("validates a valid CombineFunc", () => {
      const validFunc = {
        name: "binaryFnNumber::add",
        type: "combine",
        transformFn: {
          a: { name: "transformFnNumber::pass" },
          b: { name: "transformFnNumber::pass" },
        },
        args: {
          a: baseFuncInterface,
          b: { name: "y", type: "value", value: { ...baseValue, value: 3 } },
        },
      };
      expect(safeParse(combineFuncSchema, validFunc).success).toBe(true);
    });

    it("validates a nested CombineFunc (recursive arg)", () => {
      const innerFunc = {
        name: "binaryFnNumber::multiply",
        type: "combine",
        transformFn: {
          a: { name: "transformFnNumber::pass" },
          b: { name: "transformFnNumber::pass" },
        },
        args: { a: baseFuncInterface, b: baseFuncInterface },
      };
      const outerFunc = {
        name: "binaryFnNumber::add",
        type: "combine",
        transformFn: {
          a: { name: "transformFnNumber::pass" },
          b: { name: "transformFnNumber::pass" },
        },
        args: { a: innerFunc, b: baseFuncInterface },
      };
      expect(safeParse(combineFuncSchema, outerFunc).success).toBe(true);
    });

    it("rejects invalid combine functions", () => {
      expect(safeParse(combineFuncSchema, { invalid: true }).success).toBe(false);
      expect(safeParse(combineFuncSchema, null).success).toBe(false);
      expect(safeParse(combineFuncSchema, "string").success).toBe(false);
    });
  });

  describe("pipeFuncSchema", () => {
    const baseValue = { symbol: "number", subSymbol: undefined, value: 5, tags: [] };
    const baseFuncInterface = { name: "x", type: "value", value: baseValue };

    it("validates a valid PipeFunc with empty steps", () => {
      const validFunc = {
        name: "myPipe",
        type: "pipe",
        steps: [],
        args: [],
      };
      expect(safeParse(pipeFuncSchema, validFunc).success).toBe(true);
    });

    it("validates a PipeFunc with args", () => {
      const validFunc = {
        name: "myPipe",
        type: "pipe",
        steps: [],
        args: [baseFuncInterface],
      };
      expect(safeParse(pipeFuncSchema, validFunc).success).toBe(true);
    });

    it("rejects invalid pipe functions", () => {
      expect(safeParse(pipeFuncSchema, { invalid: true }).success).toBe(false);
      expect(safeParse(pipeFuncSchema, null).success).toBe(false);
    });
  });
});
