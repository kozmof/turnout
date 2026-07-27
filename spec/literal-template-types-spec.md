# Literal & Template Types Specification — Turn DSL

> Status: Implemented
> Scope: Turn DSL scalar literal types, literal unions, template literal types, typed construction, and `#case` scalar, template, and tuple pattern matching (destructuring, exhaustiveness, reachability, refinement) — plus their lowering to the canonical model and runtime execution.

This is the as-built specification for the literal & template type feature. It is the reference cited by code comments across the Go converter (`packages/go/converter`) and the TypeScript runtime (`packages/ts`). Section numbers are stable so those references stay valid.

Related specs: `pipe-if-case-it.md` (the `#case`/`#if`/`#pipe` local-expression forms this feature extends), `transform-fn-dsl-spec.md` (the transform method calls reused by construction/extraction), `convert-runtime-spec.md` (the canonical model and runtime), and `state-shape-spec.md` (the primitive `FieldType` layer). Cross-language conformance fixtures live in `spec/conformance/template-matching.json`.

## 1. Status

This document defines the implemented literal type and pattern matching model for Turnout.

The feature provides:

* scalar literal types
* literal unions
* template literal types
* typed construction of template values (constant folding and runtime string building)
* structural template matching and capture decoding
* match exhaustiveness checking
* unreachable-pattern detection
* type refinement inside match arms
* combined tuple/product patterns
* deterministic handling of overlapping patterns

Matching is statically decidable and uses no general-purpose regular expressions. See §32 for the implementation status, the concrete decisions made where this document left latitude, and the small set of deliberately deferred items.

---

# 2. Goals

The feature has five primary goals.

## 2.1 Represent constrained values as types

Turnout should allow a type to represent an exact value or a finite set of values.

```turn
type Status = "pending" | "running" | "done"
```

A value of type `Status` may contain only one of those three strings.

## 2.2 Represent structured strings as types

Turnout should allow string values whose internal structure is known statically.

```turn
type Kind = "foo" | "bar"

type ResourceId =
  "{kind: Kind}-{sequence: integer}"
```

Valid values include:

```text
foo-1
foo-42
bar-900
```

Invalid values include:

```text
baz-1
foo-x
foo-
```

## 2.3 Use types directly in pattern matching

A template literal type should support structural destructuring.

```turn
#case(
  resource_id,
  ResourceId { kind: "foo", sequence } => handle_foo(sequence),
  ResourceId { kind: "bar", sequence } => handle_bar(sequence)
)
```

## 2.4 Check pattern coverage statically

When the input type is finite or structurally analyzable, the converter should detect:

* missing cases
* unreachable cases
* duplicate cases
* fully shadowed patterns
* structurally ambiguous templates

## 2.5 Keep matching deterministic

Pattern matching remains ordered.

The first matching arm is selected.

```turn
#case(
  value,
  PatternA => result_a,
  PatternB => result_b
)
```

When both patterns match, `PatternA` wins.

The converter should still report suspicious overlap.

---

# 3. Non-goals

The first version does not provide a general regex type system.

The following features are outside the initial scope:

* arbitrary regular expressions
* backreferences
* lookahead and lookbehind
* recursive template types
* optional template regions
* repeated template regions
* arbitrary user-defined parsers
* dynamically generated type patterns
* runtime modification of template definitions
* proof of arbitrary guard expressions
* implicit greedy or non-greedy matching

These features may be considered later, but they must not define the semantic foundation.

---

# 4. Terminology

## 4.1 Literal value

A concrete compile-time value.

```turn
"foo"
42
true
```

## 4.2 Literal type

A type containing exactly one literal value.

```turn
type Foo = "foo"
```

## 4.3 Literal union

A finite union of literal types.

```turn
type Kind = "foo" | "bar"
```

## 4.4 Template literal type

A string type composed of static text and typed capture segments.

```turn
type ResourceId =
  "{kind: Kind}-{sequence: integer}"
```

## 4.5 Capture

A named segment inside a template literal type.

In:

```turn
"{kind: Kind}-{sequence: integer}"
```

the captures are:

* `kind`
* `sequence`

## 4.6 Pattern refinement

The narrowing of a value's type after a successful pattern match.

## 4.7 Coverage

The set of input values accepted by a pattern.

## 4.8 Exhaustive match

A match expression whose arms cover all possible values of its input type.

---

# 5. Type forms

## 5.1 Scalar literal types

Turnout supports string, number, integer, and boolean literal types.

```turn
type Foo = "foo"
type Answer = 42
type Enabled = true
```

A scalar literal type contains exactly one value.

```text
values(Foo) = {"foo"}
values(Answer) = {42}
values(Enabled) = {true}
```

## 5.2 Literal unions

Literal types may be combined using `|`.

```turn
type Kind = "foo" | "bar"
type Port = 80 | 443
type Toggle = true | false
```

A union represents the union of all member value sets.

```text
values(Kind) = {"foo", "bar"}
```

Duplicate members should be rejected or normalized.

Invalid:

```turn
type Kind = "foo" | "bar" | "foo"
```

Recommended diagnostic:

```text
duplicate union member "foo"
```

## 5.3 Mixed unions

The initial implementation should permit unions only when all members have a compatible base type.

Valid:

```turn
type StatusCode = 200 | 404 | 500
type Kind = "foo" | "bar"
```

Invalid:

```turn
type Mixed = "foo" | 42
```

Recommended diagnostic:

```text
literal union members must share a compatible base type
found string and integer
```

