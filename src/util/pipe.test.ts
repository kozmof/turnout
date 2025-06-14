import { expect, test } from "vitest";
import { type NumberValue } from "../state/value";
import { pipe } from "./pipe";

// Note: [NML]️ is a normal test. [NEG]️ is a negative test

test("Pipe functions [NML]️", () => {
  const add3 = (a: NumberValue): NumberValue => {
    return {
      symbol: "number",
      value: a.value + 3
    };
  };

  const multiply3 = (a: NumberValue): NumberValue => {
    return {
      symbol: "number",
      value: a.value * 3
    };
  };

  const p = pipe(add3, multiply3);
  expect(p({
    symbol: "number",
    value: 100
  })).toEqual({
    symbol: "number",
    value: 309
  });
});
