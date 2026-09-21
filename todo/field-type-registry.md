# Take `FieldType` out of the process-global registry

> Status: implemented 2026-09-21 — option A, value-type variant.
> Origin: code analysis, 2026-09-20. The wart is already named in
> `internal/ast/ast.go:248`: "the honest fix is to stop interning into a global
> at all". This is what that would take.

## The problem

`ast.FieldType` is an `int` handle into package-level state (`ast.go:70-81`):

```go
fieldTypesMu     sync.RWMutex
fieldTypes       = map[FieldType]fieldTypeDesc{...}   // 12 base types
fieldTypesByName = map[string]FieldType{...}
nextFieldType    = fieldTypeSentinel
```

The twelve base types are constants. Everything composed — `arr<arr<number>>`,
`rec<str, arr<rec<str, bool>>>` — is interned on first sight by
`FieldTypeFromString` (`ast.go:261`) and never released, because a `FieldType`
is an integer that has to keep meaning the same thing for as long as anything
holds it.

For the CLI this is fine: it compiles one file and exits. It is not fine for the
callers the cached-schema API exists for — an LSP, an incremental checker, the
Node bridge — which compile source they did not write, for as long as the
process lives. Two consequences:

- Compile outcomes depend on what the process compiled earlier. At
  `MaxRegisteredFieldTypes` (4096, `ast.go:250`) registration fails, and
  `FieldTypeFromString` returns false for a type that would otherwise be
  accepted. `RegisteredFieldTypes()` lets a host watch the number; it cannot
  recover from it without restarting.
- Every type lookup takes a mutex. `fieldTypeDescriptor` (`ast.go:100`) is
  behind an `RWMutex` and is called by every method below, on a path that is
  otherwise pure computation.

The bound is not a budget to design against — reaching it means something is
generating type spellings rather than writing them. The mutex is not a
measured bottleneck. What makes this worth fixing is the first consequence:
a compiler whose answers depend on its own history is one that cannot be
reasoned about from the source in front of it.

## Why it looked large

`FieldType` is an `int`, and everything you can ask about one is a method on
that int that reaches into the global:

| Method | `ast.go` | Non-test call sites |
| --- | --- | --- |
| `String()` | 107 | used throughout, including via `%v` / `%s` |
| `ProtoString()` | 116 | 24 |
| `IsRecord()` | 295 | 12 |
| `IsArray()` | 313 | 10 |
| `TryElemType()` | 317 | 9 |
| `RecordValueType()` | 306 | 5 |
| `Valid()` | 106 | 4 |
| `RecordKeyType()` | 299 | 3 |

Six packages hold `ast.FieldType` values: `parser`, `state`, `lower`,
`validate`, `emit`, `fnmeta`. `FieldTypeFromString` has 15 non-test call sites
outside `ast`.

Two constraints looked like they made this harder than threading a parameter.
Both dissolve under the design below, which is most of why it is the one being
built.

**`FieldType` implements `fmt.Stringer`.** Fourteen non-test sites pass one to a
format verb, and the diagnostics they produce are asserted on by name in the
test suites. A `String()` that took a registry would stop `FieldType` being a
`Stringer`, and every `%v` of one would silently start printing an integer.

**A `FieldType` outlives a single compile.** `state.Schema.Type`
(`internal/state/state.go:23`) is a `FieldType`, `Schema` is re-exported as
`converter.Schema`, and the whole point of the cached-schema API is that a
caller resolves a schema once and hands it back on every later call:

```go
schema, order, ds := converter.ResolveSchema(name, src, base)
// ... many edits later
result, ds := converter.CompileWithSchema(name, src, schema, order)
```

So no per-compile registry can own these values. An int minted by compile A's
registry, handed back to compile B's, is a different type or no type at all.

## Options

**A. Registry owned by the caller, threaded through the API.** A
`*ast.TypeRegistry` created by the host and passed to every entry point, carried
inside `Schema` so a cached schema and its registry cannot be separated.

Costs: a parameter on every entry point in `converter.go`, a field on `Schema`,
an answer to the `Stringer` problem, and a new failure mode — a `Schema` from
one registry handed to a compile on another — that has to be detected rather
than merely avoided.

