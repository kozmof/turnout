# Collapse `prog` into `compute`

> Status: implemented 2026-08-16
> Origin: 1:1 compute/prog observation, 2026-08-16

## As built

Implemented as specified, with three deviations worth recording:

- **The migration reached further than this document scoped.** `packages/ts/scene-runner`
  carries three `.tu` fixtures plus DSL inside two e2e test files; all needed
  migrating, and `tests/e2e/schema-drift.test.ts` converts those fixtures with
  the freshly-built Go binary, so missing them would have failed CI.
- **`spec/pipe-if-case-it.md`** had a blank line between `compute {` and its
  `prog`, which no automated rewrite matched. Hand-migrated.
- **`scripts/migrate-syntax.mjs` was left alone.** It migrates the *previous*
  (v2) syntax boundary and still emits `compute { prog "x" { ... } }`, which
  the current parser now rejects. Its tests are textual and still pass, so this
  is latent rather than breaking. Open question whether it gains a phase for
  this boundary or is retired.

Verification results are recorded at the bottom.

## Context

`compute` and `prog` are 1:1 and always have been. An action's `compute` block
may hold exactly one `prog` block and nothing else — every other token is
rejected by the `default` case at `parser_action.go:296` and `:665`, and a
second `prog` is now a `DuplicateProg` error at both sites. So the inner block
carries exactly one piece of information the outer one doesn't: its name.

```turn
compute {
  prog "score_graph" {
    income:number <~ @applicant.income
    ok:bool := income >= 50000
  }
}
```

Two block headers, four lines of ceremony, one program. This proposal moves the
name onto `compute` and deletes the inner level from the surface language:

```turn
compute "score_graph" {
  income:number <~ @applicant.income
  ok:bool := income >= 50000
}
```

**The wire model does not change.** `ComputeModel{root, prog}` /
`NextComputeModel{condition, prog}` / `ProgModel{name, bindings}`
(`schema/turnout-model.proto:127,238`) keep both levels, the emitter keeps
writing canonical `compute { root = "..." prog "name" { ... } }`, and the
runtime keeps receiving a `prog` block to hand to `ctx()`
(`convert-runtime-spec.md:133,174`). This is a surface-syntax change only. The
parser fills `ProgBlock.Name` from the `compute` label instead of from a
separate header.

That boundary is what makes this safe, and it is also why `prog` is not being
removed from the vocabulary outright: it remains the canonical plain-HCL unit
(`hcl-context-spec.md`), the binding-scope unit (`todo/io-namespaces.md:9,54`),
and an addressing component in `SigilAnnotation.prog_name`
(`turnout-model.proto:51`). It just stops being something authors type.

## Decisions taken

- **Hard cut.** `compute { prog "x" { ... } }` stops parsing. No dual-spelling
  period, no deprecation window. All examples, tests, and specs migrate in the
  same change.
- **Label required.** `compute "name" { ... }` always, mirroring today's
  mandatory `prog "name"`. Prog names stay author-chosen rather than derived
  from the action ID.

## Surface after the change

```turn
action "score" {
  compute "score_graph" {
    income:number <~ @applicant.income
    debt:number   <~ @applicant.debt
    ok:bool       := income >= 50000
  }
  prepare { ... }
  merge   { ... }

  next {
    action = approve
    compute "to_approve" {
      decision:bool <~ action(ok)
      c:bool        := decision
    }
  }
}
```

`next { action = b }` with no compute at all is unaffected — it is already the
canonical form for deterministic transitions (`scene-graph.md:61`).

## Implementation

### 1. Parser — `packages/go/converter/internal/parser/parser_action.go`

The binding loop currently living in `parseProgBlock` (`:245-269`) is the piece
both compute parsers need. Extract it rather than duplicating:

```go
// parseProgBody parses `{ <binding-decl>... }` and returns the ProgBlock the
// model still expects. pos and name come from the enclosing compute header.
func (p *parser) parseProgBody(pos ast.Pos, name string) *ast.ProgBlock
```

It keeps the existing `TokLParen` → `parseAnonymousEgress` / else
`parseBindingDecl` dispatch verbatim.

Then:

- **`parseComputeBlock` (`:274`)** — after `expect(TokKwCompute)`, expect a
  `TokStringLit` label, then delegate to `parseProgBody`. `deriveMarker(prog,
  MarkerRoot)` and the returned `ComputeBlock{Pos, Root, Prog}` are unchanged.
- **`parseNextComputeBlock` (`:642`)** — same shape with `MarkerCond`, keeping
  the `p.inNextCompute = true` / `defer` pair wrapped around the body so
  transition ingress sources still resolve differently.
- **Delete both duplicate-`prog` guards** (`:287` and `:654`). They become
  unreachable — with no inner block there is nothing to repeat. This removes
  the guard added on 2026-08-16 along with its `TestParseDuplicateProgBlock`.
- **`parseProgBlock` is deleted.** Its only callers are the two compute
  parsers (`:295`, `:663`), both rewritten above.

### 2. Legacy-syntax diagnostic

Keep `prog` reserved in the lexer (`lexer.go:73,239`). Do **not** drop it from
`keywordTable` — if `prog` becomes an ordinary identifier, an old file lexes as
`IDENT STRING {` and produces a confusing cascade of binding-declaration
errors instead of one clear message.

In `parseProgBody`, seeing `TokKwProg` where a binding is expected emits a new
`LegacyProgBlock` code (`diag_codes.go`) with a migration message naming the
new form, then `skipBlock()`s to recover:

