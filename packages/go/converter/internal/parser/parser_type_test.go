package parser

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
)

// parseTypeDecls parses a source containing only type declarations plus a
// minimal state+scene so ParseFile succeeds, and returns the decls.
func parseTypeDecls(t *testing.T, decls string) []*ast.TypeDecl {
	t.Helper()
	src := decls + "\n" + minimalStateScene
	tf, ds := ParseFile("test.tu", src)
	if ds.HasErrors() {
		t.Fatalf("unexpected parse errors: %v", ds)
	}
	return tf.TypeDecls
}

const minimalStateScene = `
state {
  ns {
    x: number = 0
  }
}
scene "s" {
  action "a" {
    compute {
      prog "p" {
        out: number := 1
      }
    }
  }
}
`

func TestParseScalarLiteralTypes(t *testing.T) {
	decls := parseTypeDecls(t, `
type Foo = "foo"
type Answer = 42
type Enabled = true
`)
	if len(decls) != 3 {
		t.Fatalf("expected 3 decls, got %d", len(decls))
	}
	if decls[0].Name != "Foo" || decls[0].Type.String() != `"foo"` {
		t.Errorf("Foo = %s", decls[0].Type)
	}
	if decls[1].Type.String() != "42" {
		t.Errorf("Answer = %s", decls[1].Type)
	}
	if decls[2].Type.String() != "true" {
		t.Errorf("Enabled = %s", decls[2].Type)
	}
}

func TestParseUnionType(t *testing.T) {
	decls := parseTypeDecls(t, `type Kind = "foo" | "bar"`)
	u, ok := decls[0].Type.(*ast.UnionType)
	if !ok {
		t.Fatalf("expected UnionType, got %T", decls[0].Type)
	}
	if len(u.Members) != 2 || u.String() != `"foo" | "bar"` {
		t.Errorf("union = %s", u)
	}
}

func TestParseAliasAndPrimitive(t *testing.T) {
	decls := parseTypeDecls(t, `
type Kind = "foo" | "bar"
type ResourceKind = Kind
type Name = str
`)
	if _, ok := decls[1].Type.(*ast.NamedType); !ok {
		t.Errorf("ResourceKind should be NamedType, got %T", decls[1].Type)
	}
	pt, ok := decls[2].Type.(*ast.PrimitiveType)
	if !ok || pt.Kind != ast.PrimStr {
		t.Errorf("Name should be str primitive, got %T %v", decls[2].Type, decls[2].Type)
	}
}

func TestParseTemplateType(t *testing.T) {
	decls := parseTypeDecls(t, `
type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"
`)
	tmpl, ok := decls[1].Type.(*ast.TemplateType)
	if !ok {
		t.Fatalf("expected TemplateType, got %T", decls[1].Type)
	}
	caps := tmpl.Captures()
	if len(caps) != 2 {
		t.Fatalf("expected 2 captures, got %d", len(caps))
	}
	if caps[0].Name != "kind" {
		t.Errorf("capture 0 name = %q", caps[0].Name)
	}
	if _, ok := caps[0].CaptureType.(*ast.NamedType); !ok {
		t.Errorf("kind capture type = %T, want NamedType", caps[0].CaptureType)
	}
	if caps[1].Name != "sequence" {
		t.Errorf("capture 1 name = %q", caps[1].Name)
	}
	pt, ok := caps[1].CaptureType.(*ast.PrimitiveType)
	if !ok || pt.Kind != ast.PrimInteger {
		t.Errorf("sequence capture type = %v, want integer", caps[1].CaptureType)
	}
	if tmpl.String() != `"{kind: Kind}-{sequence: integer}"` {
		t.Errorf("template String() = %s", tmpl.String())
	}
}

func TestParseTemplateConstruction(t *testing.T) {
	src := `
type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"
state { ns { x: number = 0 } }
scene "s" {
  action "a" {
    compute {
      prog "p" {
        id: ResourceId := ResourceId {
          kind = "foo"
          sequence = 42
        }
      }
    }
  }
}
`
	tf, ds := ParseFile("test.tu", src)
	if ds.HasErrors() {
		t.Fatalf("unexpected parse errors: %v", ds)
	}
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	tc, ok := b.RHS.(*ast.TemplateConstructionRHS)
	if !ok {
		t.Fatalf("expected TemplateConstructionRHS, got %T", b.RHS)
	}
	if tc.TypeName != "ResourceId" || len(tc.Fields) != 2 {
		t.Fatalf("construction = %q with %d fields", tc.TypeName, len(tc.Fields))
	}
	if tc.Fields[0].Name != "kind" || tc.Fields[1].Name != "sequence" {
		t.Errorf("field names = %q, %q", tc.Fields[0].Name, tc.Fields[1].Name)
	}
}

func TestParseTemplateDestructurePattern(t *testing.T) {
	src := `
type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"
state { ns { x: number = 0 } }
scene "s" {
  action "a" {
    compute {
      prog "p" {
        rid: ResourceId = "foo-1"
        r: number := case(
          rid,
          ResourceId { kind: "foo", sequence } => sequence,
          ResourceId { kind, sequence: _ } => 0
        )
      }
    }
  }
}
`
	tf, ds := ParseFile("test.tu", src)
	if ds.HasErrors() {
		t.Fatalf("unexpected parse errors: %v", ds)
	}
	caseRHS := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[1].RHS.(*ast.CaseCallRHS)
	arm0 := caseRHS.Arms[0]
	tp, ok := arm0.Pattern.(*ast.TemplateCasePattern)
	if !ok {
		t.Fatalf("arm0 pattern = %T, want TemplateCasePattern", arm0.Pattern)
	}
	if tp.TypeName != "ResourceId" || len(tp.Fields) != 2 {
		t.Fatalf("pattern = %q with %d fields", tp.TypeName, len(tp.Fields))
	}
	// field 0: kind: "foo" (literal constraint)
	if _, ok := tp.Fields[0].Sub.(*ast.LiteralCasePattern); !ok {
		t.Errorf("kind field sub = %T, want LiteralCasePattern", tp.Fields[0].Sub)
	}
	// field 1: sequence (shorthand bind)
	if vb, ok := tp.Fields[1].Sub.(*ast.VarBinderPattern); !ok || vb.Name != "sequence" {
		t.Errorf("sequence field sub = %T, want VarBinderPattern(sequence)", tp.Fields[1].Sub)
	}
	// arm1 field 1: sequence: _ (wildcard/ignore)
	arm1tp := caseRHS.Arms[1].Pattern.(*ast.TemplateCasePattern)
	if _, ok := arm1tp.Fields[1].Sub.(*ast.WildcardCasePattern); !ok {
		t.Errorf("sequence: _ sub = %T, want WildcardCasePattern", arm1tp.Fields[1].Sub)
	}
}

func TestParseTemplateInlineUnion(t *testing.T) {
	decls := parseTypeDecls(t, `type ResourceId = "{kind: foo | bar}-{sequence: integer}"`)
	tmpl := decls[0].Type.(*ast.TemplateType)
	caps := tmpl.Captures()
	u, ok := caps[0].CaptureType.(*ast.UnionType)
	if !ok {
		t.Fatalf("kind capture should be UnionType, got %T", caps[0].CaptureType)
	}
	// unquoted identifiers normalize to string literals (§6.2)
	if u.String() != `"foo" | "bar"` {
		t.Errorf("inline union normalized to %s, want %q", u, `"foo" | "bar"`)
	}
}
