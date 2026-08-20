package validate_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

func tupleProgram(arms string) string {
	return `
type Kind = "foo" | "bar"
type Enabled = true | false
type ResourceId = "{kind: Kind}-{sequence: integer}"
state { app { score:number = 0 } }
scene "sc" {
  entry_action = a
  action "a" { compute "p" {
    rid: ResourceId = "foo-1"
    enabled: Enabled = true
    result:number := case((rid, enabled), ` + arms + `)
  } }
}`
}

func TestTupleTemplateCaseExhaustive(t *testing.T) {
	ds := pipeline(tupleProgram(`
      (ResourceId { kind: "foo", sequence }, _) -> sequence,
      (ResourceId { kind: "bar", sequence }, true) -> sequence,
      (ResourceId { kind: "bar", sequence: _ }, false) -> 0`))
	if ds.HasErrors() {
		t.Fatalf("unexpected tuple errors: %v", ds)
	}
}

func TestTupleTemplateCaseNonExhaustive(t *testing.T) {
	ds := pipeline(tupleProgram(`
      (ResourceId { kind: "foo", sequence }, _) -> sequence,
      (ResourceId { kind: "bar", sequence }, true) -> sequence`))
	if !hasCode(ds, diag.CodeNonExhaustiveMatch) {
		t.Fatalf("expected NonExhaustiveMatch, got %v", ds)
	}
}

func TestTuplePatternArityMismatch(t *testing.T) {
	ds := pipeline(tupleProgram(`(ResourceId { kind, sequence }) -> sequence`))
	if !hasCode(ds, diag.CodeArgTypeMismatch) {
		t.Fatalf("expected ArgTypeMismatch, got %v", ds)
	}
}

func TestTuplePatternUnreachable(t *testing.T) {
	ds := pipeline(tupleProgram(`
      (ResourceId { kind: "foo", sequence }, _) -> sequence,
      (ResourceId { kind: "foo", sequence }, true) -> sequence,
      (ResourceId { kind: "bar", sequence }, _) -> sequence`))
	if !hasCode(ds, diag.CodeUnreachableArm) {
		t.Fatalf("expected UnreachableArm, got %v", ds)
	}
}

func TestNestedTuplePattern(t *testing.T) {
	src := `
type Toggle = true | false
state { app { score:number = 0 } }
scene "sc" { entry_action = a action "a" { compute "p" {
  a: Toggle = true
  b: Toggle = false
  n: number = 3
  result:number := case(((a, b), n), ((true, false), value) -> value, _ -> 0)
} } }`
	if ds := pipeline(src); ds.HasErrors() {
		t.Fatalf("unexpected nested tuple errors: %v", ds)
	}
}

func TestTupleWholeBinderRejected(t *testing.T) {
	src := `state { app { score:number = 0 } }
scene "sc" { entry_action = a action "a" { compute "p" {
  a: bool = true
  b: number = 1
  result:number := case((a, b), both -> 1)
} } }`
	if ds := pipeline(src); !hasCode(ds, diag.CodeUnsupportedConstruct) {
		t.Fatalf("expected UnsupportedConstruct, got %v", ds)
	}
}

func TestTupleGuardMustBeBool(t *testing.T) {
	src := `state { app { score:number = 0 } }
scene "sc" { entry_action = a action "a" { compute "p" {
  a: bool = true
  b: number = 1
  result:number := case((a, b), (true, n) if n -> n, _ -> 0)
} } }`
	if ds := pipeline(src); !hasCode(ds, diag.CodeCondNotBool) {
		t.Fatalf("expected CondNotBool, got %v", ds)
	}
}