This restriction may be relaxed later if Turnout introduces explicit tagged unions.

## 5.4 Named aliases

A type may reference another named literal type.

```turn
type Kind = "foo" | "bar"
type ResourceKind = Kind
```

Aliases must preserve the original value set.

Cyclic aliases are invalid.

```turn
type A = B
type B = A
```

Recommended diagnostic:

```text
cyclic type alias:
A -> B -> A
```

---

# 6. Template literal types

## 6.1 Basic syntax

A template literal type is written as a quoted string containing static text and capture declarations.

```turn
type ResourceId =
  "{kind: Kind}-{sequence: integer}"
```

Each capture uses this form:

```text
{name: Type}
```

A template consists of:

* text segments
* capture segments

## 6.2 Inline literal unions

A capture may contain an inline literal union.

```turn
type ResourceId =
  "{kind: "foo" | "bar"}-{sequence: integer}"
```

For concise authoring, unquoted identifiers may optionally be interpreted as string literals only inside inline template unions:

```turn
type ResourceId =
  "{kind: foo | bar}-{sequence: integer}"
```

The canonical representation should normalize these values to quoted string literals.

Equivalent canonical form:

```turn
type ResourceId =
  "{kind: "foo" | "bar"}-{sequence: integer}"
```

Outside this restricted context, named types and string literals must remain distinguishable.

## 6.3 Supported capture types

The initial version should support:

* string literal
* number literal
* boolean literal
* literal union
* `str`
* `integer`
* `number`
* `bool`
* named literal type
* named template-compatible scalar type

Examples:

```turn
type Kind = "foo" | "bar"

type ResourceId =
  "{kind: Kind}-{sequence: integer}"

type BooleanKey =
  "enabled-{value: bool}"

type Version =
  "v{major: integer}.{minor: integer}"
```

## 6.4 Capture names

Capture names must be unique within a template.

Invalid:

```turn
type Pair =
  "{value: integer}-{value: integer}"
```

Recommended diagnostic:

```text
duplicate template capture name "value"
```

Capture names use the same identifier rules as Turnout fields and bindings.

## 6.5 Empty text segments

Empty text segments are allowed internally but should be normalized away.

For example:

```text
"" + capture + ""
```

should normalize to:

```text
capture
```

## 6.6 Empty templates

An empty template represents the empty string.

```turn
type Empty = ""
```

## 6.7 Static template types

A template with no captures is equivalent to a string literal type.

```turn
type FooA = "foo"
type FooB = "foo"
```

Both represent the same value set.

---

# 7. Template determinism

A template literal type must define a deterministic decoding from string to captured values.

## 7.1 Unique decoding requirement

For every accepted string, there must be at most one valid capture assignment.

Valid:

```turn
type ResourceId =
  "{kind: "foo" | "bar"}-{sequence: integer}"
```

The literal union constrains the first segment, while the separator and integer syntax identify the second segment.

Potentially ambiguous:

```turn
type Pair =
  "{left: str}-{right: str}"
```

For:

```text
a-b-c
```

possible decodings include:

```text
left = "a"
right = "b-c"
```

and:

```text
left = "a-b"
right = "c"
```

The initial version must reject this type.

Recommended diagnostic:

```text
ambiguous template literal type

the value "a-b-c" may be decoded in more than one way because
captures "left" and "right" are both unconstrained strings
```

## 7.2 Adjacent unconstrained captures

Adjacent unconstrained captures are invalid.

```turn
type Invalid =
  "{left: str}{right: str}"
```

No boundary exists between them.

## 7.3 Delimited string captures

A `str` capture may be accepted when its boundary is statically unambiguous.

Potentially valid:

```turn
type Namespaced =
  "{namespace: str}::{name: str}"
```

However, this is valid only if the language defines one of the following:

* the separator cannot appear inside either capture
* the capture type excludes the separator
* the decoder can prove a unique split

Until such exclusions exist in the type system, multiple unconstrained `str` captures should be rejected.

## 7.4 Numeric captures

Numeric captures are self-delimiting only when the surrounding structure makes decoding unique.

Valid:

```turn
type Coordinate =
  "{x: integer},{y: integer}"
```

Invalid or ambiguous numeric syntax should be rejected at value-validation time.

Examples of invalid integer segments:

```text
1.5
abc
+
```

## 7.5 No implicit greediness

Turnout must not use regex-style greedy or lazy behavior as part of the language semantics.

A template is either uniquely decodable or invalid.

---

# 8. Type membership

A value belongs to a literal type when it is one of the type's members.

```turn
type Status = "pending" | "done"
```

Membership:

```text
"pending" ∈ Status
"done" ∈ Status
"running" ∉ Status
```

A value belongs to a template literal type when:

1. its static text segments match,
2. every capture can be decoded,
3. every decoded value belongs to its capture type,
4. the decoding is unique.

Example:

```turn
type ResourceId =
  "{kind: "foo" | "bar"}-{sequence: integer}"
```

```text
"foo-10" ∈ ResourceId
"bar-2" ∈ ResourceId
"baz-10" ∉ ResourceId
"foo-x" ∉ ResourceId
```

---

# 9. Type subtyping

Literal and template types use value-set inclusion.

For types `A` and `B`:

```text
A <: B
```

when every value belonging to `A` also belongs to `B`.

## 9.1 Literal subtype

```turn
type Foo = "foo"
type Kind = "foo" | "bar"
```

Then:

```text
Foo <: Kind
Kind <: str
```

## 9.2 Union subtype

