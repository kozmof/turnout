import assert from "node:assert/strict";
import test from "node:test";
import { migrate } from "./migrate-syntax.mjs";

test("preserves comments and string literals", () => {
  const source = [
    "# docs: call #if(a,b,c)",
    'note:str = "#case(x, y, z)"',
    "result:str = #pipe(value, #it.trim()) # keep #pipe(a,b)",
    '# example action = "publish_it" and ~>comment:str',
    '// example action = "publish_it" and #case(a,b,c)',
  ].join("\n");
  assert.equal(
    migrate(source).out,
    [
      "# docs: call #if(a,b,c)",
      'note:str = "#case(x, y, z)"',
      "result:str = pipe(value, #it.trim()) # keep #pipe(a,b)",
      '# example action = "publish_it" and ~>comment:str',
      '// example action = "publish_it" and #case(a,b,c)',
    ].join("\n"),
  );
});

test("still migrates references and sigils in DSL code", () => {
  const source = [
    'entry "start"',
    'action = "finish"',
    'entry_actions = ["start", "finish"]',
    "~>value:str",
  ].join("\n");
  assert.equal(
    migrate(source).out,
    ["entry = start", "action = finish", "entry_actions = [start, finish]", "value:str"].join("\n"),
  );
});
