package lower

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

func testTemplate() *ast.TemplateType {
	kind := ast.NewUnionType(ast.Pos{}, []ast.Type{
		ast.NewLiteralType(ast.Pos{}, ast.NewStringLiteral(ast.Pos{}, "foo")),
		ast.NewLiteralType(ast.Pos{}, ast.NewStringLiteral(ast.Pos{}, "bar")),
	})
	return ast.NewTemplateType(ast.Pos{}, []ast.TemplateSegment{
		&ast.CaptureSegment{Name: "kind", CaptureType: kind},
		&ast.TextSegment{Value: "-"},
		&ast.CaptureSegment{Name: "sequence", CaptureType: ast.NewPrimitiveType(ast.Pos{}, ast.PrimInteger)},
	})
}

func TestFoldConstructionConstantAndErrors(t *testing.T) {
	tmpl := testTemplate()
	lookup := func(name string) (ast.Type, bool) {
		if name == "ResourceId" {
			return tmpl, true
		}
		if name == "Kind" {
			return ast.NewPrimitiveType(ast.Pos{}, ast.PrimStr), true
		}
		return nil, false
	}
	refType := func(name string) (ast.Type, bool) { return nil, false }
	valid := &ast.TemplateConstructionRHS{TypeName: "ResourceId", Fields: []ast.ConstructionField{
		{Name: "kind", Value: &ast.LitArg{Value: ast.NewStringLiteral(ast.Pos{}, "foo")}},
		{Name: "sequence", Value: &ast.LitArg{Value: ast.NewNumberLiteral(ast.Pos{}, 42)}},
	}}
	var ds diag.DiagSink
	got, constant, ok := foldConstruction(valid, lookup, refType, &ds)
	if !ok || !constant || got != "foo-42" || ds.HasErrors() {
		t.Fatalf("fold = %q, %v, %v; diags=%v", got, constant, ok, ds.Flush())
	}

	cases := []struct {
		name string
		tc   *ast.TemplateConstructionRHS
	}{
		{"unknown type", &ast.TemplateConstructionRHS{TypeName: "Missing"}},
		{"non-template", &ast.TemplateConstructionRHS{TypeName: "Kind"}},
		{"missing", &ast.TemplateConstructionRHS{TypeName: "ResourceId", Fields: []ast.ConstructionField{{Name: "kind", Value: &ast.LitArg{Value: ast.NewStringLiteral(ast.Pos{}, "foo")}}}}},
		{"unknown capture", &ast.TemplateConstructionRHS{TypeName: "ResourceId", Fields: []ast.ConstructionField{{Name: "kind", Value: &ast.LitArg{Value: ast.NewStringLiteral(ast.Pos{}, "foo")}}, {Name: "sequence", Value: &ast.LitArg{Value: ast.NewNumberLiteral(ast.Pos{}, 1)}}, {Name: "extra", Value: &ast.LitArg{Value: ast.NewStringLiteral(ast.Pos{}, "x")}}}}},
		{"not assignable", &ast.TemplateConstructionRHS{TypeName: "ResourceId", Fields: []ast.ConstructionField{{Name: "kind", Value: &ast.LitArg{Value: ast.NewStringLiteral(ast.Pos{}, "baz")}}, {Name: "sequence", Value: &ast.LitArg{Value: ast.NewNumberLiteral(ast.Pos{}, 1)}}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var sink diag.DiagSink
			if _, _, ok := foldConstruction(tc.tc, lookup, refType, &sink); ok || !sink.HasErrors() {
				t.Fatalf("expected error")
			}
		})
	}
}

func TestFoldConstructionDynamic(t *testing.T) {
	tmpl := testTemplate()
	lookup := func(name string) (ast.Type, bool) { return tmpl, name == "ResourceId" }
	refType := func(name string) (ast.Type, bool) {
		switch name {
		case "kind":
			return tmpl.Captures()[0].CaptureType, true
		case "seq":
			return ast.NewPrimitiveType(ast.Pos{}, ast.PrimInteger), true
		}
		return nil, false
	}
	tc := &ast.TemplateConstructionRHS{TypeName: "ResourceId", Fields: []ast.ConstructionField{{Name: "kind", Value: &ast.RefArg{Name: "kind"}}, {Name: "sequence", Value: &ast.RefArg{Name: "seq"}}}}
	var ds diag.DiagSink
	_, constant, ok := foldConstruction(tc, lookup, refType, &ds)
	if !ok || constant || tc.Resolved != tmpl || ds.HasErrors() {
		t.Fatalf("dynamic construction not resolved")
	}
}

func TestTemplateLoweringHelpers(t *testing.T) {
	tmpl := testTemplate()
	if got := templateSegsJSON(tmpl); got == "" {
		t.Fatal("empty segments")
	}
	if got := templateSpecJSON("[]", "x"); got != `{"want":"x","segs":[]}` {
		t.Fatalf("spec=%s", got)
	}
	for _, tc := range []struct {
		lit  ast.Literal
		want string
	}{
		{ast.NewStringLiteral(ast.Pos{}, "x"), "x"}, {ast.NewNumberLiteral(ast.Pos{}, 2), "2"}, {ast.NewNumberLiteral(ast.Pos{}, 2.5), "2.5"}, {&ast.BoolLiteral{Value: true}, "true"},
	} {
		if got := renderConstant(tc.lit); got != tc.want {
			t.Errorf("render=%q want %q", got, tc.want)
		}
	}
	if got := substituteRefs(&ast.LocalRefExpr{Name: "x"}, map[string]string{"x": "y"}); got.(*ast.LocalRefExpr).Name != "y" {
		t.Fatal("ref not substituted")
	}
	call := &ast.LocalCallExpr{FnAlias: "f", Args: []ast.LocalExpr{&ast.LocalRefExpr{Name: "x"}}}
	if got := substituteRefs(call, map[string]string{"x": "y"}).(*ast.LocalCallExpr); got.Args[0].(*ast.LocalRefExpr).Name != "y" {
		t.Fatal("call arg not substituted")
	}
}
