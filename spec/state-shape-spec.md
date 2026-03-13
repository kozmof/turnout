# State Shape Specification

> **Status**: Draft for implementation
> **Scope**: Declaration of the STATE object in Turn DSL and its canonical HCL shape, including type system, namespace structure, initialization, runtime model, and validation rules

---

## Overview

STATE (`S_n`) is the shared mutable store that persists values across action executions within a scene. Actions read from STATE through `prepare` and write back through `merge`, using dotted paths such as `applicant.income` or `decision.approved`.

STATE is declared **independently of any action**, either at the top level of the same Turn DSL file as `scene`, or in a dedicated file referenced by `state_file`. This separation makes STATE the single authoritative source for the type contract that all actions must satisfy: the declared field types are **type constraints** enforced at convert time against every action's `merge` bindings.

This spec defines:

1. How STATE is declared in Turn DSL surface syntax (the top-level `state` block).
2. How the converter lowers a `state` block to canonical HCL.
3. The canonical HCL shape for STATE.
4. The type system and its role as the authoritative type constraint for actions.
5. The runtime TypeScript model for STATE.
6. Validation rules applied before first execution.
7. Integration constraints with `prepare` and `merge`.
8. Error catalogue.

---

## 1. Concepts

### 1.1 Namespace and field

STATE is a two-level map. Every leaf value lives at a **dotted path** of exactly two segments:

```
<namespace>.<field>
```

- **Namespace** (`ns`) — top-level grouping key. Example: `applicant`, `decision`.
- **Field** (`field`) — leaf key within a namespace. Example: `income`, `approved`.

Paths with more than two segments or fewer than two segments are not valid STATE paths under this spec.

```
applicant.income    # valid: namespace=applicant, field=income
decision.approved   # valid: namespace=decision,  field=approved
income              # invalid: single-segment path
a.b.c               # invalid: three-segment path
```

> **Note**: Support for deeper nesting may be added in a future revision. All current Turn DSL examples use exactly two-segment paths.

### 1.2 Immutable snapshot

At the start of each action execution the runtime takes an immutable snapshot `S_n`. The prepare phase reads from `S_n`. The merge phase writes a delta `D_n` atomically to produce `S_{n+1}`. Subsequent actions see `S_{n+1}`.

### 1.3 STATE as a type constraint

The `state` block is the single source of truth for the type of every STATE field. The type declared for a field is an authoritative **type constraint** on all values that any action may write to that field via `merge`. No action may write a value of a different type to a STATE field, and this is verified at convert time rather than at runtime.

---

## 2. Turn DSL Surface Syntax

A `state` block is declared at the **top level** of a Turn DSL file, independently of and before any `scene` block. It groups STATE fields by namespace using nested blocks.

```hcl
state {
  applicant {
    income:int = 0
    debt:int   = 0
  }
  decision {
    approved:bool     = false
    input_income:int  = 0
    status:str        = ""
    code:str          = ""
    reason:str        = ""
  }
}

scene "loan_flow" {
  entry_actions = ["score"]
  next_policy   = "first-match"

  action "score" { ... }
  action "approve" { ... }
  action "reject" { ... }
}
```

### 2.1 Grammar

```
turn-file       ::= state-source scene-block
state-source    ::= state-block | state-file-directive
state-block     ::= 'state' '{' namespace-decl* '}'
state-file-directive ::= 'state_file' '=' string-literal
namespace-decl  ::= IDENT '{' field-decl* '}'
field-decl      ::= IDENT ':' type '=' literal
type            ::= 'int' | 'str' | 'bool' | 'arr<int>' | 'arr<str>' | 'arr<bool>'
literal         ::= number | string | boolean | array-literal
IDENT           ::= [A-Za-z_][A-Za-z0-9_]*
```

A Turn DSL file MUST contain exactly one `state-source` (either an inline `state` block or a `state_file` directive, not both) and exactly one `scene` block.

### 2.2 Default values

Every field declaration requires an explicit default value. The default value is used to initialize STATE before any action runs. The type of the literal must match the declared type:

| Type       | Valid default literal examples         |
|------------|----------------------------------------|
| `int`      | `0`, `42`, `-10`                       |
| `str`      | `""`, `"pending"`                      |
| `bool`     | `false`, `true`                        |
| `arr<int>` | `[]`                                   |
| `arr<str>` | `[]`                                   |
| `arr<bool>`| `[]`                                   |

### 2.3 Uniqueness rules

