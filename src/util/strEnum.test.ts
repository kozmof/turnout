import { expect, test } from "vitest";
import strEnum from "./strEnum";

// Note: ☀️ is a normal test. ☁️ is a negative test

test("Create Enum ☀️", () => {
  expect(strEnum(["a", "b", "c"])).toEqual({
    a: "a",
    b: "b",
    c: "c"
  });
});
