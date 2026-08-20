package parser_test

import (
	"strings"
	"testing"
	"time"

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
  entry_action = a
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
			src: minimalTurnFile(`  entry_action = a
  action "a" {
    compute "p" {
        v:bool := }
      }
    }
  }`),
			wantCode:   "MissingBindingSource",
			wantSubstr: "has no value",
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
			name: `retired_prepare_block`,
			src: `state {
  app { score:number = 0 }
}
scene "test" {
  entry_action = a
  action "a" {
    compute "p" { v:number := 1 }
    prepare {
      v { from_state = app.score }
    }
  }
}`,
			wantCode:   "ParseSyntaxError",
			wantSubstr: "unexpected token prepare",
		},
		{
			name: "invalid_route_path_prefix",
			src: `state { ns { v:number = 0 } }
scene "test" {
  entry_action = a
  action "a" {
    compute "p" { r:bool := true }
  }
}
route "r1" {
  to {
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
  entry_action = a
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

// TestParseNestedProgBlock covers a prog block nested inside compute at both
// compute sites. It is rejected and skipped cleanly — one diagnostic, with no
// syntax errors trailing from the skipped bindings.
func TestParseNestedProgBlock(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		src  string
	}{
		{
			name: "action_compute",
			src: minimalTurnFile(`  entry_action = a
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
			src: minimalTurnFile(`  entry_action = a
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
			if ds[0].Code != diag.CodeParseSyntaxError {
				t.Fatalf("diagnostic code = %q, want %q", ds[0].Code, diag.CodeParseSyntaxError)
			}
			if want := "unexpected prog block inside compute"; !strings.Contains(ds[0].Message, want) {
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

	src := minimalTurnFile(`  entry_action = a
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

// hasSyntaxError reports whether ds holds a ParseSyntaxError whose message
// contains want. Retired syntax is reported as an ordinary syntax error, so the
// message is what tells it apart from any other error on the same input.
func hasSyntaxError(ds diag.Diagnostics, want string) bool {
	for _, d := range ds {
		if d.Code == diag.CodeParseSyntaxError && strings.Contains(d.Message, want) {
			return true
		}
	}
	return false
}

func hasDiagCode(ds diag.Diagnostics, want diag.ErrorCode) bool {
	for _, d := range ds {
		if d.Code == want {
			return true
		}
	}
	return false
}

// TestDuplicateStateBlockTerminates covers two `state` blocks in one file.
//
// This case used to hang the parser forever: the duplicate branch called
// skipBlock while still sitting on the `state` keyword, and skipBlock returns
// without advancing unless the current token is `{`, so the top-level loop saw
// the same token on every iteration. The sibling state/state_file pair was
// tested and takes a branch that does advance, which is how the hang survived.
//
// The parse runs on its own goroutine so a regression fails in seconds rather
// than stalling the whole package until the 10-minute test timeout.
func TestDuplicateStateBlockTerminates(t *testing.T) {
	t.Parallel()

	src := `state {}
state {
  ns { v:number = 0 }
}
scene "s" { entry_action = a action "a" { compute "p" { v:bool := true } } }
`
	done := make(chan diag.Diagnostics, 1)
	go func() {
		_, ds := parser.ParseFile("dup-state.tu", src)
		done <- ds
	}()

	select {
	case ds := <-done:
		if !ds.HasErrors() {
			t.Fatal("want an error for a file declaring two state blocks")
		}
		found := false
		for _, d := range ds {
			if d.Code == diag.CodeConflictingStateSource {
				found = true
			}
		}
		if !found {
			t.Errorf("diagnostics = %v, want one with code ConflictingStateSource", ds)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("parsing a file with two state blocks did not terminate")
	}
}