- Namespace labels must be unique within a `state` block. Duplicate namespace labels are an error (`DuplicateStateNamespace`).
- Field names must be unique within a namespace block. Duplicate field names within one namespace are an error (`DuplicateStateField`).

### 2.4 Separate state file (`state_file`)

When STATE is shared across multiple scenes or maintained independently, a Turn DSL file MAY reference an external state file instead of declaring an inline `state` block:

```hcl
state_file = "loan.state.hcl"

scene "loan_flow" {
  entry_actions = ["score"]
  next_policy   = "first-match"

  action "score" { ... }
}
```

The referenced file MUST contain exactly one top-level `state { ... }` block and nothing else (no `scene` block, no `state_file` directive). The converter reads and parses this file at convert time as if its `state` block had been inlined.

Rules:
- `state_file` and `state { ... }` are mutually exclusive. Providing both is an error (`ConflictingStateSource`).
- The path in `state_file` is resolved relative to the Turn DSL file that declares it.
- A state file MUST be a valid Turn DSL `state` block source; parse errors in the state file abort conversion (`StateFileParseError`).
- If the referenced file does not exist, the converter aborts with `StateFileMissing`.

---

## 3. Canonical HCL Shape

The Go converter lowers the Turn DSL `state` block to the following canonical HCL structure, emitted at the top level of the HCL file alongside the `scene` block:

```hcl
state {
  namespace "applicant" {
    field "income" {
      type  = "int"
      value = 0
    }
    field "debt" {
      type  = "int"
      value = 0
    }
  }
  namespace "decision" {
    field "approved" {
      type  = "bool"
      value = false
    }
    field "input_income" {
      type  = "int"
      value = 0
    }
    field "status" {
      type  = "str"
      value = ""
    }
    field "code" {
      type  = "str"
      value = ""
    }
    field "reason" {
      type  = "str"
      value = ""
    }
  }
}
```

### 3.1 Lowering rules

| Turn DSL surface construct        | Canonical HCL output                                                   |
|-----------------------------------|------------------------------------------------------------------------|
| Namespace block `applicant { }` | `namespace "applicant" { }` block                                      |
| Field `income:int = 0`            | `field "income" { type = "int" value = 0 }` block                     |
| Field `approved:bool = false`     | `field "approved" { type = "bool" value = false }` block              |
| Field `status:str = ""`           | `field "status" { type = "str" value = "" }` block                    |
| Array field `tags:arr<str> = []`  | `field "tags" { type = "arr<str>" value = [] }` block                 |

When the DSL uses `state_file`, the converter reads and lowers the referenced file's `state` block using identical lowering rules; the result is indistinguishable from an inline `state` block.

### 3.2 Attribute schema per `field` block

| Attribute | Type   | Required | Description                                           |
|-----------|--------|----------|-------------------------------------------------------|
| `type`    | string | yes      | One of: `"int"`, `"str"`, `"bool"`, `"arr<int>"`, `"arr<str>"`, `"arr<bool>"` |
| `value`   | literal| yes      | Default value; must be type-compatible                |

---

## 4. Type System

STATE fields share the same primitive type set as HCL ContextSpec bindings (per `hcl-context-spec.md`):

| STATE type  | Runtime JS type | Default zero value |
|-------------|----------------|--------------------|
| `int`       | `number`       | `0`                |
| `str`       | `string`       | `""`               |
| `bool`      | `boolean`      | `false`            |
| `arr<int>`  | `number[]`     | `[]`               |
| `arr<str>`  | `string[]`     | `[]`               |
| `arr<bool>` | `boolean[]`    | `[]`               |

### 4.1 Type constraints on actions

The `type` declared for each STATE field is the **authoritative type constraint** for that field. All actions that write to a field via `merge` must produce a value of the matching type. The converter verifies this at convert time:

- For every `merge` binding targeting a STATE field, the type of the source binding in `compute.prog` must match the declared `type` of the target STATE field.
- A mismatch is a convert-time error (`StateTypeMismatch`).
- No runtime coercion occurs; the declared type is final.

This constraint is checked across all actions simultaneously. The STATE `state` block is the single source of truth; individual action bindings do not override or re-declare field types.

### 4.2 Type coercion

No implicit coercion occurs between STATE types. A `merge` binding writing a `str` value to a STATE field declared as `int` is a type error (`StateTypeMismatch`).

### 4.3 Integer division advisory