**A′ (chosen). The value-type variant of A: a `FieldType` is its own canonical
spelling.**

```go
type FieldType string

const (
	FieldTypeInvalid FieldType = ""          // zero value stays invalid
	FieldTypeNumber  FieldType = "number"
	FieldTypeArrStr  FieldType = "arr<str>"
	// ...
)
```

There is no registry to own, thread, or mismatch. `FieldTypeFromString` parses,
canonicalises, and returns; nothing is interned, so nothing is retained and
nothing has a ceiling. `String()` stays a no-argument `Stringer`. Equality is
structural rather than by handle, `IsArray()` is a prefix test, `TryElemType()`
is a substring slice, and `MaxTypeNodes` is enforced exactly where it is now.

What the code says about the cost, checked site by site rather than assumed:

- **Nothing outside `ast.go` treats a `FieldType` as an integer.** Every one of
  the non-test uses is `==`, a `switch`, a struct field, or a map key
  (`fnmeta.methodMap`, `internal/fnmeta/fnmeta.go:252`). No arithmetic, no
  ordering, no indexing, no `int()` conversion. The only int-shaped code is
  `BaseFieldTypes()`'s loop and `String()`'s `FieldType(%d)` fallback, both
  inside `ast.go`.
- **The wire format already carries names.** All 24 `ProtoString()` sites write
  `BindingModel.Type` as a string, so emitted models are unchanged byte for
  byte.
- **`Schema.Hash()` already hashes `meta.Type.String()`**
  (`internal/state/state.go:73`), so a schema hash covers its field types
  already.
- **No API signature changes.** No registry parameter on `ResolveSchema` or
  `CompileWithSchema`, no field on `Schema`. The cross-registry failure mode
  option A introduces cannot occur, because there are no registries.
- **`ast` is an internal package.** External Go callers cannot name
  `ast.FieldType`; they reach `FieldMeta.Type` only through its methods, whose
  signatures do not change.

**B. Keep the global, make it resettable.** An `ast.ResetFieldTypes()` a
long-lived host calls between documents. Cheap, and wrong: any `FieldType` held
across the reset — including one inside a cached `Schema` — silently changes
meaning. It trades a bound you can observe for corruption you cannot.

**C. Do nothing, document the ceiling.** Honest, and adequate while the only
shipping caller is a CLI that exits. It was the correct status until the cost of
A′ turned out to be a sweep the compiler drives rather than an API change.

## What this gives up

Two things, both worth naming.

**An unchecked conversion is now spellable.** `ast.FieldType("rec<str,number>")`
compiles and produces a value that is not canonical — while a `FieldType` was an
opaque handle, the interning constructor was the only way in. The guard is a
lint: `check:fieldtype` grows a second rule rejecting `FieldType(` conversions
outside `internal/ast`, beside the bare-declaration rule it already carries.

**Type equality becomes a string compare**, and `methodMap` a string-keyed
lookup, where both were integer operations. Expected to sit in the noise against
parse and lower, but that is a measured claim rather than an assumed one — see
Verification.

## Order of work

1. `ast`: `FieldType` as a defined string type, base types as constants, the
   eight methods as pure string operations. Delete `fieldTypesMu`, `fieldTypes`,
   `fieldTypesByName`, `nextFieldType`, `fieldTypeDesc`, `fieldTypeDescriptor`,
   `MaxRegisteredFieldTypes`, `RegisteredFieldTypes` and
   `FieldTypeRejectedRegistryFull`. Keep `parseFieldTypeCore` and the
   `typeNodeCount` fast path untouched: they canonicalise the spelling and
   enforce `MaxTypeNodes`, and neither job moves. Keep the base-type constants
   and `BaseFieldTypes()` — they are pinned to `spec/field-types.json` by
   `internal/ast/field_types_spec_test.go` and
   `tests/field-types-parity.test.ts`, and nothing about them changes, though
   `BaseFieldTypes()` becomes an explicit ordered slice rather than a loop over
   an integer range.
2. `parser`: drop the `FieldTypeRejectedRegistryFull` arm of `reportTypeLimit`
   (`parser_state.go:22`). `diag.CodeTypeRegistryFull` becomes dead and is
   removed; it is referenced nowhere else in the repo — not in `spec/`, not in
   `docs/`, not on the TypeScript side.
