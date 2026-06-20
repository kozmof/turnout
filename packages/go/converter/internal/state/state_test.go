package state_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

// ─── helpers ──────────────────────────────────────────────────────────────────

func pos() ast.Pos { return ast.Pos{File: "test.turn", Line: 1, Col: 1} }

func numLit(v float64) *ast.NumberLiteral { return ast.NewNumberLiteral(pos(), v) }
func strLit(v string) *ast.StringLiteral  { return ast.NewStringLiteral(pos(), v) }
func boolLit(v bool) *ast.BoolLiteral     { return ast.NewBoolLiteral(pos(), v) }
func arrLit(elems ...ast.Literal) *ast.ArrayLiteral {
	return ast.NewArrayLiteral(pos(), elems)
}

func field(name string, ft ast.FieldType, def ast.Literal) *ast.FieldDecl {
	return &ast.FieldDecl{Pos: pos(), Name: name, Type: ft, Default: def}
}

func ns(name string, fields ...*ast.FieldDecl) *ast.NamespaceDecl {
	return &ast.NamespaceDecl{Pos: pos(), Name: name, Fields: fields}
}

func inlineBlock(nss ...*ast.NamespaceDecl) *ast.InlineStateBlock {
	return &ast.InlineStateBlock{Pos: pos(), Namespaces: nss}
}

func hasError(ds diag.Diagnostics, code diag.ErrorCode) bool {
	for _, d := range ds {
		if d.Code == code {
			return true
		}
	}
	return false
}

// ─── inline resolve ───────────────────────────────────────────────────────────

func TestInlineValid(t *testing.T) {
	block := inlineBlock(
		ns("applicant",
			field("income", ast.FieldTypeNumber, numLit(0)),
			field("name", ast.FieldTypeStr, strLit("")),
			field("active", ast.FieldTypeBool, boolLit(false)),
		),
		ns("scores",
			field("history", ast.FieldTypeArrNumber, arrLit(numLit(1), numLit(2))),
		),
	)

	schema, ds := state.Resolve(block, "")
	if ds.HasErrors() {
		t.Fatalf("unexpected errors: %v", ds)
	}
	if got := len(schema.Flat()); got != 4 {
		t.Fatalf("want 4 fields, got %d", got)
	}

	m, ok := schema.Get("applicant.income")
	if !ok {
		t.Fatal("missing applicant.income")
	}
	if m.Type != ast.FieldTypeNumber {
		t.Errorf("applicant.income type: want Number, got %v", m.Type)
	}
}

func TestInlineAllTypes(t *testing.T) {
	block := inlineBlock(ns("t",
		field("n", ast.FieldTypeNumber, numLit(42)),
		field("s", ast.FieldTypeStr, strLit("hi")),
		field("b", ast.FieldTypeBool, boolLit(true)),
		field("an", ast.FieldTypeArrNumber, arrLit()),
		field("as", ast.FieldTypeArrStr, arrLit(strLit("x"))),
		field("ab", ast.FieldTypeArrBool, arrLit(boolLit(true), boolLit(false))),
	))

	_, ds := state.Resolve(block, "")
	if ds.HasErrors() {
		t.Fatalf("unexpected errors: %v", ds)
	}
}

func TestInlineDuplicateNamespace(t *testing.T) {
	block := inlineBlock(
		ns("ns1", field("x", ast.FieldTypeNumber, numLit(0))),
		ns("ns1", field("y", ast.FieldTypeNumber, numLit(0))),
	)
	_, ds := state.Resolve(block, "")
	if !hasError(ds, diag.CodeDuplicateStateNamespace) {
		t.Errorf("want DuplicateStateNamespace, got %v", ds)
	}
}

func TestInlineDuplicateField(t *testing.T) {
	block := inlineBlock(ns("ns",
		field("x", ast.FieldTypeNumber, numLit(0)),
		field("x", ast.FieldTypeNumber, numLit(1)),
	))
	_, ds := state.Resolve(block, "")
	if !hasError(ds, diag.CodeDuplicateStateField) {
		t.Errorf("want DuplicateStateField, got %v", ds)
	}
}

func TestInlineMissingDefault(t *testing.T) {
	block := inlineBlock(ns("ns", field("x", ast.FieldTypeNumber, nil)))
	_, ds := state.Resolve(block, "")
	if !hasError(ds, diag.CodeMissingStateFieldAttr) {
		t.Errorf("want MissingStateFieldAttr, got %v", ds)
	}
}

func TestInlineDefaultTypeMismatch(t *testing.T) {
	cases := []struct {
		ft  ast.FieldType
		lit ast.Literal
	}{
		{ast.FieldTypeNumber, strLit("oops")},
		{ast.FieldTypeStr, numLit(1)},
		{ast.FieldTypeBool, numLit(0)},
		{ast.FieldTypeArrNumber, arrLit(strLit("x"))},
		{ast.FieldTypeArrStr, arrLit(numLit(1))},
		{ast.FieldTypeArrBool, arrLit(strLit("true"))},
		{ast.FieldTypeArrNumber, strLit("notarray")},
	}
	for _, c := range cases {
		block := inlineBlock(ns("ns", field("f", c.ft, c.lit)))
		_, ds := state.Resolve(block, "")
		if !hasError(ds, diag.CodeStateFieldDefaultTypeMismatch) {
			t.Errorf("type %s with wrong lit: want StateFieldDefaultTypeMismatch, got %v", c.ft, ds)
		}
	}
}

// ─── state_file resolve ───────────────────────────────────────────────────────

func writeFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", p, err)
	}
	return p
}

func TestStateFileMissing(t *testing.T) {
	d := &ast.StateFileDirective{Pos: pos(), Path: "nonexistent.turn"}
	_, ds := state.Resolve(d, t.TempDir())
	if !hasError(ds, diag.CodeStateFileMissing) {
		t.Errorf("want StateFileMissing, got %v", ds)
	}
}