When a `div` compute binding (`int / int`) writes to an `int` STATE field, the result may be a float. The field receives the float value; no floor coercion is applied automatically. This is consistent with the `div` advisory in `convert-runtime-spec.md` §Resolved Decisions.

---

## 5. Path Resolution

### 5.1 Dotted path grammar

```
dotted-path  ::= namespace '.' field
namespace    ::= IDENT
field        ::= IDENT
IDENT        ::= [A-Za-z_][A-Za-z0-9_]*
```

A dotted path is valid if and only if:
- It contains exactly one `.` separator.
- Both the namespace segment and the field segment match `IDENT`.
- Neither segment is empty.

### 5.2 Declared vs. undeclared paths

- `from_state` and `to_state` values reference STATE fields by dotted path.
- All referenced paths must be declared in the `state` block at convert time (`UnresolvedStatePath`).
- The runtime must reject attempts to read from or write to undeclared STATE paths.

### 5.3 Type compatibility at merge

When the converter emits a `merge` binding entry, it must verify that the type of the source compute binding matches the type of the destination STATE field. Type mismatch is a convert-time error (`StateTypeMismatch`).

---

## 6. Runtime Data Model

The TypeScript runtime represents STATE as a flat map keyed by dotted path:

```ts
type StateKey   = string; // validated dotted path, e.g. "applicant.income"
type StateValue = number | string | boolean | number[] | string[] | boolean[];

type StateSnapshot = Readonly<Record<StateKey, StateValue>>;

type StateDelta = Record<StateKey, StateValue>;

type StateSchema = {
  fields: Record<StateKey, StateFieldMeta>;
};

type StateFieldMeta = {
  type:         "int" | "str" | "bool" | "arr<int>" | "arr<str>" | "arr<bool>";
  defaultValue: StateValue;
};
```

### 6.1 Initialization

Before the first entry action runs, the runtime initializes `S_0` from the `state` block defaults:

```
S_0 = { path → field.value  for each field declared in state }
```

Every declared field is present in `S_0`. No field is absent after initialization.

### 6.2 Snapshot semantics

`S_n` is captured as an immutable snapshot at the start of each action. The snapshot MUST NOT reflect any merge delta applied during the current action's execution (`S_{n+1}` is only visible to subsequent actions or transition `fromSsot` reads, per `scene-graph.md §7`).

### 6.3 Merge semantics

`D_n` is applied atomically using `replace-by-id` merge: each key in `D_n` replaces the corresponding key in `S_n`; keys absent from `D_n` are unchanged. The result is `S_{n+1}`.

```
S_{n+1} = { ...S_n, ...D_n }
```

---

## 7. HCL File Layout

The `state` block and `scene` block are co-located in the same HCL file emitted by the converter. The `state` block appears before the `scene` block. This layout is identical whether the DSL used an inline `state` block or a `state_file` directive; the converter always inlines the resolved state before emitting.

```hcl
state {
  namespace "applicant" {
    field "income" { type = "int"  value = 0 }
    field "debt"   { type = "int"  value = 0 }
  }
  namespace "decision" {
    field "approved"     { type = "bool" value = false }
    field "input_income" { type = "int"  value = 0     }
    field "status"       { type = "str"  value = ""    }
    field "code"         { type = "str"  value = ""    }
    field "reason"       { type = "str"  value = ""    }
  }
}

scene "loan_flow" {
  entry_actions = ["score"]
  next_policy   = "first-match"

  action "score" { ... }
  action "approve" { ... }
  action "reject" { ... }
}
```

One HCL file MUST contain exactly one `state` block and exactly one `scene` block.

---

## 8. Validation Rules

Before first action execution, the runtime MUST validate the STATE schema:

1. The HCL file contains exactly one `state` block (`MissingStateBlock` / `DuplicateStateBlock`).
2. Each `namespace` block has a unique label (`DuplicateStateNamespace`).
3. Each `field` block within a namespace has a unique name (`DuplicateStateField`).
4. Each `field` block has both `type` and `value` attributes (`MissingStateFieldAttr`).
5. The `type` attribute is one of the six valid type strings (`InvalidStateFieldType`).
6. The `value` literal is type-compatible with the declared `type` (`StateFieldDefaultTypeMismatch`).
7. Every dotted path referenced in `prepare.from_state` or `merge.to_state` across all actions is declared in the `state` block (`UnresolvedStatePath`).
8. The type of each `merge.to_state` target matches the type of the source binding in `compute.prog` across **all** actions (`StateTypeMismatch`).

