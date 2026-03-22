package state_test

import (
	"testing"

	"github.com/turnout/converter/internal/ast"
	"github.com/turnout/converter/internal/diag"
	"github.com/turnout/converter/internal/state"
)

func TestResolveIrregularInlineErrorsAccumulate(t *testing.T) {
	t.Parallel()

	block := inlineBlock(
		ns("app",
			field("score", ast.FieldTypeNumber, nil),
			field("score", ast.FieldTypeNumber, numLit(1)),
			field("flag", ast.FieldTypeBool, strLit("oops")),
		),
		ns("app", field("label", ast.FieldTypeStr, strLit(""))),
	)

	_, ds := state.Resolve(block, "")
	if !ds.HasErrors() {
		t.Fatal("expected resolve errors")
	}

	for _, code := range []string{
		diag.CodeMissingStateFieldAttr,
		diag.CodeDuplicateStateField,
		diag.CodeStateFieldDefaultTypeMismatch,
		diag.CodeDuplicateStateNamespace,
	} {
		if !hasError(ds, code) {
			t.Fatalf("missing diagnostic code %q in %v", code, ds)
		}
	}
}

func TestResolveIrregularStateFileErrorsAreMapped(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	cases := []struct {
		name     string
		content  string
		wantCode string
	}{
		{
			name:     "lex_error",
			content:  `"unterminated`,
			wantCode: diag.CodeStateFileParseError,
		},
		{
			name:     "parse_error",
			content:  `state { app { !!!invalid`,
			wantCode: diag.CodeStateFileParseError,
		},
		{
			name:     "state_file_directive_instead_of_state_block",
			content:  `state_file = "other.turn"`,
			wantCode: diag.CodeMissingStateBlock,
		},
		{
			name: "scene_only_file",
			content: `scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = v prog "p" { v:bool = true } } }
}`,
			wantCode: diag.CodeStateFileParseError,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := writeFile(t, dir, tc.name+".turn", tc.content)
			d := &ast.StateFileDirective{Pos: pos(), Path: path}

			_, ds := state.Resolve(d, dir)
			if !ds.HasErrors() {
				t.Fatal("expected resolve errors")
			}
			if !hasError(ds, tc.wantCode) {
				t.Fatalf("missing diagnostic code %q in %v", tc.wantCode, ds)
			}
			if hasError(ds, "LexError") || hasError(ds, "ParseSyntaxError") {
				t.Fatalf("state.Resolve should map parser/lexer errors, got %v", ds)
			}
		})
	}
}
