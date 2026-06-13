package lower_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

func TestLowerIrregularPlaceholderResolutionErrors(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		src      string
		wantCode diag.ErrorCode
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
		wantCode diag.ErrorCode
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


// TestLowerStaleDeclarationOrderIsError verifies that lowerCore emits an error
// (not a warning) when the declaration-order slice contains a key that is absent
// from the schema — an internal invariant violation that indicates data loss.
func TestLowerStaleDeclarationOrderIsError(t *testing.T) {
	t.Parallel()

	// Build a TurnFile with a state_file directive (so lowerCore uses the schema path).
	src := `state_file = "fake.turn"
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = v prog "p" { v:bool = true } } }
}`
	tf, ds := parser.ParseFile("test.turn", src)
	if ds.HasErrors() {
		t.Fatalf("parse: %v", ds)
	}

	// Schema has only "app.score"; order claims an extra key "app.ghost" that
	// does not exist — the stale-order divergence we want to trigger.
	schema := state.NewSchemaFromMap(map[string]map[string]state.FieldMeta{
		"app": {
			"score": {Type: ast.FieldTypeNumber},
		},
	})
	order := []string{"app.score", "app.ghost"}

	result, ds2 := lower.LowerCoreForTest(tf, schema, order)
	if !ds2.HasErrors() {
		t.Fatal("expected error diagnostic for stale declaration-order key, got none")
	}
	if !hasLowerCode(ds2, diag.CodeStaleDeclarationOrder) {
		t.Fatalf("expected CodeStaleDeclarationOrder error, got: %v", ds2)
	}
	for _, d := range ds2 {
		if d.Code == diag.CodeStaleDeclarationOrder && d.Severity == diag.SeverityWarning {
			t.Fatalf("CodeStaleDeclarationOrder must be an error, got Warning: %s", d.Format())
		}
	}
	// A stale-order error must halt model assembly; a nil result signals to
	// downstream stages (validate, emit) that no partial model is available.
	if result != nil {
		t.Fatal("expected nil LowerResult when CodeStaleDeclarationOrder is emitted, got non-nil")
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

func hasLowerCode(ds diag.Diagnostics, code diag.ErrorCode) bool {
	for _, d := range ds {
		if d.Code == code {
			return true
		}
	}
	return false
}
