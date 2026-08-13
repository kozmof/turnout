# Separate ingress and egress namespaces

> Status: resolved — no language change
> Origin: `tmp/NEW_SYNTAX.md` 4.2

## Decision

Keep one order-independent binding namespace. Binding names remain unique within
a `prog`, forward references remain valid, and every repeated name continues to
produce `DuplicateBinding`, regardless of IO direction.

Inline IO already carries direction and the STATE path on the binding line. When
an input and output represent different values, authors should name them for
what they mean or compute rather than append `_in` or `_out`.

```hcl
cost:number <~ @billing.cost
total_cost:number = cost + fee ~> @billing.cost
```

For a value that is read and written unchanged, the existing bidirectional form
uses one binding without rebinding:

```hcl
cost:number <~ @billing.cost ~> @billing.cost
```

## Evidence

A survey of all seven files in `spec/examples/` found directional suffixes only
in `kitchen-sink-support-pipeline.tu`: eight `_out` declarations and four `_in`
transition declarations. None required a shared surface name. Each output could
use a collision-free semantic name, and each transition input could use the
name of the value it receives because transition progs have their own scopes.

The examples have been migrated accordingly. No compiler or runtime behavior is
needed to support the intended authoring style.

## Rejected alternative

Allowing a later output declaration to shadow an earlier input would make name
resolution depend on source position. That would conflict with the documented
order-independent, forward-reference model and require synthetic lowered names,
position-aware type/reference resolution, special IO validation, emitter
round-trip rules, and runtime name-map changes. The example survey does not
justify that semantic and implementation cost.

## Invariants

- Binding declarations remain order-independent and may reference bindings
  declared later in the same `prog`.
- A binding name is declared at most once per `prog`; violations produce
  `DuplicateBinding`.
- `prepare`, `merge`, action roots, transition conditions, and `from_action`
  references continue to address the single binding namespace.
