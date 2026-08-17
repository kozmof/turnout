# Remove the `all-match` next policy

> Status: implemented
> Decision taken: remove `next_policy` entirely, not just the `all-match` value.

Two things came out differently from the plan below, both recorded in
"Deviations" at the end.

## What is being removed

`all-match` is one of two values of the scene-level `next_policy` attribute. With it gone,
`first-match` is the only selection rule left, and an attribute with one legal value is
noise: every scene would carry `next_policy = "first-match"` or omit it and mean the same
thing. So the whole knob goes — keyword, AST field, proto field, TypeScript type, and the
diagnostic that exists only to police the interaction between `all-match` and match blocks.

After the change, next-rule selection is fixed: evaluate rules in declaration order, select
the first whose condition is true, stop. `next-rules.ts:188-191` collapses to an
unconditional `break`.

Three things fall out for free, because they exist only to describe the two-policy world:

- **`NextMatchPolicy` (`diag_codes.go:157`)** and `checkMatchPolicy`
  (`parser_scene.go:199-222`). A match block requires first-match; first-match is now the
  only thing there is, so the check can never fire.
- **`NextRule.FromMatch` / `NextRule.MatchPos` (`ast_action.go:176-184`)**. Their comment
  already says the scene-level policy check is their only consumer. Remove the check and
  they are dead fields on every expanded rule.
- **The `policy` discriminator on `SceneWarning` (`harness-types.ts:69`)** and the paired
  message branches in `enqueueNext` (`run-state.ts:41-88`), which today say two different
  things about the same duplicate depending on policy.

## Scope by layer

### Schema

`schema/turnout-model.proto:95-96` — drop `optional string next_policy = 3` and add
`reserved 3; reserved "next_policy";` to `SceneBlock`. Reserving matters: field 3 must never
be reused for something else, or an old serialized model deserializes a string into whatever
takes its place.

Regenerate with `pnpm generate`; `pnpm run check:proto` fails if `turnoutpb/turnout-model.pb.go`
or `src/types/turnout-model_pb.ts` are left stale.

**Compatibility note worth stating in the change, not discovering later.** `bridge.ts:429`
parses models with `ignoreUnknownFields: !strict`. Once the field is gone from the schema, a
previously emitted JSON model that still carries `"nextPolicy"` parses fine in lenient mode
and *fails* in strict mode. `tests/schema-conformance.test.ts:26` calls `fromJson` with no
options, i.e. strict — so the fixtures below are a hard gate, not a cosmetic edit.

### Go converter

| File | Change |
| --- | --- |
| `lexer.go:78,239` | Remove `TokKwNextPolicy` and its keyword-table entry. `next_policy` becomes an ordinary identifier, which in scene position is an "unexpected token" error. |
| `parser_scene.go:14` | Drop `TokKwNextPolicy` from `sceneBlockStarters`. |
| `parser_scene.go:171-175` | Remove the `case` that parses the attribute. |
| `parser_scene.go:199-222` | Delete `checkMatchPolicy` and its call site at line 194. |
| `parser.go:248` | Drop `TokKwNextPolicy` from the sync-token set. |
| `ast.go:263` | Remove `SceneBlock.NextPolicy`. |
| `ast_action.go:176-184` | Remove `FromMatch` / `MatchPos` and the parser code that sets them (in the match-block expansion). |
| `lower.go:298-300` | Remove the `NextPolicy` assignment. |
| `emit.go:140-142` | Remove the `next_policy = "..."` line from HCL emission. |
| `diag_codes.go:155-157` | Remove `CodeNextMatchPolicy`. |

Tests to update or delete: `lexer_test.go:382`, `parser_test.go:136,150-151,918-919`,
`parser_next_match_test.go:547-619` (two tests exist solely to prove a match block is rejected
under `all-match` — delete both), `ast_test.go:290`, `emit_test.go:145,155-167,574,731`,
`json_schema_test.go:36`, `converter_next_match_test.go:23,57`.
`overview_test.go:203` (`TestEnforceNodesOnlyAllMatch`) is unrelated — "all match" there means
all overview nodes matched. Leave it; consider renaming to avoid the collision when grepping.

### TypeScript runtime

- Delete `src/executor/next-policy.ts` and its import at `scene-executor.ts:14`, plus the
  `parseNextPolicy` call at `scene-executor.ts:141`.
- `harness-types.ts:35` — delete `NextPolicy`. Remove `policy` from `SceneWarning`
  (line 69). This is a public shape change for anyone reading warnings programmatically.
- `next-rules.ts` — drop the `policy` parameter (line 99), always `break` on a match
  (line 190), update the doc comment at line 82 which names `next_policy`.
- `run-state.ts` — `enqueueNext` drops its `policy` parameter; each of the two duplicate
  cases keeps one message instead of branching. Reword so the messages no longer name
  first-match, which stops meaning anything: `action "x" was enqueued by "y" but already
  ran; next rule points to an already-executed action`, and the pending variant likewise.
- `SceneRuntimeError("UnsupportedConstruct", …)` for a bad policy string disappears with
  `next-policy.ts`. Nothing replaces it — an unknown attribute is now a converter-side parse
  error, which is the right place for it.

Tests: `scene-executor.test.ts` (the `all-match policy` describe at 149, the duplicate-enqueue
describe at 432, the `parseNextPolicy` describe at 832, and the `nextPolicy` fields at
94/727/744/763/799/814/895), `execution-warnings.test.ts:38-66`,
`route-executor.test.ts:614-627`, `schema-conformance.test.ts:79`.

