# Anonymous compute result

> Status: implemented 2026-08-17
> Origin: the ceremony visible in `spec/examples/` — 23 of the 25 `:=` result
> lines there name a binding that nothing reads. The two exceptions
> (`can_vend` in `01`, `short` in `03`) are both read by a
> `next <cond> -> <action>` guard.

## As built

Implemented as specified — trailing anonymous egress promoted to `__result` in
`deriveMarker`, named in the parser, typed in lowering — with four things worth
recording:

- **The generated name reaches a fourth place in the model.** The proposal named
  three (binding, merge entry, `compute.root`); the prog's `sigils` map is keyed by
  binding name too. It never reaches an emitted artifact — HCL does not carry
  sigils and `json.go:82` strips them — but a model-level comparison sees it, and
  the equivalence test had to rename it to pass.
- **`names.IsGenerated` was extracted rather than adding a fourth term.** Both
  allowlist sites in `validate_prog.go` spelled out the same conjunction of
  per-generator predicates. A fourth generator made that two places to keep in
  sync, so the disjunction now lives in `names` and the call sites ask one
  question.
- **The transition case reports one diagnostic, not two.** The proposal predicted
  `MissingConditionMarker` *and* `TransitionOutputSigil` for a trailing write in a
  next compute. Only the first appears: `ParseFile` returns no AST when it has
  errors, so lowering — which owns the second — never runs.
- **All 23 candidate lines in `spec/examples/` were converted.** Three comments
  needed rewording: `01`'s `Covers:` header, its NOTE in `dispense` that said the
  `:=` result must be last, and `04`'s "the result binding, declared last"
  banner. `01` now draws the contrast explicitly — `can_vend` keeps its name
  because `next can_vend -> dispense` reads it, and the very next action's result
  is a bare trailing write.

Verification results are recorded at the bottom.

## The problem

