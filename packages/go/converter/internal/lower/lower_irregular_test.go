package lower_test

import (
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
// can only arise from compiler bugs (not user input) produce a graceful
// CodeUnsupportedConstruct diagnostic rather than panicking or silently
// emitting incorrect output.
func TestLowerIrregularUnsupportedAstShapes(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		src      string
		mutate   func(*ast.TurnFile)
		wantCode string
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
			wantCode: diag.CodeUnsupportedConstruct,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ds := lowerDiagnosticsFromSource(t, tc.src, tc.mutate)
			if !hasLowerCode(ds, tc.wantCode) {
				t.Fatalf("missing diagnostic code %q in %v", tc.wantCode, ds)
			}
		})
	}
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
