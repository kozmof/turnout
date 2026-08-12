package validate_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// constructProg builds a program whose root binding constructs a template value.
func constructProg(rootDecl string) string {
	return `
type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"
state { app { score:number = 0 } }
scene "sc" {
  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        |^| ` + rootDecl + `
      }
    }
  }
}
`
}

func TestConstructValid(t *testing.T) {
	ds := pipeline(constructProg(`id: ResourceId = ResourceId { kind = "foo" sequence = 42 }`))
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestConstructMissingCapture(t *testing.T) {
	ds := pipeline(constructProg(`id: ResourceId = ResourceId { kind = "foo" }`))
	if !hasCode(ds, diag.CodeMissingCapture) {
		t.Errorf("expected MissingCapture, got %v", ds)
	}
	if !anyMsgContains(ds, "sequence") {
		t.Errorf("expected diagnostic to name missing capture sequence: %v", ds)
	}
}

func TestConstructUnknownCapture(t *testing.T) {
	ds := pipeline(constructProg(`id: ResourceId = ResourceId { kind = "foo" sequence = 42 region = "east" }`))
	if !hasCode(ds, diag.CodeUnknownCapture) {
		t.Errorf("expected UnknownCapture, got %v", ds)
	}
}

func TestConstructBadCaptureValue(t *testing.T) {
	ds := pipeline(constructProg(`id: ResourceId = ResourceId { kind = "baz" sequence = 42 }`))
	if !hasCode(ds, diag.CodeNotAssignable) {
		t.Errorf("expected NotAssignable for kind=baz, got %v", ds)
	}
	if hasCode(ds, diag.CodeMissingCapture) {
		t.Errorf("a provided-but-invalid capture must not also be reported missing: %v", ds)
	}
}

func TestConstructNonIntegerSequence(t *testing.T) {
	ds := pipeline(constructProg(`id: ResourceId = ResourceId { kind = "foo" sequence = 1.5 }`))
	if !hasCode(ds, diag.CodeNotAssignable) {
		t.Errorf("expected NotAssignable for sequence=1.5, got %v", ds)
	}
}

func TestConstructNonTemplateType(t *testing.T) {
	ds := pipeline(constructProg(`k: Kind = Kind { x = 1 }`))
	if !hasCode(ds, diag.CodeUnsupportedConstruct) {
		t.Errorf("expected UnsupportedConstruct for constructing a non-template, got %v", ds)
	}
}

func TestConstructUnknownType(t *testing.T) {
	ds := pipeline(constructProg(`z: str = Bogus { x = 1 }`))
	if !hasCode(ds, diag.CodeUnknownType) {
		t.Errorf("expected UnknownType, got %v", ds)
	}
}

func TestConstructFromVariableValid(t *testing.T) {
	// A construction from typed variable references is valid and lowers to a
	// runtime string build.
	src := `
type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"
state { app { score:number = 0 } }
scene "sc" {
  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        k: Kind = "foo"
        n: integer = 7
        |^| id: ResourceId = ResourceId { kind = k sequence = n }
      }
    }
  }
}
`
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestConstructFromVariableTypeMismatch(t *testing.T) {
	// A number reference is not assignable to an integer capture (§24.2).
	src := `
type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"
state { app { score:number = 0 } }
scene "sc" {
  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        n: number = 7
        |^| id: ResourceId = ResourceId { kind = "foo" sequence = n }
      }
    }
  }
}
`
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeNotAssignable) {
		t.Errorf("expected NotAssignable for number ref to integer capture, got %v", ds)
	}
}