```turn
type PrimaryKind = "foo" | "bar"
type AnyKind = "foo" | "bar" | "baz"
```

Then:

```text
PrimaryKind <: AnyKind
```

## 9.3 Template subtype

```turn
type Kind = "foo" | "bar"

type ResourceId =
  "{kind: Kind}-{sequence: integer}"

type FooResourceId =
  "foo-{sequence: integer}"
```

Then:

```text
FooResourceId <: ResourceId
ResourceId <: str
```

## 9.4 Structural compatibility

Two independently declared template types may be equivalent if they accept exactly the same values.

```turn
type A = "{kind: "foo" | "bar"}-{id: integer}"
type B = "{category: "foo" | "bar"}-{value: integer}"
```

As string value sets:

```text
A == B
```

However, their capture structures differ by field name.

Turnout must distinguish:

* value-set equivalence
* capture-shape equivalence

This affects assignment and destructuring.

Recommended rule:

* plain string assignment may use value-set compatibility
* structural destructuring requires the declared capture shape or an explicit compatible conversion

---

# 10. Assignability

A value of type `A` may be assigned to type `B` when:

```text
A <: B
```

Valid:

```turn
type Foo = "foo"
type Kind = "foo" | "bar"

foo: Foo = "foo"
kind: Kind = foo
text: str = kind
```

Invalid:

```turn
text: str = get_external_value()
kind: Kind = text
```

A general `str` is wider than `Kind`.

Recommended diagnostic:

```text
cannot assign str to Kind

Kind accepts only:
- "foo"
- "bar"
```

Runtime validation may be requested explicitly through a conversion or match operation.

---

# 11. Template construction

## 11.1 Static construction

A literal string known to belong to a template type may be assigned directly.

```turn
resource_id: ResourceId = "foo-42"
```

The converter should validate this at compile time.

Invalid:

```turn
resource_id: ResourceId = "baz-42"
```

## 11.2 Typed interpolation

A template type may be constructed from typed variables.

```turn
kind: Kind = "foo"
sequence: integer = 42

resource_id: ResourceId =
  "{kind}-{sequence}"
```

The converter must verify that:

* every required capture is provided,
* every interpolated value is assignable to the capture type,
* static text matches the destination template,
* no unknown capture is provided.

## 11.3 Construction by type name

A more explicit construction form should be supported or reserved:

```turn
resource_id: ResourceId = ResourceId {
  kind = kind
  sequence = sequence
}
```

This form is preferable for canonical lowering because it does not require reparsing interpolation strings.

Recommended semantic model:

```turn
ResourceId {
  kind = "foo"
  sequence = 42
}
```

produces:

```text
foo-42
```

## 11.4 Invalid construction

```turn
kind: str = get_kind()
sequence: integer = 42

resource_id: ResourceId = ResourceId {
  kind = kind
  sequence = sequence
}
```

This is invalid because `str` is not assignable to `Kind`.

Recommended diagnostic:

```text
cannot construct ResourceId

capture "kind" requires Kind
received str
```

## 11.5 Missing capture

```turn
ResourceId {
  kind = "foo"
}
```

Recommended diagnostic:

```text
missing required capture "sequence" for ResourceId
```

## 11.6 Unknown capture

```turn
ResourceId {
  kind = "foo"
  sequence = 42
  region = "east"
}
```

Recommended diagnostic:

```text
unknown capture "region" for ResourceId
```

---

# 12. Pattern forms

The pattern matching system supports the following pattern categories.

## 12.1 Wildcard pattern

```turn
_
```

The wildcard matches every value and creates no binding.

## 12.2 Literal pattern

```turn
"foo"
42
true
```

A literal pattern matches only that exact value.

## 12.3 Binder pattern

```turn
value
```

A binder matches every value and binds the matched value to the given name.

A binder has the same coverage as `_`.

## 12.4 Typed binder pattern

```turn
value: Kind
```

A typed binder matches values belonging to `Kind` and binds the result.

Its exact syntax may be adjusted to avoid ambiguity with existing Turnout syntax.

## 12.5 Named type pattern

```turn
Kind
```

A named type pattern matches every value belonging to the named type.

Because this may be ambiguous with a binder, the canonical form should use an explicit type marker or structural form.

Possible explicit form:

```turn
:is Kind
```

or:

```turn
Kind {}
```

For the first implementation, named type matching may be limited to template destructuring and explicit annotations.

## 12.6 Template destructuring pattern

```turn
ResourceId {
  kind,
  sequence
}
```

This pattern:

* checks that the value belongs to `ResourceId`,
* decodes the value,
* binds `kind`,
* binds `sequence`.

## 12.7 Constrained capture pattern

A capture may itself contain a pattern.

```turn
ResourceId {
  kind: "foo",
  sequence
}
```

This matches only resource IDs whose `kind` capture is `"foo"`.

## 12.8 Ignored capture

A capture may be ignored.

```turn
ResourceId {
  kind: "foo",
  sequence: _
}
```

A shorthand may also be allowed:

```turn
ResourceId {
  kind: "foo"
}
```

Recommended rule:

Omitted fields are unconstrained and unbound.

Therefore:

```turn
ResourceId {
  kind: "foo"
}
```

matches any `ResourceId` with `kind = "foo"` regardless of `sequence`.

## 12.9 Nested patterns

When capture types later support structured non-string types, field patterns may nest recursively.

For the initial implementation, nesting is limited to:

* literals
* binders
* wildcard
* named literal types

---

# 13. `#case` semantics

