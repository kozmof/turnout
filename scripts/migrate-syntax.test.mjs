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
    [
      "entry = start",
      "action = finish",
      "entry_action = start  # migration: dropped finish — a scene now has one entry action",
      "value:str",
    ].join("\n"),
  );
});

test("collapses a single-element entry_actions list without a migration note", () => {
  assert.equal(migrate('entry_actions = ["start"]').out, "entry_action = start");
});

test("parenthesizes single-line and multiline computed egress idempotently", () => {
  const source = [
    "result:number = foo + bar ~> @billing.total",
    'status:str = "done" ~> @workflow.status',
    "tier:str = if(",
    "  flag,",
    '  "high",',
    '  "low"',
    ") ~> @risk.tier",
    "copy:number <~ @source.value ~> @snapshot.value",
  ].join("\n");
  const expected = [
    "result:number = (foo + bar) ~> @billing.total",
    'status:str = ("done") ~> @workflow.status',
    "tier:str = (if(",
    "  flag,",
    '  "high",',
    '  "low"',
    ")) ~> @risk.tier",
    "copy:number <~ @source.value ~> @snapshot.value",
  ].join("\n");
  assert.equal(migrate(source).out, expected);
  assert.equal(migrate(expected).out, expected);
});

test("replaces root and condition markers with contextual result assignment", () => {
  const source = [
    "|^| result:number = foo + bar",
    "|?| go:bool = ready",
    "|^| current:number <~ @counter.value",
    "|^| prepared:number",
  ].join("\n");
  const expected = [
    "result:number := foo + bar",
    "go:bool := ready",
    "current:number := <~ @counter.value",
    "prepared:number :=",
  ].join("\n");
  assert.equal(migrate(source).out, expected);
  assert.equal(migrate(expected).out, expected);
});

test("flips the conditional transition sugar to the arrow form", () => {
  const source = [
    "    next collect if scene_hotspot_found",
    "    next interview_witness",
    "    next escalate if flagged # was: next escalate if flagged",
    '    note:str = "next escalate if flagged"',
  ].join("\n");
  const expected = [
    "    next scene_hotspot_found -> collect",
    "    next interview_witness",
    "    next flagged -> escalate # was: next escalate if flagged",
    '    note:str = "next escalate if flagged"',
  ].join("\n");
  assert.equal(migrate(source).out, expected);
  assert.equal(migrate(expected).out, expected);
});

// The script emitted `compute { prog "x" { … } }` long after the parser stopped
// accepting it. Nothing caught that: these tests are textual and never compile
// what they produce, so "still passes" and "still works" had come apart.
test("collapses prog into the compute label", () => {
  const source = [
    'action "check" {',
    "  compute {",
    "",
    "    # the graph",
    '    prog "availability_graph" {',
    "      stock:number <~ @machine.stock",
    "      ok:bool := stock > 0",
    "    }",
    "  }",
    "}",
  ].join("\n");
  assert.equal(
    migrate(source).out,
    [
      'action "check" {',
      '  compute "availability_graph" {',
      "",
      "    # the graph",
      "    stock:number <~ @machine.stock",
      "    ok:bool := stock > 0",
      "  }",
      "}",
    ].join("\n"),
  );
});

test("collapses a prog that fits on one line, braces in its body and all", () => {
  assert.equal(
    migrate('action "a" { compute { prog "p" { m:rec<str,number> = {"a": 1} } } }').out,
    'action "a" { compute "p" { m:rec<str,number> = {"a": 1} } }',
  );
});

test("leaves a compute block that holds more than its prog", () => {
  // The old grammar did not allow this, so it is a hand-written oddity rather
  // than something to rewrite blind.
  const source = [
    "compute {",
    '  prog "p" {',
    "    a:bool := true",
    "  }",
    "  stray = 1",
    "}",
  ].join("\n");
  assert.equal(migrate(source).out, source);
});

test("is idempotent on already-migrated sources", () => {
  const migrated = ['compute "p" {', "  a:bool := true", "}"].join("\n");
  assert.equal(migrate(migrated).out, migrated);
  assert.equal(migrate(migrate(migrated).out).out, migrated);
});

test("does not rewrite DSL quoted inside a string literal", () => {
  const source = 'note:str = "compute { prog "';
  assert.equal(migrate(source).out, source);
});
