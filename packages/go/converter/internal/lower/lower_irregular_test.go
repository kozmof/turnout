package lower_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
)

func TestLowerIrregularPlaceholderResolutionErrors(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		src      string
		wantCode string
	}{
		{
			name: "action_missing_prepare_entry",
			src: `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = score
      prog "p" {
        ~>score:number
      }
    }
  }
}`,
			wantCode: diag.CodeMissingPrepareEntry,
		},
		{
			name: "action_unresolved_state_path",
			src: `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = score
      prog "p" {
        ~>score:number
      }
    }
    prepare {
      score { from_state = app.missing }
    }
  }
}`,
			wantCode: diag.CodeUnresolvedStatePath,
		},
		{
			name: "transition_missing_prepare_entry",
			src: `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
    next {
      compute {
        condition = go
        prog "n" {
          ~>score:number
          go:bool = true
        }
      }
      action = a
    }
  }
}`,
			wantCode: diag.CodeMissingPrepareEntry,
		},
		{
			name: "transition_unresolved_state_path",
			src: `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
    next {
      compute {
        condition = go
        prog "n" {
          ~>score:number
          go:bool = true
        }
      }
      prepare {
        score { from_state = app.missing }
      }
      action = a
    }
  }
}`,
			wantCode: diag.CodeUnresolvedStatePath,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ds := lowerDiagnosticsFromSource(t, tc.src, nil)
			if !hasLowerCode(ds, tc.wantCode) {
				t.Fatalf("missing diagnostic code %q in %v", tc.wantCode, ds)
			}
		})
	}
}

// TestLowerIrregularUnsupportedAstShapes verifies that malformed ASTs that
// can only arise from compiler bugs (not user input) cause a panic rather than
// silently emitting a diagnostic that could be mistaken for a user error.
func TestLowerIrregularUnsupportedAstShapes(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name        string
		src         string
		mutate      func(*ast.TurnFile)
		panicSubstr string
	}{
		{
			name: "nil_binding_rhs",
			src: minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        v:bool = true
      }
    }
  }`),
			mutate: func(tf *ast.TurnFile) {
				tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0].RHS = nil
			},
			panicSubstr: "compiler bug",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			tf, ds := parser.ParseFile("test.turn", tc.src)
			if ds.HasErrors() {
				t.Fatalf("parse: %v", ds)
			}
			tc.mutate(tf)

			assertPanics(t, tc.panicSubstr, func() {
				lower.LowerResolvingState(tf, "") //nolint:errcheck
			})
		})
	}
}

// assertPanics calls f and fails the test if f does not panic, or if the
// recovered panic value does not contain wantSubstr.
func assertPanics(t *testing.T, wantSubstr string, f func()) {
	t.Helper()
	defer func() {
		r := recover()
		if r == nil {
			t.Fatalf("expected a panic containing %q but function returned normally", wantSubstr)
		}
		msg := fmt.Sprintf("%v", r)
		if wantSubstr != "" && !strings.Contains(msg, wantSubstr) {
			t.Fatalf("panic message %q does not contain %q", msg, wantSubstr)
		}
	}()
	f()
}

func lowerDiagnosticsFromSource(t *testing.T, src string, mutate func(*ast.TurnFile)) diag.Diagnostics {
	t.Helper()

	tf, ds := parser.ParseFile("test.turn", src)
	if ds.HasErrors() {
		t.Fatalf("parse: %v", ds)
	}
	if mutate != nil {
		mutate(tf)
	}

	lr, ds2 := lower.LowerResolvingState(tf, "")
	if lr != nil {
		t.Fatalf("expected nil result for irregular lowering path, got %#v", lr)
	}
	return ds2
}

func hasLowerCode(ds diag.Diagnostics, code string) bool {
	for _, d := range ds {
		if d.Code == code {
			return true
		}
	}
	return false
}