Every `compute` block must end in a `:=` result binding, because that binding's
name becomes `compute.root` (`effect-dsl-spec.md §1.3`, `scene-graph.md §3` CAN'T).
When the result is also written to STATE and never read back, the name and the
type annotation are pure ceremony:

```hcl
watched:bool := (true) ~> @triage.paged
```

`watched` is referenced by nothing. Its type is already fixed by
`@triage.paged`. The line's whole content is "write `true` to `@triage.paged`,
and that is this action's result" — but the first three tokens exist only to
satisfy the grammar.

The same block already has a spelling for a write nobody reads:

```hcl
(trend) ~> @triage.note
```

So an author writing `watch_graph` in `02-incident-triage.tu` uses the short
form for every write but the last, then switches spelling for the last one and
invents a name for it. The inconsistency is the tell.

## The proposal

Let a trailing anonymous egress be the compute result:

```hcl
watched:bool := (true) ~> @triage.paged     # today
(true) ~> @triage.paged                     # proposed, when `watched` is unused
```

The rule, stated precisely:

> In an action `compute` block with no `:=` binding, if the last item is an
> anonymous egress (`(expr) ~> @ns.field`), that item is the compute result.

No new tokens, no new grammar production — `anonymous-egress` already parses.
What changes is which programs are *accepted*: a block whose last line is an
anonymous egress and which has no `:=` at all.

### Why this is backwards compatible

A block with no `:=` is a `MissingRootMarker` error today, and a block with a
`:=` followed by an anonymous egress is a `MarkerNotLast` error today. So every
file affected by the new rule is a file that does not compile today, and no
currently-valid file changes meaning. That is the same guarantee the other
proposals in this directory hold themselves to, and here it comes for free
rather than needing an emit-time no-op check.

### Scope: action `compute` only

A transition `compute` keeps requiring `:=`. Its result is a branch condition,
and an anonymous egress writes to STATE, which a transition may not do
(`TransitionOutputSigil`, raised at `lower_inline_io.go:33`). Promoting a
trailing egress there would mean accepting the marker and then rejecting the
write — two diagnostics for one line, the second one the real reason. Keep
`MissingConditionMarker` firing in transitions instead, and extend its message
to say why a trailing `(expr) ~> @path` cannot serve.

### Explicitly out of scope

A parenthesized last line with no destination — `(in_stock & paid)` as a result
that writes nowhere — is a different feature. It collides with the existing rule
that a top-level parenthesized RHS is reserved for egress
(`parser_action.go:200`), and a result that reaches neither STATE nor a
transition is observable only in the trace. Not worth the ambiguity.

## Mechanism: desugar to a named result

State the rule as a desugaring, the way `scene-graph.md §3` already states the
`next <cond> -> <action>` sugar as "exactly equivalent to" the block form it
abbreviates:

```hcl
(true) ~> @triage.paged                     # what the author writes
__result:bool := (true) ~> @triage.paged    # exactly what it means
```

The promoted item becomes an ordinary named result binding with a
compiler-generated name, so `deriveMarker`, lowering, emit, and the runtime all
see the shape they already handle. Nothing downstream learns that a result can be
anonymous.

### Why a dedicated name, not the `__egress_N` sequence

The obvious move is to let the promoted binding take the next
`__egress_N`, since it is an anonymous egress and lowering already names those
(`materializeAnonymousEgresses`, `lower_anonymous_egress.go:20`). That is worse,
for two reasons:

- **`__egress_N` is positional, and the root's name would inherit that.** Adding
  an unrelated `(x) ~> @ns.field` write above the result renumbers it, so
  `root = "__egress_2"` becomes `root = "__egress_3"` and the binding and merge
  entry names shift with it. An edit that touched a different line churns the
  emitted model.
- **It labels the value wrong.** `computeRootValue` in the trace
  (`action-executor.ts:144`) would come back keyed `__egress_2`, which reads as
  "the second write" rather than "the result".

A single fixed name — `__result` — has neither problem. It needs no counter,
because a prog has exactly one result and binding names are prog-scoped
(`buildBindingScope` builds one scope per prog), and it survives edits above it
untouched.

Excluding the promoted binding from the `__egress_N` count is safe: the promoted
one is always last, so it would have held the highest number, and dropping the
highest number shifts none of the others. Every write that is *not* the result
keeps exactly the name it has today.

### Why this is simpler than promoting an anonymous binding

`compute.root` is derived in the parser (`deriveMarker`, `parser_action.go:314`)
from a binding *name*, but anonymous egresses are not named until lowering. A
promotion that kept the anonymous binding anonymous would therefore have to move
egress naming into the parser, or split root derivation across two stages.

A fixed name needs neither: the parser can write `__result` itself, and the
`__egress_N` counter stays exactly where it is. The change inside `deriveMarker`
is then, before it collects the marked bindings: if `want == MarkerRoot`, nothing
is marked, and the last binding is an anonymous egress, set
`Marker = MarkerRoot` and `Name = names.GeneratedResultName` on it. Every
existing invariant — one result, correct role, last — then applies to it
unchanged.

The binding keeps `Anonymous: true`, because that flag is what drives the
destination-type lookup in lowering. So lowering's only change is to skip the
counter and the name for the anonymous binding that is already marked, while
still resolving its `Type` from the egress path.

Setting `Marker` on an anonymous binding is safe: `Marker` is read in exactly two
places outside `deriveMarker` (`lower.go:457`, transition-only, and the parser's
own scan), so marking an action-level binding cannot perturb the
`isDeterministicNext` fast path.

### Files

- `internal/names/names.go` — `GeneratedResultName = "__result"` and
  `IsGeneratedResultName`, following the `GeneratedEgressPrefix` pattern.
- `internal/parser/parser_action.go` — promote and name in `deriveMarker`; extend
  the `MissingRootMarker` / `MissingConditionMarker` / `MarkerNotLast` messages
  to mention the shorthand where it is the likely fix.
- `internal/lower/lower_anonymous_egress.go` — leave the marked binding's name
  alone and do not count it; still resolve its type from the destination.
- `internal/validate/validate_prog.go` — add `IsGeneratedResultName` to the
  reserved-name allowlist at `:195`, or `__result` is rejected as a `__`-prefixed
  user name. Add it to the unused-binding skip at `:111` too for symmetry, though
  the root is reachable by definition and would never be reported.
- `spec/effect-dsl-spec.md` — §1.2 grammar note, §1.3 ("requires exactly one
  `:=`"), and §1.1's sentence "Anonymous egress cannot be the contextual compute
  result", which this proposal deletes.
- `spec/scene-graph.md` §3 CAN'T — "cannot omit its `:=` result binding" gains
  the exception.
- `spec/examples/` — 23 result lines across the five files become the shorthand.
  Converting all of them makes the two that stay the interesting ones, and
  `01-vending-machine.tu` already draws that contrast in one file: `can_vend`
  keeps its name because `next can_vend -> dispense` reads it, while
  `released:bool := (true) ~> @machine.dispensed` in the very next action becomes
  `(true) ~> @machine.dispensed`. Whether to convert all 23 or leave some as a
  demonstration of the long form is a call for whoever implements this; the
  comment in `dispense` that says "the `:=` result must be the last binding"
  needs rewording either way.

No proto change, no runtime change. Nothing in `packages/ts` keys off the
`__egress_` / `__local_` / `__if_` prefixes, so a fourth generated name needs no
registration on the runtime side — `__result` is just a binding name to it.
`apps/vscode` needs nothing either: the tokens are unchanged
(`tu.tmLanguage.json:171` already covers the line).

## What the author gives up

Not free, and the trade should be stated where the shorthand is documented:

- **The emitted model is not identical to the explicit spelling.** The binding
  name changes from `watched` to `__result` in three places in the emitted
  artifact — the prog binding, the merge entry, and `root =` — plus the model's
  `prog.sigils` key, which no emitter writes. Model diffs on conversion are
  therefore expected, unlike the byte-identical guarantee that other syntax work
  in this repo has claimed. The name is at least stable — it does not move when
  unrelated lines above it change.
- **The declared type stops being a cross-check.** Today `watched:bool` and
  `@triage.paged` must agree or `StateTypeMismatch` fires. The shorthand takes
  the type from the destination, so there is nothing left to disagree.
- **No named type on the result.** `state.FieldMeta` carries only a base
  `FieldType` (`state.go:22`), so a result needing a named literal/template
  annotation keeps the explicit form.
- **`computeRootValue` in the trace is keyed by a generated name.** The value is
  the same — `action-executor.ts:144` resolves `compute.root` and nothing else
  reads it — but a harness printing binding names sees `__result` rather than
  `watched`. That is the least bad of the generated labels available, and it is
  the only one an author never has to read back.

## Deliberately not included: a lint that pushes authors to the shorthand

The framing of this change is "when the name is unused", which invites a warning
on a named `:=` result that nothing reads. It is implementable — `validate_prog`
already computes reachability, and `actionExitNames`
(`validate_scene.go:85`) already collects exactly the reference sources that make
a result name load-bearing: other bindings in the prog, and transition
`from_action` entries, which is where the `next cond -> target` sugar and
`next on (...) to` arms both land after expansion. The result's own merge
entry must not count, or every result would look used.

It is left out of this proposal because it would fire on 23 of the 25 result
lines in `spec/examples/`, and "you could have written this shorter" is a
different kind of diagnostic from everything else in `diag_codes.go`. Worth
revisiting once the shorthand has been used enough to know whether the long form
is a smell or just a choice.

## Verification

Results as run on 2026-08-17.

- **Equivalence.** `TestPromotedResultLowersLikeANamedResult` lowers the same block
  twice, once as `(true) ~> @app.paged` and once as
  `watched:bool := (true) ~> @app.paged`, renames `watched` to `__result` in the
  four places the model carries it, and compares with `proto.Equal`. Identical.
  Confirmed independently on the CLI: the two spellings' emitted HCL differs in
  exactly three lines, all of them the name.
- **Name stability.** `TestPromotedResultStaysOutOfEgressNumbering` inserts a
  write above the result and checks that the result keeps `__result` while the
  writes above it number `__egress_1`, `__egress_2`. This is the check that pays
  for the dedicated name.
- **Type from the destination.** `TestPromotedResultTypeComesFromDestination`:
  `(7) ~> @app.total` gives `__result` type `number`.
- **The `__` gate.** `TestCompileSourcePromotedResult` compiles a promoted-result
  file through parse → lower → validate → emit with no diagnostics, which is the
  only stage that would have rejected `__result` as a user name. `TestIsGenerated`
  pins the allowlist itself, and `__mine` still reports `ReservedName`.
- **Ordering rule untouched.** `TestExplicitResultSuppressesPromotion`: with a
  `:=` present, a trailing write is still `MarkerNotLast` and no `DuplicateMarker`
  appears, so it was not promoted alongside the explicit result.
  `02-incident-triage.tu`'s `classify_graph` — anonymous writes above an explicit
  result — is unchanged in the emitted model.
- **Transitions.** `TestTrailingEgressNotPromotedInTransition`:
  `MissingConditionMarker`, no `MarkerContext`. One diagnostic, not two — see
  "As built".
- **Not-last is not promoted.** `TestTrailingEgressNotPromotedWhenNotLast` keeps
  `MissingRootMarker` for a block holding an anonymous egress anywhere but last.
- **Suites.** Go `go test ./...`, `vet`, and `-race` green; `pnpm test:ts`
  (runtime + scene-runner, 572 scene-runner tests) and `pnpm test:e2e` (68 tests,
  which rebuild the converter and drive the converted `spec/examples/` through the
  runtime) green; `pnpm check:format` clean and `node --test scripts/*.test.mjs`
  green. All five examples convert with no diagnostics.
