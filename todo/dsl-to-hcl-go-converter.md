# Turn DSL → Canonical HCL Converter (Go CLI) — Implementation Plan

> **Scope**: Go CLI that reads `.turn` files and emits canonical plain HCL conforming to all spec files in `spec/`.
> **Pipeline**: `Turn DSL --[Go CLI]--> HCL file --[TypeScript runtime]--> STATE mutations`

---

## Architecture Overview

```
.turn file
  └── Lexer          → token stream
        └── Parser   → AST
              └── State Resolver   → resolved STATE schema (inline or state_file)
                    └── Lowerer    → canonical HCL AST
                          └── Validator  → type-checked + structurally-valid
                                └── HCL Emitter → .hcl output file
```

---

## Phase 1 — Project Scaffolding

### 1.1 Go module setup

- [ ] Create `packages/go/converter/` directory
- [ ] `go mod init github.com/turnout/converter`
- [ ] Define top-level package structure:
  - `cmd/turnout/` — CLI entry point (`main.go`)
  - `internal/lexer/` — tokenizer
  - `internal/parser/` — AST parser
  - `internal/ast/` — AST node types
  - `internal/state/` — STATE schema resolver
  - `internal/lower/` — DSL lowering to canonical HCL model
  - `internal/validate/` — structural + type validation
  - `internal/emit/` — HCL emitter
  - `internal/diag/` — diagnostic / error types
- [ ] CLI flags: `turnout convert <input.turn> [-o output.hcl]`

---

## Phase 2 — Lexer

Tokenize the Turn DSL surface syntax. The lexer must handle constructs that a stock HCL lexer does not support.

### Token types

- [ ] **Keywords**: `state`, `state_file`, `scene`, `action`, `compute`, `prepare`, `merge`, `publish`, `next`, `prog`, `root`, `condition`, `entry_actions`, `next_policy`, `from_state`, `from_action`, `from_hook`, `from_literal`, `to_state`, `hook`, `view`, `flow`, `enforce`, `text`
- [ ] **Typed key** (`name:type`): split on first `:` to produce `IDENT` + `TYPE` tokens
  - Types: `number`, `str`, `bool`, `arr<number>`, `arr<str>`, `arr<bool>`
- [ ] **Sigil prefixes**: `<~>`, `<~`, `~>` (parse longest-match first)
- [ ] **Infix operators**: `>=`, `<=`, `&`, `+` (distinguish from HCL attribute assignment `=`)
- [ ] **Special forms**: `#pipe`, `#if`
- [ ] **Ingress placeholder**: `_`
- [ ] **Triple-quoted strings**: `"""..."""` (Python-style docstrings on action blocks)
- [ ] **HCL heredoc**: `<<-EOT...EOT`
- [ ] **Literals**: integer, decimal, string (`"`), boolean (`true`/`false`), array (`[...]`)
- [ ] **Punctuation**: `{`, `}`, `[`, `]`, `(`, `,`, `:`, `=`, `.`, `=>`, `|`
- [ ] **Comments**: `#` to end-of-line

### Disambiguation rules (per `hcl-context-spec.md §2`)