At convert time, the Go CLI additionally validates:

9. The Turn DSL file contains exactly one `state-source` (`MissingStateSource` / `ConflictingStateSource`).
10. If `state_file` is used, the referenced file exists (`StateFileMissing`) and parses as a valid `state` block (`StateFileParseError`).

Validation failures MUST set run status to `invalid_graph` and prevent execution.

---

## 9. CAN / CAN'T Rules

### CAN (OK)

- A `state` block can be declared at the top level of a Turn DSL file, independently of `scene`.
- A `state_file` directive can reference an external file containing a standalone `state` block, allowing STATE to be shared across multiple Turn DSL files.
- A `state` block can declare zero or more namespaces; an empty `state` block is valid for pure-compute scenes with no STATE I/O.
- A namespace can contain zero or more fields.
- The same namespace label can appear in multiple `from_state` and `to_state` references across different actions.
- A STATE field can be both a `from_state` source in one action's `prepare` and a `to_state` destination in another action's `merge`.
- A `<~>` bidirectional binding can read from one STATE path in `prepare` and write to a different STATE path in `merge`.
- `S_0` initialization uses the declared `value` defaults for all fields.
- The runtime can initialize `S_0` before the first entry action fires; no STATE path can be absent after initialization.
- The converter can check type constraints across all actions simultaneously against the single `state` block declaration.

### CAN'T (NG)

- A `state` block cannot be declared inside a `scene` or `action` block; it must be top-level.
- A Turn DSL file cannot declare both an inline `state` block and a `state_file` directive (`ConflictingStateSource`).
- A `state_file` cannot contain a `scene` block or another `state_file` directive; it must contain only a `state` block.
- A `state` block cannot declare a path with more than two segments (e.g. `a.b.c` is not a valid namespace/field pair in this spec).
- A `state` block cannot declare a path with fewer than two segments (single-segment identifiers are not valid STATE paths).
- A field cannot be declared without both `type` and `value`.
- A `from_state` or `to_state` path cannot reference an undeclared field.
- An action compute graph cannot write to STATE directly during execution; all STATE writes must go through the `merge` step.
- A transition compute program cannot write to STATE (no `<~` or `<~>` sigils in transition `prog` blocks).
- The runtime cannot accept a partial `state` block (missing `type` or `value`) without emitting a validation error.
- A `state` block cannot contain duplicate namespace labels or duplicate field names within one namespace.
- An action's `merge` binding cannot write a value of a type different from the target STATE field's declared type; this is a convert-time type constraint error (`StateTypeMismatch`).

---

## 10. Error Catalogue

| Error code                     | Trigger condition                                                                                          |
|--------------------------------|------------------------------------------------------------------------------------------------------------|
| `MissingStateSource`           | The Turn DSL file contains neither an inline `state` block nor a `state_file` directive                   |
| `ConflictingStateSource`       | The Turn DSL file contains both an inline `state` block and a `state_file` directive                      |
| `StateFileMissing`             | The file path in `state_file` does not exist                                                               |
| `StateFileParseError`          | The file referenced by `state_file` fails to parse as a valid `state` block                               |
| `MissingStateBlock`            | The emitted HCL file contains no `state` block                                                             |
| `DuplicateStateBlock`          | The emitted HCL file contains more than one `state` block                                                  |
| `DuplicateStateNamespace`      | Two `namespace` blocks in one `state` block share the same label                                           |
| `DuplicateStateField`          | Two `field` blocks within one namespace share the same name                                                |
| `MissingStateFieldAttr`        | A `field` block is missing `type` or `value`                                                               |
| `InvalidStateFieldType`        | `type` is not one of `"int"`, `"str"`, `"bool"`, `"arr<int>"`, `"arr<str>"`, `"arr<bool>"`                |
| `StateFieldDefaultTypeMismatch`| The `value` literal is not type-compatible with the declared `type`                                        |
| `UnresolvedStatePath`          | A `from_state` or `to_state` path references a namespace or field not declared in the `state` block        |
| `StateTypeMismatch`            | The type of a `merge` source binding does not match the declared type of the target STATE field            |
| `InvalidStatePath`             | A `from_state` or `to_state` value is not a valid two-segment dotted identifier path                       |

---

## 11. Complete Example

### 11.1 Inline `state` block (single file)

**Turn DSL source:**