3. The mechanical sweep, driven by the compiler: `return 0` for a `FieldType`
   becomes `return FieldTypeInvalid`. Untyped `0` is not assignable to a string
   type, so `go build ./...` names every site; none can be missed silently.
4. `state`, `lower`, `validate`, `emit`, `fnmeta` fall out of that sweep rather
   than needing passes of their own.
5. `check:fieldtype` grows the unchecked-conversion rule.

`converter.go` is not on this list. That is the point of A′: the API this was
all for does not change.

## Verification

- Two compiles in one process, of two files using disjoint composed types, must
  each see only their own. True by construction now, and pinned anyway.
- Compiling the same file 10,000 times in one process must not accumulate
  process state — the LSP-keystroke case, which today interns once and then hits
  the name cache.
- Every diagnostic naming a type must be unchanged, byte for byte. The type
  names in `spec/field-types.json` and the `%v`-formatted composed types are
  both asserted on; this change must be invisible in output.
- `pnpm run check:fieldtype` and `check:limits` must still pass, along with
  `field_types_spec_test.go` and `field-types-parity.test.ts` — the bare
  `FieldType` zero-value hazard, the `stateTypeNodes` bound, and the shared type
  vocabulary are all unaffected by where the registry lives, or by its not
  living anywhere.
- `BenchmarkCompileSource`, `BenchmarkCompileWithSchema` and
  `BenchmarkValidateWithSchema` before and after, because string equality
  replacing integer equality on a hot path is the one regression this change can
  plausibly cause.

The cross-registry test the threaded-registry design needed — a `Schema` from
registry A rejected by a compile on registry B — is not in this list. A′ has no
registries to mismatch, which is the rest of why it was chosen.

## What landed

`FieldType` is a defined string type. `internal/ast/ast.go` lost the mutex, both
maps, the sentinel counter, the descriptor struct and its accessor,
`MaxRegisteredFieldTypes`, `RegisteredFieldTypes` and
`FieldTypeRejectedRegistryFull`; `parseFieldTypeString` and `parseFieldTypeCore`
now return the canonical spelling and a bool, and the eight methods read that
spelling. `diag.CodeTypeRegistryFull` and the arm of `parser.reportTypeLimit`
that raised it are gone, since nothing can raise it any more. The sweep the
compiler drove touched `ast_literal.go` (3 sites), `fnmeta.go` (4),
`parser_state.go` (7), `validate.go` (10), `validate_prog_local.go` (19) and
`validate_tuple.go` (1): 35 returns of `0` for a `FieldType` became
`FieldTypeInvalid`, along with 2 comparisons against `0` and 6 call arguments.

`converter.go` was not touched, as predicted.

Tests added:

- `converter`: 5000 compiles with 5000 distinct composed types all succeed —
  under the old registry the 4097th interned type failed, and the 13-deep
  spellings these use would have exhausted it far earlier. Plus a file that
  compiles to the same bytes either side of an unrelated compile, and 10,000
  compiles of one file that stay byte-identical.
- `ast`: a composed type is a value — three spellings of one type compare equal,
  and its key, value and element types are canonical types in their own right.

Tests removed: `TestRegistryReportsItsSize`, which pinned a ceiling that no
longer exists. `TestEnumStringOutOfBounds` lost its `FieldType(999)` case, which
has no representation now, and pins the empty value instead.

`check:fieldtype` grew the conversion rule and both halves pass; so do
`check:limits`, `check:format`, `field_types_spec_test.go`,
`field-types-parity.test.ts`, `go vet` and the race suite.

Benchmarks, 200x × 5 on this machine, before → after: `CompileSource` 19.9 →
19.0 µs/op best-of-five, `CompileWithSchema` 19.0 → 19.4, `ValidateWithSchema`
18.7 → 18.9 — all inside the run-to-run spread, which is wider than the
difference. Allocation counts are unchanged (407/406/405); bytes per op rose
about 1.3% (36.5 → 37.0 KB on `CompileSource`), which is the type names now
being carried as strings where an int used to stand in for them. That is the
whole measured cost.
