import { expect, test } from "vitest";
import { type NumberValue } from "../value";
import { pipe } from "./pipe";

// Note: ☀️ is a normal test. ☁️ is a negative test

test("Pipe functions ☀️", () => {
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