```hcl
state {
  applicant {
    income:int = 0
    debt:int   = 0
  }
  decision {
    approved:bool     = false
    input_income:int  = 0
    status:str        = ""
    code:str          = ""
    reason:str        = ""
  }
}

scene "loan_flow" {
  entry_actions = ["score"]
  next_policy   = "first-match"

  action "score" {
    compute {
      root = decision
      prog "score_graph" {
        <~>income:int   = _
        ~>debt:int      = _
        min_income:int  = 50000
        max_debt:int    = 20000
        income_ok:bool  = income >= min_income
        debt_ok:bool    = debt <= max_debt
        <~decision:bool = income_ok & debt_ok
      }
    }
    prepare {
      income { from_state = applicant.income }
      debt   { from_state = applicant.debt   }
    }
    merge {
      income   { to_state = decision.input_income }
      decision { to_state = decision.approved     }
    }
  }

  action "approve" {
    compute {
      root = approval_code
      prog "approve_graph" {
        prefix:str          = "APR-"
        suffix:str          = "0001"
        <~approval_code:str = prefix + suffix
        <~status:str        = "approved"
      }
    }
    merge {
      status        { to_state = decision.status }
      approval_code { to_state = decision.code   }
    }
  }

  action "reject" {
    compute {
      root = reason
      prog "reject_graph" {
        <~reason:str = "risk_threshold_not_met"
        <~status:str = "rejected"
      }
    }
    merge {
      status { to_state = decision.status }
      reason { to_state = decision.reason }
    }
  }
}
```

### 11.2 Separate state file

**`loan.state.hcl`:**

```hcl
state {
  applicant {
    income:int = 0
    debt:int   = 0
  }
  decision {
    approved:bool     = false
    input_income:int  = 0
    status:str        = ""
    code:str          = ""
    reason:str        = ""
  }
}
```

**`loan_flow.hcl`:**

```hcl
state_file = "loan.state.hcl"

scene "loan_flow" {
  entry_actions = ["score"]
  next_policy   = "first-match"

  action "score" { ... }
  action "approve" { ... }
  action "reject" { ... }
}
```

The converter resolves `loan.state.hcl` at convert time and produces canonical HCL identical to the inline case.

### 11.3 Emitted canonical HCL (both cases)

```hcl
state {
  namespace "applicant" {
    field "income" {
      type  = "int"
      value = 0
    }
    field "debt" {
      type  = "int"
      value = 0
    }
  }
  namespace "decision" {
    field "approved" {
      type  = "bool"
      value = false
    }
    field "input_income" {
      type  = "int"
      value = 0
    }
    field "status" {
      type  = "str"
      value = ""
    }
    field "code" {
      type  = "str"
      value = ""
    }
    field "reason" {
      type  = "str"
      value = ""
    }
  }
}

scene "loan_flow" {
  entry_actions = ["score"]
  next_policy   = "first-match"

  action "score" {
    compute {
      root = "decision"
      prog "score_graph" {
        binding "income" {
          type  = "int"
          value = 0
        }
        binding "debt" {
          type  = "int"
          value = 0
        }
        binding "min_income" {
          type  = "int"
          value = 50000
        }
        binding "max_debt" {
          type  = "int"
          value = 20000
        }
        binding "income_ok" {
          type = "bool"
          expr = { combine = { fn = "gte" args = [{ ref = "income" }, { ref = "min_income" }] } }
        }
        binding "debt_ok" {
          type = "bool"
          expr = { combine = { fn = "lte" args = [{ ref = "debt" }, { ref = "max_debt" }] } }
        }
        binding "decision" {
          type = "bool"
          expr = { combine = { fn = "bool_and" args = [{ ref = "income_ok" }, { ref = "debt_ok" }] } }
        }
      }
    }
    prepare {
      binding "income" { from_state = "applicant.income" }
      binding "debt"   { from_state = "applicant.debt"   }
    }
    merge {
      binding "income"   { to_state = "decision.input_income" }
      binding "decision" { to_state = "decision.approved"     }
    }
  }

  action "approve" {
    compute {
      root = "approval_code"
      prog "approve_graph" {
        binding "prefix" {
          type  = "str"
          value = "APR-"
        }
        binding "suffix" {
          type  = "str"
          value = "0001"
        }
        binding "approval_code" {
          type = "str"
          expr = { combine = { fn = "str_concat" args = [{ ref = "prefix" }, { ref = "suffix" }] } }
        }
        binding "status" {
          type  = "str"
          value = "approved"
        }
      }
    }
    merge {
      binding "status"        { to_state = "decision.status" }
      binding "approval_code" { to_state = "decision.code"   }
    }
  }

  action "reject" {
    compute {
      root = "reason"
      prog "reject_graph" {
        binding "reason" {
          type  = "str"
          value = "risk_threshold_not_met"
        }
        binding "status" {
          type  = "str"
          value = "rejected"
        }
      }
    }
    merge {
      binding "status" { to_state = "decision.status" }
      binding "reason" { to_state = "decision.reason" }
    }
  }
}
```