After `name:type =`, the parser selects form by first/second token:
- keyword literal (`true`/`false`) or numeric/string/`[` → **value binding**
- bare `IDENT` + `(` → **function call**
- bare `IDENT` + (`&`, `>=`, `<=`, `+`) → **infix expression**
- bare `IDENT` + (EOL / `}` / next `IDENT:`) → **single-reference form**
- `{` → **block form** (cond / #if compat / pipe compat)
- `#pipe` → **pipe form**
- `#if` → **if form**
- sigil + `_` → **ingress placeholder**

---

## Phase 3 — AST Node Types (`internal/ast`)

Define Go structs for every DSL construct.

### Top-level

- [ ] `TurnFile { StateSource StateSource; Scene *SceneBlock }`
- [ ] `StateSource` interface with two impls: `InlineStateBlock` and `StateFileDirective`

### State block

- [ ] `InlineStateBlock { Namespaces []*NamespaceDecl }`
- [ ] `StateFileDirective { Path string }`
- [ ] `NamespaceDecl { Name string; Fields []*FieldDecl }`
- [ ] `FieldDecl { Name string; Type FieldType; Default Literal }`
- [ ] `FieldType` enum: `Number | Str | Bool | ArrNumber | ArrStr | ArrBool`

### Scene block

- [ ] `SceneBlock { ID string; EntryActions []string; NextPolicy string; View *ViewBlock; Actions []*ActionBlock }`
- [ ] `ViewBlock { Name string; Flow string; Enforce string }`

### Action block

- [ ] `ActionBlock { ID string; Text *string; Compute *ComputeBlock; Prepare *PrepareBlock; Merge *MergeBlock; Publish *PublishBlock; Next []*NextRule }`
- [ ] `ComputeBlock { Root string; Prog *ProgBlock }`
- [ ] `ProgBlock { Name string; Bindings []*BindingDecl }`
- [ ] `BindingDecl { Sigil Sigil; Name string; Type FieldType; RHS BindingRHS }`
- [ ] `Sigil` enum: `None | Ingress | Egress | BiDir`
- [ ] `BindingRHS` interface with impls:
  - `LiteralRHS { Value Literal }`
  - `SingleRefRHS { RefName string }`
  - `FuncCallRHS { FnAlias string; Args []Arg }`
  - `InfixRHS { Op InfixOp; LHS Arg; RHS Arg }`
  - `PipeRHS { Params []PipeParam; Steps []PipeStep }`
  - `CondRHS { Condition CondExpr; Then string; Else string }`
  - `IfRHS { Cond CondExpr; Then string; Else string }` (sugar for cond)
  - `PlaceholderRHS {}` (for `_`)

### Prepare / Merge / Publish

- [ ] `PrepareBlock { Entries []*PrepareEntry }`
- [ ] `PrepareEntry { BindingName string; Source PrepareSource }` — `PrepareSource` is one of `FromState | FromHook | FromLiteral`
- [ ] `MergeBlock { Entries []*MergeEntry }`
- [ ] `MergeEntry { BindingName string; ToState string }`
- [ ] `PublishBlock { Hooks []string }`

### Next rules

- [ ] `NextRule { Compute *NextComputeBlock; Prepare *NextPrepareBlock; ActionID string }`
- [ ] `NextComputeBlock { Condition string; Prog *ProgBlock }`
- [ ] `NextPrepareBlock { Entries []*NextPrepareEntry }`
- [ ] `NextPrepareEntry { BindingName string; Source NextPrepareSource }` — one of `FromAction | FromState | FromLiteral`

---

## Phase 4 — Parser (`internal/parser`)

Recursive descent parser consuming the token stream.

### Entry point

- [ ] `ParseFile(src string) (*ast.TurnFile, []diag.Diagnostic)`

### State parsing

- [ ] Parse top-level `state { ... }` block into `InlineStateBlock`
- [ ] Parse top-level `state_file = "..."` into `StateFileDirective`
- [ ] Error if both present (`ConflictingStateSource`)
- [ ] Error if neither present (`MissingStateSource`)
- [ ] Parse namespace blocks and field declarations (`name:type = literal`)

### Scene parsing

- [ ] Parse `scene "<id>" { ... }` block
- [ ] Parse `entry_actions`, `next_policy`, `view`, actions
- [ ] Parse `action "<id>" { ... }` blocks
- [ ] Parse optional triple-quoted docstring at action top level → `text`
- [ ] Error on duplicate docstring + explicit `text` (`SCN_ACTION_TEXT_DUPLICATE`)
- [ ] Parse `compute`, `prepare`, `merge`, `publish`, `next` sub-blocks

### Prog parsing

- [ ] Parse `prog "<name>" { ... }` block with binding declarations
- [ ] Handle sigil prefix before typed key: `<~>income:number = _`
- [ ] Dispatch RHS parsing by disambiguation rules (see Lexer section)
- [ ] Parse function calls: positional `fn(a, b)` and named `fn(a: x, b: y)`
- [ ] Parse infix expressions: `lhs OP rhs`
- [ ] Parse `#pipe(p:v)[step1, step2]`
- [ ] Parse `#if { cond = ...; then = ...; else = ... }`
- [ ] Parse `{ cond = { ... } }` block form
- [ ] Parse `{ step_ref = N }`, `{ func_ref = "..." }`, `{ transform = { ... } }`

---

## Phase 5 — State Schema Resolver (`internal/state`)

- [ ] `Resolve(source ast.StateSource, basePath string) (*StateSchema, []diag.Diagnostic)`
- [ ] For `InlineStateBlock`: validate and build `StateSchema` directly
- [ ] For `StateFileDirective`:
  - Resolve path relative to the input file
  - Error if file missing (`StateFileMissing`)
  - Parse file — error if parse fails (`StateFileParseError`)
  - Error if the file contains anything other than a `state` block
- [ ] `StateSchema` type: `map[string]StateFieldMeta` keyed by dotted path (`ns.field`)
- [ ] Validate no duplicate namespaces (`DuplicateStateNamespace`)
- [ ] Validate no duplicate fields within namespace (`DuplicateStateField`)
- [ ] Validate `type` is one of the 6 valid strings (`InvalidStateFieldType`)
- [ ] Validate default value type-compatibility (`StateFieldDefaultTypeMismatch`)

---

## Phase 6 — DSL Lowering (`internal/lower`)

Lower every DSL surface construct to the canonical HCL model (an intermediate Go struct tree before text emission). This mirrors `hcl-context-spec.md` lowering rules.

### Binding lowering (per `hcl-context-spec.md §2–3`)

- [ ] `name:type = literal` → `binding "name" { type = "type" value = literal }`
- [ ] `name:type = identifier` (single-ref) → identity combine per type:
  - `bool` → `combine { fn = "bool_and" args = [{ ref = "identifier" }, { lit = true }] }`
  - `number` → `combine { fn = "add" args = [{ ref = "identifier" }, { lit = 0 }] }`
  - `str` → `combine { fn = "str_concat" args = [{ ref = "identifier" }, { lit = "" }] }`
  - `arr<T>` → `combine { fn = "arr_concat" args = [{ ref = "identifier" }, { lit = [] }] }`
- [ ] `name:type = fn(a, b)` (positional call) → `combine { fn = "fn" args = [{ ref = "a" }, { ref = "b" }] }`
- [ ] `name:type = fn(a: x, b: y)` (named call) → same, discard parameter names
- [ ] `name:bool = lhs & rhs` → `combine { fn = "bool_and" ... }`
- [ ] `name:bool = lhs >= rhs` → `combine { fn = "gte" ... }`
- [ ] `name:bool = lhs <= rhs` → `combine { fn = "lte" ... }`
- [ ] `name:str = lhs + rhs` → `combine { fn = "str_concat" ... }`
- [ ] `#pipe(p:v)[step1, step2]` → `pipe { args = { p = ref(v) } steps = [...] }`
- [ ] `{ cond = { condition = c then = t else = e } }` → `cond { condition = { ref = "c" } then = { func_ref = "t" } else = { func_ref = "e" } }`
- [ ] `#if { cond = fn(a,b) then = t else = e }` → auto-generate `__if_<name>_cond` binding + `cond` form
- [ ] `{ transform = { ref = "v", fn = "..." } }` → pass through unchanged

### Sigil lowering (per `effect-dsl-spec.md §6`)

- [ ] Strip sigil from binding name in canonical `binding` block
- [ ] `~>name:type = _` with STATE schema → resolve default value from STATE schema; emit `binding "name" { type = "type" value = <default> }`
- [ ] `~>` / `<~>` bindings → emit entry in `prepare { binding "name" { from_state = "..." } }`
- [ ] `<~` / `<~>` bindings → emit entry in `merge { binding "name" { to_state = "..." } }`
- [ ] `from_hook = "..."` → emit `binding "name" { from_hook = "..." }` in `prepare`

### Docstring lowering (per `scene-graph.md §5.1`)

- [ ] `"""..."""` → `text = <<-EOT\n...\nEOT`
- [ ] Trim one leading newline after opening `"""` and one trailing newline before closing `"""`

### State block lowering (per `state-shape-spec.md §3`)

- [ ] `state { ns { field:type = default } }` → `state { namespace "ns" { field "field" { type = "type" value = default } } }`

### Route DSL lowering (per `scene-to-scene.md §3`)

- [ ] `route "<id>" { match { path => scene_id, ... } }` → canonical HCL `route` block (deferred to Phase 8)

---

## Phase 7 — Validation (`internal/validate`)

All validation must complete before any HCL is emitted. Failures abort with no partial output.

### STATE schema validation (per `state-shape-spec.md §8`)

- [ ] Exactly one `state` source per file (`MissingStateSource` / `ConflictingStateSource`)
- [ ] No duplicate namespace labels (`DuplicateStateNamespace`)
- [ ] No duplicate field names within namespace (`DuplicateStateField`)
- [ ] Each field has `type` and `value` (`MissingStateFieldAttr`)
- [ ] `type` is one of 6 valid strings (`InvalidStateFieldType`)
- [ ] Default `value` type-compatible with declared `type` (`StateFieldDefaultTypeMismatch`)
- [ ] All `from_state` / `to_state` paths declared in STATE schema (`UnresolvedStatePath`)
- [ ] `to_state` target type matches source binding type across all actions (`StateTypeMismatch`)

### Binding validation (per `hcl-context-spec.md §5`)

- [ ] Literal matches declared `:type` (`TypeMismatch`)
- [ ] `:number` value is a valid numeric literal (`NonIntegerValue` — but decimals are allowed per spec)
- [ ] `arr<T>` elements all of type `T` (`HeterogeneousArray`)
- [ ] No nested arrays in value bindings (`NestedArrayNotAllowed`)
- [ ] At most one `prog` block per file (`DuplicateProg`)
- [ ] No duplicate binding names within `prog` (`DuplicateBinding`)
- [ ] No user binding name starts with `__` (`ReservedName`)
- [ ] Function alias in built-in table (`UnknownFnAlias`)
- [ ] Operator-only functions not used in call form (`OperatorOnlyFn`): `bool_and`, `gte`, `lte`, `str_concat`
- [ ] Bare identifier references resolve to declared binding (`UndefinedRef`)
- [ ] `func_ref` / `then` / `else` reference function bindings (`UndefinedFuncRef`)
- [ ] Binary call args are `(x,y)` or `(a:x,b:y)` (`InvalidBinaryArgShape`)
- [ ] Infix: valid operator, valid type pairing (`InvalidInfixExpr`)
- [ ] Arg types match function param types (`ArgTypeMismatch`)
- [ ] Return type matches declared binding type (`ReturnTypeMismatch`)
- [ ] Condition binding resolves to `bool` (`CondNotBool`)
- [ ] `then`/`else` return types match (`BranchTypeMismatch`)
- [ ] `step_ref = N` is within bounds (`StepRefOutOfBounds`)
- [ ] `step_ref` does not cross pipe boundary (`CrossPipeStepRef`)
- [ ] Pipe param source is a value binding (`PipeArgNotValue`)
- [ ] Single-ref form: referenced binding type matches declared type (`SingleRefTypeMismatch`)

### Effect DSL validation (per `effect-dsl-spec.md §5`, `convert-runtime-spec.md §Phase1`)

- [ ] Each `~>` / `<~>` binding has a `prepare` entry (`MissingPrepareEntry`)
- [ ] Each `<~` / `<~>` binding has a `merge` entry (`MissingMergeEntry`)
- [ ] No `prepare` entry for non-sigiled binding (`SpuriousPrepareEntry`)
- [ ] No `merge` entry for non-sigiled binding (`SpuriousMergeEntry`)
- [ ] No duplicate binding name in `prepare` (`DuplicatePrepareEntry`)
- [ ] No duplicate binding name in `merge` (`DuplicateMergeEntry`)
- [ ] `<~>` binding in `prepare` must also be in `merge` (`BidirMissingMergeEntry`)
- [ ] `<~>` binding in `merge` must also be in `prepare` (`BidirMissingPrepareEntry`)
- [ ] No `merge` or `publish` inside `next {}` (`TransitionMerge`)
- [ ] No `from_hook` in transition `prepare` (`TransitionHook`)
- [ ] No `<~` or `<~>` sigil in transition `prog` (`TransitionOutputSigil`)
- [ ] Transition `prepare` entry has exactly one of `from_action`, `from_state`, `from_literal` (`InvalidTransitionIngress`)
- [ ] No `from_state` + `from_hook` on same `prepare` entry (`InvalidPrepareSource`)
- [ ] Every `prepare` binding name has a matching `binding` in the same `prog` (`UnresolvedPrepareBinding`)
- [ ] Every `merge` binding name has a matching `binding` in the same `prog` (`UnresolvedMergeBinding`)
- [ ] `from_state` / `to_state` values are valid dotted paths (`InvalidStatePath`)
- [ ] No duplicate `action` block names in one HCL file (`DuplicateActionLabel`)

### Scene structural validation (per `scene-graph.md §6`)

- [ ] `actions` is non-empty
- [ ] `entryActionIds` non-empty; all referenced actions exist
- [ ] All `actionId`s are unique
- [ ] All `next.action` references exist in scene
- [ ] `compute.root` binding exists in `prog`
- [ ] Every `prepare` / `merge` binding key exists in `prog`
- [ ] `compute.condition` binding resolves to `bool` in each next rule
- [ ] Action docstring: at most one triple-quoted block; no conflict with `text =` (`SCN_ACTION_TEXT_DUPLICATE`)

### Phase 2 guard

- [ ] Reject `range`, `map`, `filter`, `fold` constructs with `UnsupportedConstruct`; abort immediately

---

## Phase 8 — HCL Emitter (`internal/emit`)

Emit canonical plain HCL text from the lowered model. All values quoted as strings where required by HCL spec.

### State block emission (per `state-shape-spec.md §3`)

```
state {
  namespace "<ns>" {
    field "<name>" {
      type  = "<type>"
      value = <default>
    }
  }
}
```

- [ ] Emit `state` block before `scene` block in output file
- [ ] Namespace blocks in declaration order
- [ ] Field blocks in declaration order
- [ ] String values quoted; number/bool unquoted; arrays as `[]` or `[v1, v2]`

### Scene block emission (per `scene-graph.md §5`)

```
scene "<id>" {
  entry_actions = ["<actionId>", ...]
  next_policy   = "<policy>"

  action "<id>" {
    text = <<-EOT
      ...
    EOT
    compute {
      root = "<binding>"
      prog "<name>" {
        binding "<name>" { type = "<type>" value = <lit> }
        binding "<name>" { type = "<type>" expr = { combine = { fn = "<fn>" args = [...] } } }
      }
    }
    prepare { binding "<name>" { from_state = "<path>" } }
    merge   { binding "<name>" { to_state   = "<path>" } }
    publish { hook = "<name>" }
    next {
      compute {
        condition = "<binding>"
        prog "<name>" { ... }
      }
      prepare { binding "<name>" { from_action = "<binding>" } }
      action = "<actionId>"
    }
  }
}
```

- [ ] `entry_actions` as string list attribute
- [ ] `next_policy` as string attribute
- [ ] Each action block with unique label
- [ ] `compute.root` and `next.compute.condition` as quoted strings
- [ ] `prog` block with `binding` blocks (not `name:type` keys)
- [ ] Expr blocks: `combine`, `pipe`, `cond` using reference objects `{ ref = "..." }` / `{ lit = <v> }` / `{ func_ref = "..." }` / `{ step_ref = N }`
- [ ] `prepare` / `merge` bindings quoted
- [ ] Multiple `hook` attributes in `publish`

### Reference normalization (per `scene-graph.md §2.3`)

- [ ] All reference-style fields emitted as quoted strings (bare form not used in output)

---

## Phase 9 — CLI Entry Point (`cmd/turnout`)

- [ ] Accept positional argument: input `.turn` file path
- [ ] Accept optional `-o` flag: output `.hcl` file path (default: same name, `.hcl` extension)
- [ ] Exit code `0` on success; `1` on any diagnostic error
- [ ] Print diagnostics to stderr in structured format: `<file>:<line>:<col>: error [<code>]: <message>`
- [ ] Support `-state-file` flag to override the `state_file` base path resolution
- [ ] Print emitted HCL to stdout when `-o -` is given

---

## Phase 10 — Route DSL (per `scene-to-scene.md`)

Lower and validate the `route` block after scene conversion is complete.

- [ ] Parse `route "<id>" { match { ... } }` block
- [ ] Parse pattern arms: path expressions, `|` OR, `_` catch-all
- [ ] Validate: at most one `_` (`DuplicateCatchAll`)
- [ ] Validate: no bare `scene_id.*` (`BareWildcardPath`)
- [ ] Validate: at most one `*` per path form (`MultipleWildcards`)
- [ ] Validate: all `=> <scene_id>` targets exist (`UnresolvedScene`)
- [ ] Emit canonical HCL `route` block

---

## Phase 11 — Tests

### Unit tests

- [ ] Lexer: all token types, sigil disambiguation, typed key splitting
- [ ] Parser: each AST node type; round-trip parse of all example `.turn` files
- [ ] State resolver: inline block, `state_file` load, all error codes
- [ ] Lowering: each DSL form → expected canonical HCL model; idempotency
- [ ] Validation: each error code triggered by its trigger condition
- [ ] HCL emitter: each construct emits byte-identical output on repeated calls

### Integration tests

- [ ] All example files in `spec/examples/` convert without errors; output matches expected canonical HCL
- [ ] Round-trip: emitted HCL parses with a stock HCL parser without error
- [ ] All error codes in all error catalogues have at least one test case that triggers them

### Critical-path idempotency (per specs)

- [ ] Same DSL source → byte-identical HCL on repeated invocations
- [ ] `state_file` form produces identical HCL to inline `state` form
- [ ] `S_0` initialization yields identical flat map from same schema
- [ ] TYPE mismatch in any action → correct error, correct action/binding identified

---

## Dependency Summary

| Phase | Depends on |
|-------|-----------|
| 2 Lexer | — |
| 3 AST | — |
| 4 Parser | Lexer, AST |
| 5 State Resolver | Parser, AST |
| 6 Lowering | Parser, AST, State Resolver |
| 7 Validation | Lowering, State Resolver |
| 8 HCL Emitter | Lowering, Validation |
| 9 CLI | All |
| 10 Route DSL | Parser, Validation, Emitter |
| 11 Tests | All |

---

## Error Code Index

All error codes that the converter must emit, grouped by spec source:

### `hcl-context-spec.md`
`TypeMismatch`, `NonIntegerValue`, `HeterogeneousArray`, `NestedArrayNotAllowed`, `DuplicateProg`, `DuplicateBinding`, `ReservedName`, `UnknownFnAlias`, `OperatorOnlyFn`, `UndefinedRef`, `UndefinedFuncRef`, `InvalidBinaryArgShape`, `InvalidInfixExpr`, `ArgTypeMismatch`, `ReturnTypeMismatch`, `CondNotBool`, `BranchTypeMismatch`, `StepRefOutOfBounds`, `CrossPipeStepRef`, `PipeArgNotValue`, `SingleRefTypeMismatch`

### `state-shape-spec.md`
`MissingStateSource`, `ConflictingStateSource`, `StateFileMissing`, `StateFileParseError`, `MissingStateBlock`, `DuplicateStateBlock`, `DuplicateStateNamespace`, `DuplicateStateField`, `MissingStateFieldAttr`, `InvalidStateFieldType`, `StateFieldDefaultTypeMismatch`, `UnresolvedStatePath`, `StateTypeMismatch`, `InvalidStatePath`, `MissingStatePath`

### `effect-dsl-spec.md` + `convert-runtime-spec.md`
`MissingPrepareEntry`, `MissingMergeEntry`, `SpuriousPrepareEntry`, `SpuriousMergeEntry`, `DuplicatePrepareEntry`, `DuplicateMergeEntry`, `BidirMissingPrepareEntry`, `BidirMissingMergeEntry`, `TransitionMerge`, `TransitionHook`, `TransitionOutputSigil`, `InvalidTransitionIngress`, `InvalidPrepareSource`, `UnresolvedPrepareBinding`, `UnresolvedMergeBinding`, `DuplicateActionLabel`, `UnsupportedConstruct`

### `scene-graph.md`
`SCN_INVALID_ACTION_GRAPH`, `SCN_ACTION_ROOT_NOT_FOUND`, `SCN_INGRESS_TARGET_NOT_VALUE`, `SCN_INGRESS_SOURCE_MISSING`, `SCN_EGRESS_SOURCE_INVALID`, `SCN_EGRESS_SOURCE_UNAVAILABLE`, `SCN_NEXT_COMPUTE_INVALID`, `SCN_NEXT_COMPUTE_NOT_BOOL`, `SCN_NEXT_INGRESS_SOURCE_INVALID`, `SCN_ACTION_TEXT_DUPLICATE`

### `scene-to-scene.md`
`DuplicateCatchAll`, `BareWildcardPath`, `MultipleWildcards`, `InvalidPathItem`, `UnresolvedScene`
