# Separate ingress and egress namespaces

> Status: proposal, not implemented
> Origin: `tmp/NEW_SYNTAX.md` 4.2

## The problem

A prog has one namespace for binding names, so a value read from STATE and a value written back to STATE cannot share a name. Authors work around this with a suffix convention — `cost_in` / `cost_out`, `flagged_in` / `flagged_out` — which appears on nearly every egress binding in `spec/examples/`.

The suffix carries no meaning the compiler uses. It exists only to keep two names apart, and it makes the interesting part of the name harder to read.

## Why this was gated behind Phase 3

Inline IO changed how a binding name is read. Before v2:

```hcl
~>cost_in:number
<~cost_out:number = cost_in + fee
```

the name was the only place direction appeared, so the suffix was doing real work for a reader. After:

```hcl
cost_in:number  <~ @billing.cost
cost_out:number = cost_in + fee ~> @billing.cost
```

direction is on the line, pointing at a path, and the suffix is visibly redundant. That is the argument for the change, and it only became available once Phase 3 landed — which is why this was correctly sequenced last.

## The shape of the change

Allow a read and a write to share a name, resolving the collision by position:

```hcl
cost:number <~ @billing.cost
cost:number = cost + fee ~> @billing.cost   // reads the ingress `cost`
```

This is a scoping change, not a syntax change, and it is the genuinely hard part. The proposal must settle:

- **What a reference means after a rebind.** In the second line, `cost` on the right must mean the ingress value. Every subsequent reference must then mean the new one — i.e. bindings become sequential rather than a flat set. That is a real change to the prog's evaluation model, which is currently order-independent within a prog and topologically sorted at lowering.
- **Whether the compute graph can express it.** The lowered model has one binding per name. Two bindings named `cost` need distinct names in the graph, so the lowerer would generate them the way nested infix already generates temps — which means the emitted graph gains synthetic names where authors see one.
- **What the validator reports.** `DuplicateBinding` currently fires on exactly this shape. It would need to distinguish a legal rebind from a genuine duplicate, and the message for the illegal case has to stay clear.
- **Whether it is worth it.** The suffix convention is ugly but harmless, and the scoping change is not. An alternative worth pricing first: keep one namespace and let the *state path* carry the distinction, since inline IO already puts the path on the line — the suffix could simply be dropped from the egress name where no collision exists, with no language change at all.

That last option is the cheapest and should be evaluated before the scoping change is designed. A survey of `spec/examples/` would show how many `_out` suffixes exist only to avoid a collision that the author could have avoided by naming the binding after what it computes rather than after its direction.

## Verification

- migrating the examples to shared names must leave the emitted graph semantically identical, modulo the generated names for rebound bindings
- `DuplicateBinding` must still fire for a genuine duplicate — two bindings with the same name and no IO distinction between them
