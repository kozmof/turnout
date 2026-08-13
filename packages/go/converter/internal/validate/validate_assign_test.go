package validate_test

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// assignProg builds a program whose root binding is annotated with the given
// named type and initialised to the given literal RHS.
func assignProg(typeDecls, decl string) string {
	decl = strings.Replace(decl, " = ", " := ", 1)
	return typeDecls + `
state { app { score:number = 0 } }
scene "sc" {
  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        ` + decl + `
      }
    }
  }
}
`
}

func TestAssignValidLiteralToUnion(t *testing.T) {
	src := assignProg(`type Kind = "foo" | "bar"`, `k: Kind = "foo"`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestAssignInvalidLiteralToUnion(t *testing.T) {
	src := assignProg(`type Kind = "foo" | "bar"`, `k: Kind = "baz"`)
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeNotAssignable) {
		t.Errorf("expected NotAssignable, got %v", ds)
	}
	if !anyMsgContains(ds, "Kind") || !anyMsgContains(ds, `"foo"`) {
		t.Errorf("expected diagnostic to name Kind and list accepted values: %v", ds)
	}
}

func TestAssignValidScalarLiteral(t *testing.T) {
	src := assignProg(`type Answer = 42`, `a: Answer = 42`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestAssignInvalidScalarLiteral(t *testing.T) {
	src := assignProg(`type Answer = 42`, `a: Answer = 43`)
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeNotAssignable) {
		t.Errorf("expected NotAssignable for 43 vs Answer=42, got %v", ds)
	}
}

func TestAssignValidTemplateValue(t *testing.T) {
	src := assignProg(`
type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"`, `id: ResourceId = "foo-42"`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestAssignInvalidTemplateValue(t *testing.T) {
	src := assignProg(`
type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"`, `id: ResourceId = "baz-42"`)
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeInvalidTemplateValue) {
		t.Errorf("expected InvalidTemplateValue for baz-42, got %v", ds)
	}
}

func TestAssignInvalidTemplateSequence(t *testing.T) {
	src := assignProg(`
type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"`, `id: ResourceId = "foo-x"`)
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeInvalidTemplateValue) {
		t.Errorf("expected InvalidTemplateValue for foo-x, got %v", ds)
	}
}

func TestAssignSingleRefValid(t *testing.T) {
	// foo: Foo ("foo") assigned to k: Kind ("foo"|"bar") — Foo <: Kind.
	src := `
type Foo = "foo"
type Kind = "foo" | "bar"
state { app { score:number = 0 } }
scene "sc" {
  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        f: Foo = "foo"
        k: Kind := f
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

func TestAssignSingleRefInvalid(t *testing.T) {
	// A wide str binding is not assignable to a narrower Kind via single-ref.
	src := `
type Kind = "foo" | "bar"
state { app { score:number = 0 } }
scene "sc" {
  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        s: str = "foo"
        k: Kind := s
      }
    }
  }
}
`
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeNotAssignable) {
		t.Errorf("expected NotAssignable assigning str to Kind, got %v", ds)
	}
}

func TestAssignAliasChain(t *testing.T) {
	src := assignProg(`
type Kind = "foo" | "bar"
type ResourceKind = Kind`, `k: ResourceKind = "bar"`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error through alias chain: %s", d.Format())
		}
	}
}