**Runtime `S_0` after initialization:**

```json
{
  "applicant.income":    0,
  "applicant.debt":      0,
  "decision.approved":   false,
  "decision.input_income": 0,
  "decision.status":     "",
  "decision.code":       "",
  "decision.reason":     ""
}
```

---

## 12. Test Plan

### Domain categories

| Domain | Coverage target |
|--------|----------------|
| A. STATE block parsing | All namespace and field forms parse correctly; empty `state` block is valid |
| B. Lowering | Each DSL namespace/field lowered to canonical `namespace`/`field` HCL blocks |
| B2. Top-level placement | `state` block at DSL top level lowers to canonical HCL top-level block identical to inline-in-scene form |
| B3. `state_file` resolution | `state_file` directive loads and inlines referenced file; emitted HCL is identical to inline form |
| C. Initialization | `S_0` contains all declared fields at their default values before first action |
| D. Path resolution | `from_state` and `to_state` paths validated against declared schema at convert time |
| E. Type constraint checking | `StateTypeMismatch` emitted when `merge` source type ≠ STATE field type for any action; checked across all actions in one pass |
| F. Error paths | All error codes trigger correctly and abort without partial HCL output |
| G. Merge semantics | `D_n` writes only declared paths; undeclared paths in STATE unchanged |
| H. Snapshot isolation | `S_n` snapshot used for `prepare`; `S_{n+1}` visible only after merge completes |

### Critical paths (idempotency)

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | Turn DSL `state` block (top-level) → canonical HCL `state` block | Re-lower identical DSL source; emitted HCL is byte-identical |
| 2 | `state_file` directive → same canonical HCL as inline form | Convert both forms from same state content; assert byte-identical HCL |
| 3 | `S_0` initialization from declared defaults | Initialize twice from same schema; assert identical `S_0` maps |
| 4 | `from_state` path resolves from `S_n` snapshot | Same `S_n` input → identical resolved value both runs |
| 5 | `D_n` atomic merge → `S_{n+1}` | Same `D_n` + same `S_n` → identical `S_{n+1}` |
| 6 | Undeclared STATE path rejected at convert time | Same DSL with missing namespace → same `UnresolvedStatePath` error |
| 7 | Type constraint check over all actions | Same DSL with mismatched merge type → same `StateTypeMismatch` error, same action and binding identified |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| `state { }` with no namespace blocks | Valid; `S_0 = {}` |
| Namespace block with no field declarations | Valid; namespace contributes nothing to `S_0` |
| `state_file` references a missing file | `StateFileMissing` at convert time |
| `state_file` references a file with a `scene` block | `StateFileParseError` at convert time |
| Both `state { }` and `state_file` in one DSL file | `ConflictingStateSource` at convert time |
| Neither `state { }` nor `state_file` in DSL file | `MissingStateSource` at convert time |
| `from_state = "applicant.unknown"` where `unknown` not in schema | `UnresolvedStatePath` at convert time |
| `to_state = "decision.approved"` with source binding type `str`, STATE field type `bool` | `StateTypeMismatch` at convert time |
| Two actions both writing to `decision.status`; one writes `str` (correct), one writes `int` | `StateTypeMismatch` on the `int`-writing action at convert time; error identifies the offending action and binding |
| Two `namespace "decision" {}` blocks in one `state` block | `DuplicateStateNamespace` |
| Field declared twice within one namespace | `DuplicateStateField` |
| `from_state = "applicant"` (single segment) | `InvalidStatePath` |
| `from_state = "a.b.c"` (three segments) | `InvalidStatePath` |
| `field "income" { type = "int" }` with no `value` | `MissingStateFieldAttr` |
| HCL file with no `state` block | `MissingStateBlock` |
| HCL file with two `state` blocks | `DuplicateStateBlock` |
| `<~>income` reads from `applicant.income`, writes to `decision.input_income` | Both paths must be declared; types must match source binding type |
| `state_file` path is absolute | Converter resolves it as-is (absolute path) |
