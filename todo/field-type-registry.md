# Take `FieldType` out of the process-global registry

> Status: proposal, not implemented
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

## Why it is not a small change

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

Two constraints make this harder than threading a parameter:

**`FieldType` implements `fmt.Stringer`.** Fourteen non-test sites pass one to a
format verb, and the diagnostics they produce are asserted on by name in the
test suites. If `String()` takes a registry, `FieldType` stops being a
`Stringer`, and every `%v` of one silently starts printing an integer. Any
design has to keep a no-argument `String()` working or accept that it prints
`FieldType(37)` for composed types and fix every diagnostic that relied on it.

**A `FieldType` outlives a single compile.** `state.Schema.Type`
(`internal/state/state.go:23`) is a `FieldType`, `Schema` is re-exported as
`converter.Schema`, and the whole point of the cached-schema API is that a
caller resolves a schema once and hands it back on every later call:

```go
schema, order, ds := converter.ResolveSchema(name, src, base)
// ... many edits later
result, ds := converter.CompileWithSchema(name, src, schema, order)
```

So the registry cannot be per-compile. An int minted by compile A's registry,
handed back to compile B's, is a different type or no type at all. Whatever
owns the registry has to have at least the lifetime of the caller's schema
cache.

## Options

**A. Registry owned by the caller, threaded through the API.** A
`*ast.TypeRegistry` created by the host, passed to `ResolveSchema`, `Lower`,
`Validate` and the rest, and carried inside `Schema` so a cached schema and its
registry cannot be separated. Compiles become independent, an LSP drops a
document's types when it closes the document, and the mutex goes (a registry is
used by one compile at a time).

Costs: a parameter on every entry point in `converter.go`, a field on `Schema`,
and an answer to the `Stringer` problem. The likely answer is that the registry
interns *descriptors* and `FieldType` becomes a small struct rather than an
int — at which point `String()` needs no registry at all, and the global
disappears rather than moving. That is the larger version of this change and
probably the right one.

**B. Keep the global, make it resettable.** An `ast.ResetFieldTypes()` a
long-lived host calls between documents. Cheap, and wrong: any `FieldType` held
across the reset — including one inside a cached `Schema` — silently changes
meaning. It trades a bound you can observe for corruption you cannot.

**C. Do nothing, document the ceiling.** Where it stands today. Honest, and
adequate while the only shipping caller is a CLI that exits.

A is the recommendation. C is the correct status until someone ships the LSP,
at which point A stops being optional.

## Order of work

1. Decide between struct-`FieldType` and threaded-registry, because that
   decision determines whether `String()` changes at all.
2. `ast`: the registry type, its methods, and `FieldTypeFromString` on it. Keep
   the base-type constants and `BaseFieldTypes()` — they are pinned to
   `spec/field-types.json` by `internal/ast/field_types_spec_test.go` and
   `tests/field-types-parity.test.ts`, and nothing about them changes.
3. `state.Schema` carries its registry; `Schema.Hash()` must cover it, or a
   cached schema from another registry passes `verifyInlineCachedSchema`
   (`converter.go:260`) while meaning something else.
4. `parser`, `lower`, `validate`, `emit`, `fnmeta` in that order.
5. `converter.go` entry points last — they are the API this is all for.

## Verification

- Two compiles in one process, of two files using disjoint composed types,
  must each see only their own. Today they share a registry and cannot.
- A `Schema` from registry A, passed to a compile on registry B, must be
  rejected rather than silently mistyped. This is the failure mode the whole
  change introduces, and it needs a test before the change lands.
- Compiling the same file 10,000 times in one process must not grow the
  registry past what one compile needs — the LSP-keystroke case, which today
  interns once and then hits the name cache, and must keep doing so.
- Every diagnostic naming a type must be unchanged, byte for byte. The type
  names in `spec/field-types.json` and the `%v`-formatted composed types are
  both asserted on; this change must be invisible in output.
- `pnpm run check:fieldtype` and `check:limits` must still pass, along with
  `field_types_spec_test.go` and `field-types-parity.test.ts` — the bare
  `FieldType` zero-value hazard, the `stateTypeNodes` bound, and the shared
  type vocabulary are all unaffected by where the registry lives.