## 13.1 Basic form

```turn
result = #case(
  input,
  pattern_1 => expression_1,
  pattern_2 => expression_2,
  _ => fallback
)
```

## 13.2 Evaluation order

Arms are evaluated from top to bottom.

The first arm whose pattern and guard succeed is selected.

No later arm is evaluated.

## 13.3 Pattern bindings

Bindings created by a pattern are visible only within:

* the arm guard
* the arm result expression

Example:

```turn
result = #case(
  resource_id,

  ResourceId {
    kind: "foo",
    sequence
  } if sequence > 100 =>
    handle_large_foo(sequence),

  ResourceId {
    kind: "foo",
    sequence
  } =>
    handle_foo(sequence)
)
```

`sequence` is not visible outside its arm.

## 13.4 Arm result type

All reachable arms must produce compatible result types.

```turn
result: str = #case(
  status,
  "pending" => "queue",
  "done" => "archive"
)
```

Invalid:

```turn
result = #case(
  status,
  "pending" => "queue",
  "done" => 42
)
```

unless Turnout explicitly supports a common union result type.

---

# 14. Exhaustiveness

## 14.1 Finite literal unions

A case over a finite literal union can be checked exactly.

```turn
type Status =
  "pending" | "running" | "done"
```

Exhaustive:

```turn
#case(
  status,
  "pending" => queue(),
  "running" => observe(),
  "done" => archive()
)
```

Non-exhaustive:

```turn
#case(
  status,
  "pending" => queue(),
  "done" => archive()
)
```

Recommended diagnostic:

```text
non-exhaustive match for Status

missing:
- "running"
```

## 14.2 Wildcard completion

A wildcard makes a match exhaustive.

```turn
#case(
  status,
  "pending" => queue(),
  _ => fallback()
)
```

## 14.3 Binder completion

An unconstrained binder also makes a match exhaustive.

```turn
#case(
  status,
  "pending" => queue(),
  other => handle(other)
)
```

## 14.4 Template exhaustiveness

A template type may be exhaustively matched through finite capture partitions.

```turn
type Kind = "foo" | "bar"

type ResourceId =
  "{kind: Kind}-{sequence: integer}"
```

Exhaustive:

```turn
#case(
  resource_id,

  ResourceId {
    kind: "foo",
    sequence
  } => handle_foo(sequence),

  ResourceId {
    kind: "bar",
    sequence
  } => handle_bar(sequence)
)
```

This is exhaustive because all possible `kind` values are covered and `sequence` is unconstrained in both arms.

## 14.5 Incomplete template match

```turn
#case(
  resource_id,

  ResourceId {
    kind: "foo",
    sequence
  } => handle_foo(sequence)
)
```

Recommended diagnostic:

```text
non-exhaustive match for ResourceId

uncovered values include:
ResourceId { kind: "bar", sequence: integer }
```

## 14.6 Infinite captures

Infinite capture domains such as `integer` do not prevent exhaustiveness when the pattern leaves them unconstrained.

```turn
ResourceId {
  kind: "foo",
  sequence
}
```

covers every integer `sequence` for `kind = "foo"`.

Exhaustiveness becomes undecidable or incomplete when an infinite capture is divided by arbitrary guards.

---

# 15. Guards

## 15.1 Guard syntax

A pattern arm may include a guard.

```turn
pattern if condition => result
```

Example:

```turn
#case(
  resource_id,

  ResourceId {
    kind: "foo",
    sequence
  } if sequence > 1000 =>
    handle_large(sequence),

  ResourceId {
    kind: "foo",
    sequence
  } =>
    handle_normal(sequence)
)
```

## 15.2 Guard coverage

A guarded arm does not normally provide complete static coverage of its underlying pattern.

```turn
ResourceId { kind: "foo", sequence }
  if sequence > 1000
```

does not cover every foo resource.

Therefore this is non-exhaustive:

```turn
#case(
  resource_id,

  ResourceId {
    kind: "foo",
    sequence
  } if sequence > 1000 =>
    handle_large(sequence),

  ResourceId {
    kind: "bar",
    sequence
  } =>
    handle_bar(sequence)
)
```

Uncovered values include foo resources whose sequence is at most 1000.

## 15.3 Statically provable guards

The first implementation should treat guards as opaque for exhaustiveness analysis.

Later versions may recognize a limited set of provable guard forms, such as:

```turn
sequence == 1
kind == "foo"
```

However, this must be a defined extension rather than implicit behavior.

---

# 16. Type refinement

## 16.1 Literal refinement

Given:

```turn
type Status = "pending" | "running" | "done"
```

inside:

```turn
"pending" => ...
```

the matched value has type:

```turn
"pending"
```

## 16.2 Remaining-type refinement

In an ordered case:

```turn
#case(
  status,
  "pending" => ...,
  remaining => ...
)
```

the type of `remaining` is:

```turn
"running" | "done"
```

## 16.3 Template capture refinement

Given:

```turn
type Kind = "foo" | "bar"

type ResourceId =
  "{kind: Kind}-{sequence: integer}"
```

inside:

```turn
ResourceId {
  kind: "foo",
  sequence
}
```

the inferred types are:

```text
kind: "foo"
sequence: integer
```

## 16.4 Remainder refinement across arms

```turn
#case(
  resource_id,

  ResourceId {
    kind: "foo",
    sequence
  } =>
    handle_foo(sequence),

  ResourceId {
    kind,
    sequence
  } =>
    handle_other(kind, sequence)
)
```

