package parser_test

import (
	"strings"
	"testing"

	"github.com/turnout/converter/internal/diag"
	"github.com/turnout/converter/internal/parser"
)

func TestParseIrregularTopLevelErrors(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		src       string
		wantCodes []string
	}{
		{
			name:      "empty_file",
			src:       "",
			wantCodes: []string{diag.CodeMissingStateSource, "MissingScene"},
		},
		{
			name: "state_only",
			src: `state {
  ns { v:number = 0 }
}`,
			wantCodes: []string{"MissingScene"},
		},
		{
			name: "scene_only",
			src: `scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = v prog "p" { v:bool = true } } }
}`,
			wantCodes: []string{diag.CodeMissingStateSource},
		},
		{
			name:      "unexpected_top_level_identifier",
			src:       "foo = 1",
			wantCodes: []string{"ParseSyntaxError", diag.CodeMissingStateSource, "MissingScene"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			_, ds := parser.ParseFile("bad.turn", tc.src)
			if !ds.HasErrors() {
				t.Fatal("expected parse errors")
			}
			for _, code := range tc.wantCodes {
				if !hasDiagCode(ds, code) {
					t.Fatalf("missing diagnostic code %q in %v", code, ds)
				}
			}
		})
	}
}

func TestParseIrregularMalformedDslShapes(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		src        string
		wantCode   string
		wantSubstr string
	}{
		{
			name: "binding_rhs_closing_brace",
			src: minimalTurnFile(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        v:bool = }
      }
    }
  }`),
			wantCode:   "ParseSyntaxError",
			wantSubstr: "unexpected token }",
		},
		{
			name: "unterminated_action_docstring",
			src: minimalTurnFile(`  action "a" {
    """
    open text
    compute { root = v prog "p" { v:bool = true } }
  }`),
			wantCode:   "LexError",
			wantSubstr: "unterminated triple-quoted string",
		},
		{
			name: `prepare_missing_source_value`,
			src: `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { ~>v:number = _ } }
    prepare {
      v { from_state = }
    }
  }
}`,
			wantCode:   "ParseSyntaxError",
			wantSubstr: "expected identifier or string for reference value",
		},
		{
			name: "invalid_route_path_prefix",
			src: `state { ns { v:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
  }
}
route "r1" {
  match {
    42 => test
  }
}`,
			wantCode:   "ParseSyntaxError",
			wantSubstr: "expected scene_id or _ in path expression",
		},
		{
			name: "missing_scene_closing_brace",
			src: `state { ns { v:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
  }
`,
			wantCode:   "ParseSyntaxError",
			wantSubstr: "expected }, got EOF",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			_, ds := parser.ParseFile("bad.turn", tc.src)
			if !ds.HasErrors() {
				t.Fatal("expected parse errors")
			}
			if ds[0].Code != tc.wantCode {
				t.Fatalf("first diagnostic code = %q, want %q", ds[0].Code, tc.wantCode)
			}
			if !strings.Contains(ds[0].Message, tc.wantSubstr) {
				t.Fatalf("first diagnostic = %q, want substring %q", ds[0].Message, tc.wantSubstr)
			}
		})
	}
}

func TestParseFileParseDiagnosticsAreCapped(t *testing.T) {
	t.Parallel()

	var sb strings.Builder
	for range 1000 {
		sb.WriteString("foo\n")
	}
	_, ds := parser.ParseFile("bad.turn", sb.String())
	if !ds.HasErrors() {
		t.Fatal("expected parse errors")
	}
	if len(ds) != 101 {
		t.Fatalf("diag count = %d, want 101", len(ds))
	}
	last := ds[len(ds)-1]
	if last.Code != diag.CodeTooManyDiagnostics {
		t.Fatalf("last diagnostic code = %q, want %q", last.Code, diag.CodeTooManyDiagnostics)
	}
}

func hasDiagCode(ds diag.Diagnostics, want string) bool {
	for _, d := range ds {
		if d.Code == want {
			return true
		}
	}
	return false
}
