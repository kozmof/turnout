package validate_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// typeDecls prepends type declarations to a minimal valid program and runs the
// full pipeline.
func typeDecls(decls string) diag.Diagnostics {
	return pipeline(decls + "\n" + min("        n:number = 42\n"))
}

func TestValidTypeDecls(t *testing.T) {
	ds := typeDecls(`
type Status = "pending" | "running" | "done"
type Port = 80 | 443
type Kind = "foo" | "bar"
type ResourceKind = Kind
type ResourceId = "{kind: Kind}-{sequence: integer}"
`)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestDuplicateUnionMember(t *testing.T) {
	ds := typeDecls(`type Kind = "foo" | "bar" | "foo"`)
	if !hasCode(ds, diag.CodeDuplicateUnionMember) {
		t.Errorf("expected DuplicateUnionMember, got %v", ds)
	}
}

func TestMixedUnionBase(t *testing.T) {
	ds := typeDecls(`type Mixed = "foo" | 42`)
	if !hasCode(ds, diag.CodeMixedUnionBase) {
		t.Errorf("expected MixedUnionBase, got %v", ds)
	}
}

func TestNumericUnionNotMixed(t *testing.T) {
	// integer and number share a compatible base.
	ds := typeDecls(`type N = 1 | 2 | 3`)
	if hasCode(ds, diag.CodeMixedUnionBase) {
		t.Errorf("integer-only union should not be mixed base: %v", ds)
	}
}

func TestUnknownTypeReference(t *testing.T) {
	ds := typeDecls(`type ResourceKind = DoesNotExist`)
	if !hasCode(ds, diag.CodeUnknownType) {
		t.Errorf("expected UnknownType, got %v", ds)
	}
}

func TestCyclicTypeAlias(t *testing.T) {
	ds := typeDecls(`
type A = B
type B = A
`)
	if !hasCode(ds, diag.CodeCyclicTypeAlias) {
		t.Errorf("expected CyclicTypeAlias, got %v", ds)
	}
}

func TestDuplicateTypeDecl(t *testing.T) {
	ds := typeDecls(`
type Kind = "foo"
type Kind = "bar"
`)
	if !hasCode(ds, diag.CodeDuplicateTypeDecl) {
		t.Errorf("expected DuplicateTypeDecl, got %v", ds)
	}
}

func TestAliasResolvesValueSet(t *testing.T) {
	// An alias to a union with a duplicate should still surface the duplicate on
	// the original declaration; the alias itself is valid.
	ds := typeDecls(`
type Kind = "foo" | "bar"
type ResourceKind = Kind
`)
	if ds.HasErrors() {
		t.Errorf("valid alias chain should not error: %v", ds)
	}
}

func TestTemplateDuplicateCaptureName(t *testing.T) {
	ds := typeDecls(`type Pair = "{value: integer}-{value: integer}"`)
	if !hasCode(ds, diag.CodeDuplicateCaptureName) {
		t.Errorf("expected DuplicateCaptureName, got %v", ds)
	}
}

func TestTemplateAdjacentCaptures(t *testing.T) {
	ds := typeDecls(`type Invalid = "{left: str}{right: str}"`)
	if !hasCode(ds, diag.CodeAmbiguousTemplate) {
		t.Errorf("expected AmbiguousTemplate for adjacent captures, got %v", ds)
	}
}

func TestTemplateMultipleUnconstrainedStr(t *testing.T) {
	ds := typeDecls(`type Pair = "{left: str}-{right: str}"`)
	if !hasCode(ds, diag.CodeAmbiguousTemplate) {
		t.Errorf("expected AmbiguousTemplate for non-terminal str, got %v", ds)
	}
}

func TestTemplateNamespacedRejected(t *testing.T) {
	ds := typeDecls(`type Namespaced = "{namespace: str}::{name: str}"`)
	if !hasCode(ds, diag.CodeAmbiguousTemplate) {
		t.Errorf("expected AmbiguousTemplate for two str captures, got %v", ds)
	}
}

func TestTemplateNumericCoordinateValid(t *testing.T) {
	ds := typeDecls(`type Coordinate = "{x: integer},{y: integer}"`)
	if ds.HasErrors() {
		t.Errorf("numeric captures separated by ',' should be valid: %v", ds)
	}
}

func TestTemplateTerminalStrValid(t *testing.T) {
	ds := typeDecls(`type Prefixed = "prefix-{s: str}"`)
	if ds.HasErrors() {
		t.Errorf("a terminal str capture should be valid: %v", ds)
	}
}

func TestTemplateCaptureTypeMustNotBeTemplate(t *testing.T) {
	ds := typeDecls(`
type Inner = "{a: integer}-{b: integer}"
type Outer = "{y: Inner}"
`)
	if !hasCode(ds, diag.CodeInvalidCaptureType) {
		t.Errorf("expected InvalidCaptureType for a template-typed capture, got %v", ds)
	}
}

func TestSelfReferentialTemplateRejected(t *testing.T) {
	// Recursive template types are a non-goal (§3); the reference cycle is caught.
	ds := typeDecls(`type A = "{x: A}"`)
	if !hasCode(ds, diag.CodeCyclicTypeAlias) {
		t.Errorf("expected CyclicTypeAlias for self-referential template, got %v", ds)
	}
}