In the second arm:

```text
kind: "bar"
sequence: integer
```

because `"foo"` was completely handled by the preceding unguarded arm.

## 16.5 Guarded arms do not fully subtract coverage

```turn
#case(
  resource_id,

  ResourceId {
    kind: "foo",
    sequence
  } if sequence > 100 =>
    large(sequence),

  ResourceId {
    kind,
    sequence
  } =>
    fallback(kind, sequence)
)
```

In the second arm, `kind` remains:

```text
"foo" | "bar"
```

because the guarded first arm did not cover every `"foo"` value.

---

# 17. Overlap and reachability

## 17.1 Exact duplicate pattern

```turn
#case(
  status,
  "pending" => a(),
  "pending" => b()
)
```

The second arm is unreachable.

Recommended diagnostic:

```text
unreachable case arm

pattern "pending" is fully covered by a previous arm
```

## 17.2 Wildcard shadowing

```turn
#case(
  status,
  _ => fallback(),
  "done" => archive()
)
```

The second arm is unreachable.

## 17.3 Binder shadowing

```turn
#case(
  status,
  value => handle(value),
  "done" => archive()
)
```

The second arm is unreachable.

## 17.4 Template shadowing

```turn
#case(
  resource_id,

  ResourceId {
    kind,
    sequence
  } =>
    handle_all(kind, sequence),

  ResourceId {
    kind: "foo",
    sequence
  } =>
    handle_foo(sequence)
)
```

The second arm is unreachable.

## 17.5 Partial overlap

```turn
#case(
  resource_id,

  ResourceId {
    kind: "foo",
    sequence
  } if sequence > 100 =>
    large_foo(sequence),

  ResourceId {
    kind: "foo",
    sequence
  } =>
    foo(sequence)
)
```

This is valid.

The second arm handles values not accepted by the first arm's guard.

## 17.6 Structural overlap warning

Two patterns may overlap without one fully containing the other.

When statically detectable, the converter should report a warning.

Example conceptually:

```text
Pattern A accepts:
foo-*

Pattern B accepts:
*-1
```

The value:

```text
foo-1
```

matches both.

Because matching is ordered, runtime behavior is deterministic.

Recommended warning:

```text
overlapping patterns

this arm overlaps a previous arm for values including:
"foo-1"

the previous arm takes precedence
```

---

# 18. Pattern identity and capture names

Pattern coverage is based on accepted values, not binding names.

These patterns have identical coverage:

```turn
ResourceId { kind, sequence }
ResourceId { kind: category, sequence: id }
```

The binding names differ, but both accept every `ResourceId`.

Duplicate and reachability analysis must compare value coverage independently from local variable naming.

---

# 19. Runtime representation

Template literal types must be represented structurally in the canonical model.

They must not be represented only as regex strings.

Conceptual canonical representation:

```json
{
  "kind": "template",
  "name": "ResourceId",
  "segments": [
    {
      "kind": "capture",
      "name": "kind",
      "type": {
        "kind": "union",
        "members": [
          {
            "kind": "literal",
            "value_type": "string",
            "value": "foo"
          },
          {
            "kind": "literal",
            "value_type": "string",
            "value": "bar"
          }
        ]
      }
    },
    {
      "kind": "text",
      "value": "-"
    },
    {
      "kind": "capture",
      "name": "sequence",
      "type": {
        "kind": "primitive",
        "name": "integer"
      }
    }
  ]
}
```

## 19.1 Generated matcher

The converter or runtime may generate an optimized matcher.

Possible implementation strategies include:

* deterministic scanner
* generated finite-state machine
* parser combinator sequence
* anchored regex generated from the structured model

An internally generated regex is allowed as an implementation detail.

It must not become the semantic source of truth.

## 19.2 Match result

A successful template match returns:

```json
{
  "matched": true,
  "captures": {
    "kind": "foo",
    "sequence": 42
  }
}
```

A failed match returns:

```json
{
  "matched": false
}
```

Captures should use their decoded runtime types.

For example:

```text
sequence: integer
```

must be represented as an integer value, not the string `"42"`.

---

# 20. Static analysis model

The converter should model a pattern as a set or symbolic region of possible values.

## 20.1 Literal domains

Finite literal unions can be represented explicitly.

```text
{"pending", "running", "done"}
```

## 20.2 Template domains

A template domain can be represented as a product of capture domains plus static text.

Example:

```turn
ResourceId =
  "{kind: Kind}-{sequence: integer}"
```

Symbolically:

```text
ResourceId =
  Kind × integer
```

with string serialization:

```text
serialize(kind, sequence) =
  kind + "-" + decimal(sequence)
```

## 20.3 Pattern coverage

```turn
ResourceId {
  kind: "foo",
  sequence
}
```

covers:

```text
{"foo"} × integer
```

## 20.4 Pattern subtraction

After handling:

```text
{"foo"} × integer
```

from:

```text
{"foo", "bar"} × integer
```

the remainder is:

```text
{"bar"} × integer
```

This enables refinement and exhaustiveness checking.

## 20.5 Guards

Opaque guards should be represented as unknown subsets.

They must not be subtracted from the remaining domain for complete exhaustiveness reasoning.

---

# 21. Grammar

The exact parser grammar may differ, but the semantic grammar is as follows.