Note that both `duplicate_enqueue` tests currently *construct* an all-match scene to trigger
the warning, since that is the easy way to enqueue one action twice. Under first-match the
warning still fires — two different actions can each name the same target — so the fixtures
need reshaping, not deleting. Keep coverage of both the already-visited and
already-pending branches.

Fixtures carrying the field: `tests/fixtures/scene-graph.json:55`,
`tests/fixtures/workflow.json:85`, `tests/fixtures/workflow.tu:25`,
`tests/fixtures/scene-graph-full.tu:16`.

### Editor support

`apps/vscode/tu-language/syntaxes/tu.tmLanguage.json:120` — remove `next_policy` from the
keyword alternation.

## Documentation and examples

`spec/scene-graph.md` is the normative one: line 16 (determinism requirement), 62 (the
match-block/policy rule), 78 and 90 (`nextPolicy` in the runtime data model — note line 90 is
an *action-level* override that has no surface syntax and can go too), 182, 353-355 (§8 Next
Semantics), 415 (conformance item 6), and the `NextMatchPolicy` entry in §10.

`spec/convert-runtime-spec.md` carries the most all-match-specific prose: lines 169, 183-184,
200, 239, 251 (CAN'T table row 4, on parallel scheduling), 271, 282, 298-303 (behaviour
table rows). Rows that exist only to pin down all-match sequencing should be deleted rather
than reworded.

Also: `spec/scene-to-scene.md:43`, `spec/overview-dsl-spec.md:31,36`,
`spec/state-shape-spec.md` (6 snippet lines), `todo/transition-priority.md:44` (its open
question about priority under all-match is now answered by deletion),
`todo/e2e-test-framework.md:252-259`, `todo/dsl-to-hcl-go-converter.md:48,95,151,328,357`.

`spec/hook-spec.md:74,246,260` say "all matching bindings" — unrelated prose, leave alone.

### Examples

`01`, `02`, `03` (×4), `05` just drop a `next_policy = "first-match"` line; `02:37` also has a
comment explaining why all-match would break its match block.

`04-sensor-calibration.tu` is the real work. Its header (lines 10-11) sells all-match as a
covered feature, its scene comment (37-42) explains the policy, and `evaluate_array` fans out
to both `file_report` and `schedule_service` (161). **Decision taken: rewrite as a first-match
chain** — `evaluate_array -> file_report -> schedule_service` — so the example keeps its actual
subject, the operator and transform-method workout, which is why it exists. The
`overview at_least` block at 44-47 changes from two edges out of `evaluate_array` to a chain,
and the second follow-up's guard moves from "also true" to "true after the report is filed".

## Order of work

1. Proto + `pnpm generate` (everything else keys off the generated types).
2. Go converter, with its tests, until `pnpm run test:go` is green.
3. TypeScript runtime and fixtures until `pnpm run test:ts` is green.
4. Examples and spec prose.
5. `pnpm run check` for the full gate (proto sync, format, typecheck, lint, both suites,
   coverage, dist smoke).

## Verification

- A `.tu` file that writes `next_policy = "first-match"` must now fail conversion with a
  positioned parse error, not be silently accepted. Worth an explicit test: the attribute
  disappearing quietly is the failure mode that would leave authors' files "working" while
  meaning something they no longer say.
- A match block, previously rejected in an all-match scene, converts everywhere.
- A JSON model still carrying `"nextPolicy"` fails `bridge.ts` strict parsing and passes
  lenient — assert both, since this is the only externally visible break.
- Example `04` produces the same final STATE as before for the same inputs. The chain
  rewrite changes *when* `schedule_service` runs, not what the calibration math computes;
  if the final state differs, the rewrite changed semantics beyond the policy.
- `grep -rniE "all[-_ ]?match|next_policy"` over the repo returns only the unrelated hits:
  `hook-spec.md` prose and `overview_test.go`'s `TestEnforceNodesOnlyAllMatch`.

## Deviations

**1. One more branch died than expected.** `enqueueNext` had two duplicate cases, "already
ran" and "already pending". The pending one is now unreachable: selection returns at most one
id, and the step loop marks an action visited as it dequeues it, so anything already in
`enqueueSource` has necessarily run by the time a later enqueue sees it. Both the branch and
the `alreadyVisited` discriminator on `SceneWarning` were removed rather than left as
untestable defensive code — so `duplicate_enqueue` now carries `kind`, `actionId`,
`firstEnqueuedBy`, and `message` only. Its tests were rebuilt around a rule that points back
at a completed action (`a → b → a`), which is how the warning is reached under first-match.

**2. Example 04's STATE equivalence was verified by argument, not by running it.** The example
cannot execute: `floored:number = halved.floor()` takes a function binding as a transform
receiver, which the runtime's context builder rejects (`UndefinedValueReferenceError` on
`halved`). That predates this change — the compute blocks were not touched — and the e2e suite
only ever converts 04, never runs it. The equivalence argument is that
`score >= 400 ⟹ capped >= 400 ⟹ severe_level ⟹ band = "severe" ≠ "nominal"`, so every input
that fired `schedule_service` under all-match also fired `file_report`, in that order — which
is exactly the chain. What was verified directly is the converted graph:
`evaluate_array → file_report → schedule_service`, no `nextPolicy` key on the scene.

**3. `pnpm run check` cannot pass from an uncommitted tree.** `check:proto` regenerates and
then runs `git diff --exit-code` over the generated files, so any proto change fails it until
the regenerated output is committed. Everything else in the gate passes: `check:fn-map`,
`check:fieldtype`, `check:format`, `typecheck`, `lint`, Go vet/race/coverage (87.7%), both
vitest suites (573 + 397), the e2e suite (70), and the dist smoke.
