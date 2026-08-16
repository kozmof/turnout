package parser_test

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
)

func TestParseIrregularTopLevelErrors(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		src       string
		wantCodes []diag.ErrorCode
	}{
		{
			name:      "empty_file",
			src:       "",
			wantCodes: []diag.ErrorCode{diag.CodeMissingStateSource, "MissingScene"},
		},
		{
			name: "state_only",
			src: `state {
  ns { v:number = 0 }
}`,
			wantCodes: []diag.ErrorCode{"MissingScene"},
		},
		{
			name: "scene_only",
			src: `scene "s" {
  entry_actions = [a]
  action "a" { compute "p" { v:bool := true } }
}`,
			wantCodes: []diag.ErrorCode{diag.CodeMissingStateSource},
		},
		{
			name:      "unexpected_top_level_identifier",
			src:       "foo = 1",
			wantCodes: []diag.ErrorCode{"ParseSyntaxError", diag.CodeMissingStateSource, "MissingScene"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			_, ds := parser.ParseFile("bad.tu", tc.src)
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
		wantCode   diag.ErrorCode
		wantSubstr string
	}{
		{
			name: "binding_rhs_closing_brace",
			src: minimalTurnFile(`  entry_actions = [a]
  action "a" {
    compute "p" {
        v:bool := }
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
    compute "p" { v:bool := true }
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
  entry_actions = [a]
  action "a" {
    compute "p" { v:number := }
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
  entry_actions = [a]
  action "a" {
    compute "p" { r:bool := true }
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
  entry_actions = [a]
  action "a" {
    compute "p" { r:bool := true }
  }
`,
			wantCode:   "ParseSyntaxError",
			wantSubstr: "expected }, got EOF",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			_, ds := parser.ParseFile("bad.tu", tc.src)
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

// TestParseLegacyProgBlock covers the pre-merge nested prog spelling at both
// compute sites. The nested block is rejected with a message
// naming its replacement, and skipped cleanly — one diagnostic, with no syntax
// errors trailing from the skipped bindings.
func TestParseLegacyProgBlock(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		src  string
	}{
		{
			name: "action_compute",
			src: minimalTurnFile(`  entry_actions = [a]
  action "a" {
    compute "outer" {
      prog "score_graph" {
        income:number <~ @ns.val
        v:bool := income >= 1
      }
    }
  }`),
		},
		{
			name: "next_compute",
			src: minimalTurnFile(`  entry_actions = [a]
  action "a" {
    compute "root" { v:bool := true }
    next {
      action = b
      compute "outer" {
        prog "score_graph" {
          c:bool := true
        }
      }
    }
  }
  action "b" {
    compute "leaf" { v:bool := true }
  }`),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			_, ds := parser.ParseFile("legacy.tu", tc.src)
			if len(ds) != 1 {
				t.Fatalf("diag count = %d, want 1: %v", len(ds), ds)
			}
			if ds[0].Code != diag.CodeLegacyProgBlock {
				t.Fatalf("diagnostic code = %q, want %q", ds[0].Code, diag.CodeLegacyProgBlock)
			}
			// The message names the replacement, reusing the prog's own label.
			if want := `compute "score_graph"`; !strings.Contains(ds[0].Message, want) {
				t.Fatalf("diagnostic = %q, want substring %q", ds[0].Message, want)
			}
			wantLine := lineOf(t, tc.src, `prog "score_graph"`)
			if ds[0].Line != wantLine {
				t.Fatalf("diagnostic line = %d, want %d (the prog block)", ds[0].Line, wantLine)
			}
		})
	}
}

// TestParseComputeRequiresLabel checks that a bare `compute {` fails as one
// clean error rather than cascading through the binding loop.
func TestParseComputeRequiresLabel(t *testing.T) {
	t.Parallel()

	src := minimalTurnFile(`  entry_actions = [a]
  action "a" {
    compute {
      v:bool := true
    }
  }`)
	_, ds := parser.ParseFile("nolabel.tu", src)
	if !ds.HasErrors() {
		t.Fatal("expected a parse error for an unlabelled compute block")
	}
	if ds[0].Code != diag.CodeParseSyntaxError {
		t.Fatalf("first diagnostic code = %q, want %q", ds[0].Code, diag.CodeParseSyntaxError)
	}
	if len(ds) > 2 {
		t.Fatalf("expected a contained failure, got %d diagnostics: %v", len(ds), ds)
	}
}

func TestParseFileParseDiagnosticsAreCapped(t *testing.T) {
	t.Parallel()

	var sb strings.Builder
	for range 1000 {
		sb.WriteString("foo\n")
	}
	_, ds := parser.ParseFile("bad.tu", sb.String())
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

// lineOf returns the 1-based line of the first occurrence of want in src.
func lineOf(t *testing.T, src, want string) int {
	t.Helper()
	for i, line := range strings.Split(src, "\n") {
		if strings.Contains(line, want) {
			return i + 1
		}
	}
	t.Fatalf("source does not contain %q", want)
	return 0
}

func hasDiagCode(ds diag.Diagnostics, want diag.ErrorCode) bool {
	for _, d := range ds {
		if d.Code == want {
			return true
		}
	}
	return false
}