```ebnf
TypeDeclaration =
  "type" Identifier "=" TypeExpression ;

TypeExpression =
    PrimitiveType
  | LiteralType
  | UnionType
  | TemplateLiteralType
  | TypeIdentifier
  ;

PrimitiveType =
    "str"
  | "integer"
  | "number"
  | "bool"
  ;

LiteralType =
    StringLiteral
  | IntegerLiteral
  | NumberLiteral
  | BooleanLiteral
  ;

UnionType =
  TypeExpression "|" TypeExpression
  { "|" TypeExpression } ;

TemplateLiteralType =
  StringContainingTemplateSegments ;

TemplateSegment =
    StaticText
  | CaptureDeclaration
  ;

CaptureDeclaration =
  "{"
  Identifier
  ":"
  TypeExpression
  "}" ;

CaseExpression =
  "#case"
  "("
  Expression
  ","
  CaseArm
  { "," CaseArm }
  ")" ;

CaseArm =
  Pattern
  [ "if" Expression ]
  "=>"
  Expression ;

Pattern =
    WildcardPattern
  | LiteralPattern
  | BinderPattern
  | TypedBinderPattern
  | TemplatePattern
  ;

WildcardPattern =
  "_" ;

LiteralPattern =
  LiteralType ;

BinderPattern =
  Identifier ;

TypedBinderPattern =
  Identifier ":" TypeExpression ;

TemplatePattern =
  TypeIdentifier
  "{"
  [ FieldPattern { "," FieldPattern } ]
  "}" ;

FieldPattern =
  Identifier
  [ ":" Pattern ] ;
```

---

# 22. Canonical syntax recommendations

To minimize ambiguity, the preferred syntax is:

## Type definition

```turn
type Kind =
  "foo" | "bar"

type ResourceId =
  "{kind: Kind}-{sequence: integer}"
```

## Construction

```turn
resource_id: ResourceId = ResourceId {
  kind = "foo"
  sequence = 42
}
```

## Matching

```turn
result = #case(
  resource_id,

  ResourceId {
    kind: "foo",
    sequence
  } =>
    handle_foo(sequence),

  ResourceId {
    kind: "bar",
    sequence
  } =>
    handle_bar(sequence)
)
```

## Fallback

```turn
result = #case(
  input,
  ResourceId { kind, sequence } => handle(kind, sequence),
  _ => reject(input)
)
```

---

# 23. Diagnostics

Diagnostics should report both the declared type and the uncovered or conflicting symbolic region.

## 23.1 Invalid literal

```text
value "baz" is not assignable to Kind

Kind accepts:
- "foo"
- "bar"
```

## 23.2 Invalid template value

```text
value "foo-x" is not assignable to ResourceId

capture "sequence" requires integer
received "x"
```

## 23.3 Non-exhaustive literal match

```text
non-exhaustive match for Status

missing:
- "running"
```

## 23.4 Non-exhaustive template match

```text
non-exhaustive match for ResourceId

uncovered region:
ResourceId {
  kind: "bar",
  sequence: integer
}
```

## 23.5 Unreachable arm

```text
unreachable case arm

ResourceId {
  kind: "foo",
  sequence
}

is fully covered by an earlier arm
```

## 23.6 Ambiguous template

```text
ambiguous template literal type Pair

captures "left" and "right" cannot be uniquely separated in:
"{left: str}-{right: str}"
```

## 23.7 Invalid construction

```text
cannot construct ResourceId

capture "kind":
  expected Kind
  received str
```

---

# 24. Interaction with existing Turnout types

## 24.1 Primitive compatibility

Literal types are subtypes of their primitive base types.

```text
"foo" <: str
42 <: integer
true <: bool
```

## 24.2 Number and integer

An integer literal belongs to `integer`.

Whether it also belongs to `number` depends on Turnout's existing numeric type hierarchy.

Recommended relation:

```text
integer <: number
```

Therefore:

```text
42 <: integer <: number
```

## 24.3 Existing untyped values

A runtime value of broad type `str` is not implicitly narrowed to a literal or template type.

It must be validated through:

* a typed boundary
* a conversion
* a pattern match
* an explicit parser operation

## 24.4 External hook values

Values returned by prepare hooks may be broad runtime types.

Example:

```turn
prepare {
  resource_id {
    from_hook = "request_context"
  }
}
```

If the destination field expects `ResourceId`, runtime validation must occur before computation.

Failure should stop the action with a type-validation error.

---

# 25. Serialization and schema

Literal and template types should be preserved in the canonical schema.

The schema must represent:

* type declarations
* literal values
* unions
* template segments
* capture names
* capture types
* normalized static text
* optional precompiled matcher metadata
* source location for diagnostics

Generated matcher details should be versioned separately from the semantic template representation.

This prevents runtime implementation changes from altering model meaning.

---

# 26. Compatibility and migration

## 26.1 Existing `#case`

Existing literal, wildcard, binder, and guard behavior should remain valid.

The new implementation extends static validation.

Previously accepted non-exhaustive matches may become compile-time errors when their input type is finite and known.

A compatibility mode may initially downgrade these errors to warnings.

## 26.2 Existing string fields

Existing `str` fields remain unchanged.

Template literal types are opt-in.

## 26.3 Regex-like user logic

Existing user functions that validate structured strings can continue to operate.

They may later be replaced with template types when the structure fits the deterministic template model.

## 26.4 Canonical model version

Adding literal and template type nodes requires a canonical model version update.

Older runtimes should reject unsupported model versions explicitly rather than silently treating template values as plain strings.

---

# 27. Implementation phases

## Phase 1: Scalar literal types

Implement:

* string literal types
* integer and number literal types
* boolean literal types
* literal unions
* assignability
* finite-union exhaustiveness
* duplicate-pattern detection
* unreachable-pattern detection
* remaining-type refinement

Example:

```turn
type Status =
  "pending" | "running" | "done"
```

## Phase 2: Template parsing and validation

Implement:

* template type AST
* capture declarations
* supported capture types
* deterministic decoding validation
* direct literal membership checks
* canonical model serialization
* runtime matcher
* runtime capture decoding

Example:

```turn
type ResourceId =
  "{kind: Kind}-{sequence: integer}"
```

## Phase 3: Typed construction

Implement:

* constructor form
* capture type checking
* missing and unknown capture diagnostics
* serialization to string
* compile-time construction for constant values

Example:

```turn
ResourceId {
  kind = "foo"
  sequence = 42
}
```

## Phase 4: Template destructuring patterns

Implement:

* template pattern syntax
* field bindings
* literal-constrained fields
* omitted fields
* local type inference
* template exhaustiveness
* remainder refinement
* template shadowing detection

## Phase 5: Combined patterns

Implement:

* tuple patterns
* nested product-domain exhaustiveness
* template patterns inside tuples
* literal unions inside object or tuple patterns

Example:

```turn
#case(
  (resource_id, enabled),

  (
    ResourceId {
      kind: "foo",
      sequence
    },
    true
  ) =>
    run(sequence),

  _ =>
    stop()
)
```

## Phase 6: Advanced static analysis

Potential later features:

* limited guard reasoning
* explicit pattern intersection
* pattern subtraction visualization
* compile-time generated decision trees
* IDE pattern coverage display
* automated missing-arm generation

---

# 28. Required tests

## 28.1 Literal type tests

Test:

* valid assignment
* invalid assignment
* duplicate union member
* alias resolution
* cyclic alias rejection
* subtype assignment

## 28.2 Template parsing tests

Test:

* static text
* single capture
* multiple captures
* named capture type
* inline literal union
* duplicate capture names
* malformed capture syntax

## 28.3 Ambiguity tests

Test:

* adjacent `str` captures
* separated unconstrained captures
* numeric captures
* literal-union boundaries
* empty segments
* conflicting numeric formats

## 28.4 Runtime membership tests

Test:

* valid string
* invalid literal segment
* invalid integer segment
* missing segment
* extra segment
* negative integer
* leading zero policy
* Unicode static text
* Unicode capture values where allowed

## 28.5 Pattern tests

Test:

* literal match
* wildcard match
* binder match
* template destructuring
* constrained capture
* omitted capture
* failed decode
* first-match precedence

## 28.6 Exhaustiveness tests

Test:

* complete literal union
* missing literal
* wildcard completion
* binder completion
* complete template partition
* incomplete template partition
* guarded arm incompleteness
* remainder narrowing

## 28.7 Reachability tests

Test:

* duplicate literal
* wildcard shadowing
* binder shadowing
* full template shadowing
* partial overlap
* guarded previous arm
* equivalent patterns with different binder names

## 28.8 Cross-language conformance tests

The Go converter and TypeScript runtime must share fixtures for:

* accepted values
* rejected values
* decoded captures
* construction output
* selected match arm
* failure diagnostics

A fixture must produce the same semantic result in every implementation.

---

# 29. Design invariants

The implementation must preserve the following invariants.

## 29.1 Structured semantics

A template literal type is represented as structured segments, not only as regex text.

## 29.2 Unique decoding

Every accepted template value has one capture interpretation.

## 29.3 Ordered matching

The first matching arm wins.

## 29.4 Static coverage where decidable

The converter checks exhaustiveness and reachability when type domains are known.

## 29.5 Guard conservatism

Opaque guards do not count as complete static coverage.

## 29.6 Typed captures

Decoded captures use declared runtime types.

## 29.7 No implicit narrowing

A broad value such as `str` is not silently treated as a narrower literal or template type.

## 29.8 Stable canonical meaning

Runtime optimizations must not change the semantic interpretation of a template type.

---

# 30. Complete example

```turn
type Kind =
  "foo" | "bar"

type ResourceId =
  "{kind: Kind}-{sequence: integer}"

resource_id: ResourceId = ResourceId {
  kind = "foo"
  sequence = 120
}

result: str = #case(
  resource_id,

  ResourceId {
    kind: "foo",
    sequence
  } if sequence > 100 =>
    "large-foo",

  ResourceId {
    kind: "foo",
    sequence
  } =>
    "foo",

  ResourceId {
    kind: "bar",
    sequence
  } =>
    "bar"
)
```

Static conclusions:

```text
resource_id: ResourceId

first arm:
  kind: "foo"
  sequence: integer

second arm:
  kind: "foo"
  sequence: integer

third arm:
  kind: "bar"
  sequence: integer

match:
  exhaustive
```

Runtime result:

```text
large-foo
```

---

# 31. Summary

Turnout literal types define statically recognizable sets of values.

A literal type may be:

* an exact scalar value
* a finite union
* a structured template literal

Template literal types provide one shared definition for:

* validation
* construction
* serialization
* destructuring
* pattern matching
* type refinement
* exhaustiveness analysis
* domain documentation

Pattern matching remains ordered and deterministic.

The converter should statically detect:

* missing cases
* duplicate cases
* unreachable arms
* shadowed template regions
* ambiguous template definitions
* invalid constructions
* incompatible assignments

The core model is:

```text
literal type
  = set of valid values

template literal type
  = structured string value set
  + typed captures
  + deterministic serialization
  + deterministic decoding

pattern
  = subset of a type's value set

case analysis
  = ordered partitioning and refinement of that set
```

