# Explicit transition priority

> Status: proposal, not implemented
> Origin: `tmp/NEW_SYNTAX.md` 4.1

## The problem

Selection is first-match, so which transition wins is decided entirely by the textual order of the `next` clauses in the source. Nothing names that ordering, so:

- the real semantics are carried by something invisible
- reordering two `next` clauses changes behaviour without changing any value a reviewer can point at, and the diff shows only moved lines
- neither ordering is wrong, so no diagnostic can flag a mistake

The chain is: source order → `repeated NextRuleModel next` order in the model → evaluation order at runtime. `next-rules.ts:190` breaks out of its loop on the first match in array order, and `NextRuleModel` (`schema/turnout-model.proto:229`) has no field that records intent.

The transition sugar added in 1.4 (`next scene_hotspot_found -> collect`) makes the clauses shorter and therefore easier to reorder casually, which raises the stakes slightly.

## The decision this proposal must make

There are two ways to give priority a name, and they differ in whether the wire model changes:

**A. Resolve to list order at emit time.** The DSL gains a priority annotation; the converter sorts the `next` list by it before emitting. `NextRuleModel` is untouched, the runtime is untouched, and the emitted model for an already-correct file is byte-identical. Priority becomes a source-level assertion about an ordering that still lives in the array.

**B. Add a `priority` field to `NextRuleModel`.** The ordering becomes explicit in the model, and the runtime sorts. This changes the proto and the TypeScript runtime, and every existing model gains a field.

**A is the recommended option**, because it keeps the guarantee that Phases 0–3 established — that this whole line of syntax work leaves `turnout-model.proto` and the runtime alone — while still removing the invisible-semantics problem at the level where authors work. B is only worth it if some consumer other than the converter needs to reason about priority, which nothing does today.

Whichever is chosen, the proposal must state it explicitly, because "explicit transition priority" reads as though it implies B.

## Sketch of the surface (option A)

```hcl
next scene_hotspot_found -> collect     priority 10
next interview_witness                  priority 20
```

Open questions for the proposal to settle:

- **Reading against the arrow.** The sugar now ends at the target action, so a trailing `priority` puts a second, unrelated clause after it and the line stops reading as one thought. Worth checking whether the annotation belongs before the guard, or in a form other than a trailing word, before committing to this surface.

- **Partial annotation.** If some clauses carry a priority and others do not, is that an error, or do unannotated clauses keep their relative textual order after the annotated ones? An error is simpler to explain and to diagnose.
- **Ties.** Two clauses with the same priority are exactly the ambiguity this feature exists to remove, so they should be an error rather than a silent fall back to textual order.
- **Direction.** Lower-number-first matches "priority 1" intuitions; the proposal should pick one and say so, since both conventions are common.

## Verification

- the emitted model for a file whose clauses are already in priority order must be unchanged, which is the check that proves option A is a no-op for correct files
- a file whose clauses are in the wrong textual order but carry correct priorities must emit the same model as the correctly ordered file
- ties and partial annotation must produce diagnostics with real positions