```
prog blocks were merged into compute; write compute "score_graph" { ... }
```

`CodeDuplicateProg` stays defined — `hcl-context-spec.md:564,747` still uses it
for the canonical layer, where a file may genuinely hold at most one `prog`.

### 3. AST, lowering, emit — no change

`ComputeBlock`/`NextComputeBlock`/`ProgBlock` (`ast_action.go:19-30,176`),
`lowerProgInner` (`lower.go:492`), and `writeCompute`/`writeProg`
(`emit.go:340-370`) are all untouched. If any of these need edits, the change
has leaked past the surface and should be re-examined.

### 4. VS Code grammar — `apps/vscode/tu-language/syntaxes/tu.tmLanguage.json`

`:119-120` matches `scene|action|prog` as the string-labeled block keywords.
Move `compute` into that alternation and drop `prog`, updating the comment on
`:119`. `compute` must also be removed from the bare-keyword rule at `:132`
(`\b(compute|io|next|in|out)\b`) or the two rules double-match it.

### 5. Migration — surface sources only

The mechanical risk here is that `prog "` appears in two unrelated roles, and a
blind find/replace corrupts the second:

| Role | Action |
|------|--------|
| Turn DSL surface source (`.tu` files, test input strings) | Migrate |
| Canonical plain HCL (emitter output, expected-output strings, `hcl-context-spec.md`) | **Leave alone** |

`packages/go/converter/internal/emit/*_test.go` contains **both** in the same
files — `.tu` input compiled via `CompileSource`, and expected canonical HCL
asserting `prog "..."` in the output. Edit inputs only.

Scope: 7 files in `spec/examples/`, ~32 `*_test.go` files under
`packages/go/converter`, and the surface examples in `scene-graph.md`,
`effect-dsl-spec.md`, `hook-spec.md`, `state-shape-spec.md`,
`pipe-if-case-it.md`, `literal-template-types-spec.md`. Prose in those files
that says "`compute.prog`" needs rewording to just "`compute`", which is more
than a syntax swap — `scene-graph.md` alone has 35 mentions.

### 6. Spec corrections folded in

- `convert-runtime-spec.md:46` claims the CLI emits `prog "<actionId>"`, but
  its own example below uses `prog "checkout_graph"` inside `action "checkout"`
  and `lower.go:505` copies the author's name verbatim. Fix the line to say the
  name is author-chosen — the decision above makes that binding.
- `hcl-context-spec.md:564,747` describe `DuplicateProg` as a per-*file* rule.
  Scope those entries explicitly to the canonical ContextSpec layer now that
  the surface cannot express the error at all.

## Verification

1. `TMPDIR=/workspace/tmp go test ./...` from `packages/go/converter`, plus
   `go vet ./...` and `gofmt -l`. (The default `TMPDIR` is not writable in this
   environment; the Go toolchain fails before running anything without it.)
2. **Model-identity check — the load-bearing one.** Before the change, emit
   canonical output for every example:
   `for f in spec/examples/*.tu; do turnout convert "$f" -o - > "before/$(basename $f).hcl"; done`
   Migrate, re-emit, and `diff -r`. The output must be **byte-identical**. Any
   diff means the surface change reached the model, contradicting the premise
   of this proposal. Repeat with `-format json`.
3. New `TestParseLegacyProgBlock` in `parser_irregular_test.go`, replacing
   `TestParseDuplicateProgBlock`: old-form source produces exactly one
   diagnostic, code `LegacyProgBlock`, anchored on the `prog` line. Assert
   diagnostics only — `ParseFile` returns a nil `*ast.TurnFile` whenever there
   are errors (`parser.go:21`), so post-error AST state is not observable.
4. Confirm a missing label (`compute { ... }`) is a clean single syntax error,
   not a cascade through the binding loop.
5. Open a migrated `.tu` in VS Code and confirm `compute "name"` highlights as
   a labeled block and `prog` no longer highlights as a keyword.

## Cost

The parser change is small and the model is untouched, so the risk concentrates
in step 5 of the implementation — a wide, mostly mechanical migration across
~40 files where one class of occurrence must be edited and a similar-looking
one must not. Worth doing in two commits: the parser/diag/grammar change with
its tests, then the migration, so a bisect can separate a parser bug from a
bad sed.

That risk was real. An automated rewrite silently mangled
`TestEmitNextPrepareFromAction` in `internal/emit/emit_test.go` — a
`compute { prog "p" {` whose closer was `} }` on one line, so the brace
matcher latched onto the wrong closer and swallowed an `action = b` line. It
was caught by the test suite, not by review. Any future bulk rewrite of this
shape needs the compute-count invariant below and a green suite before it is
trusted.

## Verification performed

| Check | Result |
|-------|--------|
| `go test ./...` (converter, 15 packages) | pass |
| `go vet ./...`, `gofmt -l` | clean |
| scene-runner vitest | 552 pass |
| runtime vitest | 397 pass |
| `node --test scripts/*.test.mjs` | 5 pass |
| Model identity: 7 examples × {hcl, json} before/after | byte-identical |
| Model identity: 3 TS fixtures × json before/after | byte-identical |
| compute-count invariant across every migrated file | holds |

Model identity was checked by building the CLI from `HEAD` sources, emitting
canonical output for the pre-migration examples, then diffing against the
post-migration emit. That is the check that proves the surface change never
reached the model.