This model strengthens Turnout pattern matching without making arbitrary regular expressions part of the language type system.

---

# 32. Implementation status and decisions

This section records the as-built behaviour where the sections above left latitude, plus the small set of deferred items. It is normative for the current implementation.

## 32.1 Type representation

The structured type IR is `TypeExpr` in the canonical model (`schema/turnout-model.proto`): a `oneof` over `primitive`, `literal`, `union`, `template`, and `named` (§19). Named type declarations are carried on `TurnModel.type_decls`. The IR is a superset of the flat `FieldType` (`state-shape-spec.md`): every scalar `FieldType` has an equivalent primitive, and `integer` is tracked distinctly from `number` (§24.2), collapsing to `number` only when bridged to the flat runtime layer. `FieldType` remains the runtime carrier; the structured type is used for all literal/template reasoning.

## 32.2 Template determinism (§7)

The initial-version determinism rules are enforced exactly as: no two captures may be adjacent with no separator between them (§7.2), and an unconstrained `str` capture must be the final segment of the template so its extent is unambiguous (§7.1, §7.3). Numeric ambiguity is deferred to value-validation time (§7.4). A capture whose type resolves to a template is rejected (recursive templates are a non-goal, §3).

## 32.3 Template matching and capture decoding (§8, §19)

Matching is a deterministic left-to-right scan with no regex and no greediness. Because adjacent captures are rejected, every capture is either the final segment or is followed by static text; a bounded capture tries each boundary and accepts the unique split whose value is a valid member of the capture type. Decoded captures use their runtime types: `integer`/`number` → number, `bool` → boolean, `str`/string-literal → string. The reference implementation is the Go converter's `ast.TemplateMatch`; the TypeScript runtime mirror is `matchTemplate`. Both are exercised by the shared conformance fixtures (§28.8, `spec/conformance/template-matching.json`).

Numeric grammar (§28.4): an integer is `-?(0 | [1-9][0-9]*)` with no `-0`; a number additionally allows `.[0-9]+`. Leading zeros, a leading `+`, a trailing/leading `.`, and exponents are rejected.

## 32.4 Typed construction (§11)

Both construction forms are implemented:

* Constant construction (all field values are literals) is validated and **folded at compile time** to the serialized template string, then checked for membership (§11.3).
* Construction from variable references is **built at runtime**: it lowers to a `str_concat` chain, with numeric and boolean captures serialized via a `toStr` transform (`transform-fn-dsl-spec.md`). Field reference types are checked against capture types (§10, §24.2/§24.3 — a `number` reference is not assignable to an `integer` capture).

The `{name}` interpolation-string form of §11.2 is not a separate surface syntax; the constructor form `TypeName { field = value }` (§11.3, §22) is canonical and covers both cases.

## 32.5 `#case` template destructuring runtime (§12, §19)

A `#case` subject is typed as its template, so runtime membership is guaranteed; only capture extraction is required, and constraint checks and arm selection reuse the existing equality/boolean/conditional functions. Destructuring lowers to the same ordered `CondExpr` chain as a scalar `#case`:

* a literal-constrained field (`kind: "foo"`) becomes `eq(template_extract(subject, spec), "foo")`;
* a bound capture becomes `template_extract` (string), `template_extract_num` (number), or `eq(extract, "true")` (boolean), referenced by the arm body under a fresh alpha-renamed binding so multiple arms may bind the same capture name without collision.

`template_extract` / `template_extract_num` are built-in binary functions `(subject, spec) → value`; `spec` is a JSON descriptor of the fully-resolved template and the target capture, so the runtime needs no type registry. The structured pattern is preserved in the model's `ext_expr` for static analysis; static analysis is unaffected by the runtime lowering.

## 32.6 Static analysis (§14, §16, §17)

Finite-union `#case` exhaustiveness, duplicate/unreachable-arm detection, and remaining-type refinement are implemented for scalar subjects (§14.1–§14.3, §16.1–§16.2, §17.1–§17.3) and for template subjects via product-domain subtraction over the finite (literal-union) capture domains, with infinite captures unconstrained not blocking exhaustiveness (§14.4–§14.6, §16.3, §17.4). Guards are opaque: a guarded arm neither shadows later arms nor completes coverage (§15.2, §29.5). Capture refinement types each bound var-binder to its capture type inside the arm.

Combined tuple patterns use recursive product-domain analysis. Tuple subjects and patterns may nest, template patterns may appear in tuple positions, tuple arity is checked statically, and binders are refined from the corresponding tuple element. Finite scalar and template discriminants are combined for exhaustiveness and shadowing checks. Tuple cases lower to the same scalar equality, template extraction, boolean conjunction, and ordered conditional graph operations used by existing patterns.

## 32.7 Canonical model version (§26.4)

The canonical model version is **2**. A model that declares literal/template types or uses `template_extract` is emitted at version 2; older (version 1) runtimes reject it. The TypeScript runtime's current version is 2 with an identity migration from version 1.

## 32.8 Deferred items

The following are recognised but not yet implemented; each is an independent extension:

* Structural template equivalence for destructuring across independently-declared templates (§9.4) — plain-string value-set assignment is implemented; structural destructuring requires the declared capture shape.
* Provable guard reasoning (§15.3) — guards remain opaque.
* HCL re-emission renders a named binding's declared type name and `type` declaration blocks for inspection, but the HCL form is not re-parsed.