func TestStateFileValid(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "mystate.turn", `
state {
  applicant {
    income:number = 0
    name:str      = ""
  }
}
`)
	d := &ast.StateFileDirective{Pos: pos(), Path: "mystate.turn"}
	schema, ds := state.Resolve(d, dir)
	if ds.HasErrors() {
		t.Fatalf("unexpected errors: %v", ds)
	}
	if _, ok := schema.Get("applicant.income"); !ok {
		t.Error("missing applicant.income in schema")
	}
	if _, ok := schema.Get("applicant.name"); !ok {
		t.Error("missing applicant.name in schema")
	}
}

func TestStateFileParseError(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "bad.turn", `state { applicant { !!!invalid`)
	d := &ast.StateFileDirective{Pos: pos(), Path: "bad.turn"}
	_, ds := state.Resolve(d, dir)
	if !hasError(ds, diag.CodeStateFileParseError) {
		t.Errorf("want StateFileParseError, got %v", ds)
	}
}

func TestStateFileMissingStateBlock(t *testing.T) {
	dir := t.TempDir()
	// File with only state_file directive — no inline state block
	writeFile(t, dir, "nodirect.turn", `state_file = "other.turn"`)
	d := &ast.StateFileDirective{Pos: pos(), Path: "nodirect.turn"}
	_, ds := state.Resolve(d, dir)
	if !hasError(ds, diag.CodeMissingStateBlock) {
		t.Errorf("want MissingStateBlock, got %v", ds)
	}
}

func TestStateFileAbsolutePath(t *testing.T) {
	dir := t.TempDir()
	absPath := writeFile(t, dir, "abs.turn", `
state {
  x {
    val:number = 7
  }
}
`)
	d := &ast.StateFileDirective{Pos: pos(), Path: absPath}
	schema, ds := state.Resolve(d, "/some/other/dir")
	if ds.HasErrors() {
		t.Fatalf("unexpected errors: %v", ds)
	}
	if _, ok := schema.Get("x.val"); !ok {
		t.Error("missing x.val in schema")
	}
}

func TestStateFileContainedRejectsAbsoluteEscape(t *testing.T) {
	base := t.TempDir()
	outside := t.TempDir()
	absPath := writeFile(t, outside, "abs.turn", `
state {
  x {
    val:number = 7
  }
}
`)
	d := &ast.StateFileDirective{Pos: pos(), Path: absPath}
	_, _, ds := state.ResolveWithOrderContained(d, base)
	if !hasError(ds, diag.CodeStateFileOutsideBase) {
		t.Errorf("want StateFileOutsideBase, got %v", ds)
	}
}

func TestStateFileContainedRejectsSymlinkEscape(t *testing.T) {
	base := t.TempDir()
	outside := t.TempDir()
	target := writeFile(t, outside, "target.turn", `
state {
  x {
    val:number = 7
  }
}
`)
	link := filepath.Join(base, "link.turn")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	d := &ast.StateFileDirective{Pos: pos(), Path: "link.turn"}
	_, _, ds := state.ResolveWithOrderContained(d, base)
	if !hasError(ds, diag.CodeStateFileOutsideBase) {
		t.Errorf("want StateFileOutsideBase, got %v", ds)
	}
}

// ─── nil source ───────────────────────────────────────────────────────────────

func TestNilSource(t *testing.T) {
	_, ds := state.Resolve(nil, "")
	if !hasError(ds, diag.CodeMissingStateSource) {
		t.Errorf("want MissingStateSource, got %v", ds)
	}
}

// ─── FieldsOf isolation ───────────────────────────────────────────────────────

func TestFieldsOfReturnsCopy(t *testing.T) {
	schema, ds := state.Resolve(&ast.InlineStateBlock{
		Namespaces: []*ast.NamespaceDecl{{
			Name: "ns",
			Fields: []*ast.FieldDecl{{
				Pos:     pos(),
				Name:    "x",
				Type:    ast.FieldTypeNumber,
				Default: &ast.NumberLiteral{Value: 0},
			}},
		}},
	}, "")
	if ds.HasErrors() {
		t.Fatalf("resolve failed: %v", ds)
	}

	fields, ok := schema.FieldsOf("ns")
	if !ok {
		t.Fatal("namespace ns not found")
	}

	// Mutate the returned map; the schema must be unaffected.
	fields["injected"] = state.FieldMeta{}

	fields2, _ := schema.FieldsOf("ns")
	if _, found := fields2["injected"]; found {
		t.Error("mutation of FieldsOf result leaked into schema")
	}
}

func TestStateFileSizeLimits(t *testing.T) {
	dir := t.TempDir()
	content := "state { ns { value:number = 0 } }"
	writeFile(t, dir, "state.turn", content)
	d := &ast.StateFileDirective{Pos: pos(), Path: "state.turn"}

	_, _, ds := state.ResolveWithOrderLimit(d, dir, 4)
	if !hasError(ds, diag.CodeStateFileTooLarge) {
		t.Fatalf("ordinary read: want StateFileTooLarge, got %v", ds)
	}

	_, _, ds = state.ResolveWithOrderContainedLimit(d, dir, 4)
	if !hasError(ds, diag.CodeStateFileTooLarge) {
		t.Fatalf("contained read: want StateFileTooLarge, got %v", ds)
	}

	schema, _, ds := state.ResolveWithOrderLimit(d, dir, int64(len(content)))
	if ds.HasErrors() {
		t.Fatalf("exact limit should succeed: %v", ds)
	}
	if _, ok := schema.Get("ns.value"); !ok {
		t.Fatal("exact-limit schema missing ns.value")
	}
}
