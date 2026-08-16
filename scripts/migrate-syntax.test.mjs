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
