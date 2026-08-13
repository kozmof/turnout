package validate_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// destructureProg builds a case that destructures a ResourceId template subject.
func destructureProg(rootType, arms string) string {
	return `
type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"
state { app { score:number = 0 } }
scene "sc" {
  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        rid: ResourceId = "foo-1"
        r: ` + rootType + ` := case(
          rid,
          ` + arms + `
        )
      }
    }
  }
}
`
}

// A valid, exhaustive template case now compiles cleanly (destructuring is
// executable at runtime — see the e2e test).
func TestDestructureCompilesClean(t *testing.T) {
	ds := pipeline(destructureProg("number",
		`ResourceId { kind: "foo", sequence } => sequence, ResourceId { kind: "bar", sequence } => sequence`))
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestDestructureExhaustive(t *testing.T) {
	ds := pipeline(destructureProg("number",
		`ResourceId { kind: "foo", sequence } => sequence, ResourceId { kind: "bar", sequence } => sequence`))
	if hasCode(ds, diag.CodeNonExhaustiveMatch) {
		t.Errorf("covering foo and bar should be exhaustive: %v", ds)
	}
	if hasCode(ds, diag.CodeUnreachableArm) {
		t.Errorf("no arm should be unreachable: %v", ds)
	}
}

func TestDestructureNonExhaustive(t *testing.T) {
	ds := pipeline(destructureProg("number",
		`ResourceId { kind: "foo", sequence } => sequence`))
	if !hasCode(ds, diag.CodeNonExhaustiveMatch) {
		t.Errorf("expected NonExhaustiveMatch (bar uncovered), got %v", ds)
	}
	if !anyMsgContains(ds, `"bar"`) {
		t.Errorf("expected uncovered region to mention bar: %v", ds)
	}
}

func TestDestructureOmittedCaptureExhaustive(t *testing.T) {
	// Omitting `sequence` leaves it unconstrained (§12.8); covering both kinds is
	// still exhaustive.
	ds := pipeline(destructureProg("number",
		`ResourceId { kind: "foo" } => 1, ResourceId { kind: "bar" } => 2`))
	if hasCode(ds, diag.CodeNonExhaustiveMatch) {
		t.Errorf("omitted sequence + both kinds should be exhaustive: %v", ds)
	}
}

func TestDestructureWildcardCompletes(t *testing.T) {
	ds := pipeline(destructureProg("number",
		`ResourceId { kind: "foo", sequence } => sequence, _ => 0`))
	if hasCode(ds, diag.CodeNonExhaustiveMatch) {
		t.Errorf("wildcard should complete the match: %v", ds)
	}
}

func TestDestructureShadowing(t *testing.T) {
	// The first arm binds kind unconstrained (covers all); the second is shadowed.
	ds := pipeline(destructureProg("number",
		`ResourceId { kind, sequence } => sequence, ResourceId { kind: "foo", sequence } => sequence`))
	if !hasCode(ds, diag.CodeUnreachableArm) {
		t.Errorf("expected UnreachableArm for the shadowed foo arm, got %v", ds)
	}
}

func TestDestructureUnknownCapture(t *testing.T) {
	ds := pipeline(destructureProg("number",
		`ResourceId { kind: "foo", bogus } => 0, ResourceId { kind: "bar" } => 1`))
	if !hasCode(ds, diag.CodeUnknownCapture) {
		t.Errorf("expected UnknownCapture for bogus, got %v", ds)
	}
}

func TestDestructureConstraintNotAssignable(t *testing.T) {
	ds := pipeline(destructureProg("number",
		`ResourceId { kind: "baz", sequence } => sequence, ResourceId { kind: "bar", sequence } => sequence`))
	if !hasCode(ds, diag.CodeNotAssignable) {
		t.Errorf("expected NotAssignable for kind: baz, got %v", ds)
	}
}

func TestDestructureCaptureRefinementTyped(t *testing.T) {
	// sequence refines to a number; using it in a numeric context must type-check
	// (no arg/return mismatch beyond the runtime gate).
	ds := pipeline(destructureProg("number",
		`ResourceId { kind: "foo", sequence } => add(sequence, 1), ResourceId { kind: "bar", sequence } => sequence`))
	if hasCode(ds, diag.CodeArgTypeMismatch) || hasCode(ds, diag.CodeUndefinedRef) ||
		hasCode(ds, diag.CodeReturnTypeMismatch) {
		t.Errorf("refined sequence should be a usable number: %v", ds)
	}
}

func TestDestructureNonTemplateSubject(t *testing.T) {
	// Destructuring a non-template subject is a type error.
	src := `
state { app { score:number = 0 } }
scene "sc" {
  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        s: str = "x"
        r: number := case(s, ResourceId { kind: "foo", sequence } => sequence)
      }
    }
  }
}
`
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeArgTypeMismatch) {
		t.Errorf("expected a type error destructuring a non-template subject, got %v", ds)
	}
}

func TestDestructureRejectsDifferentTemplateTypeName(t *testing.T) {
	src := `
type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"
type OtherId = "{kind: Kind}/{sequence: integer}"
state { app { score:number = 0 } }
scene "sc" {
  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        rid: ResourceId = "foo-1"
        r: number := case(rid, OtherId { kind, sequence } => sequence)
      }
    }
  }
}
`
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeArgTypeMismatch) {
		t.Errorf("expected a type error for a mismatched template pattern name, got %v", ds)
	}
	if !anyMsgContains(ds, "template pattern OtherId does not match subject type ResourceId") {
		t.Errorf("expected diagnostic to name both template types, got %v", ds)
	}
}
