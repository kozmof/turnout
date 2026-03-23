package validate_test

import (
	"testing"

	"github.com/turnout/converter/internal/ast"
	"github.com/turnout/converter/internal/diag"
	"github.com/turnout/converter/internal/lower"
	"github.com/turnout/converter/internal/parser"
	"github.com/turnout/converter/internal/state"
	"github.com/turnout/converter/internal/validate"
)

// ─── helpers ──────────────────────────────────────────────────────────────────

// pipeline parses src, lowers, and validates. Returns all diagnostics.
// It runs each phase and accumulates errors without aborting between phases
// so that validation errors from validate.Validate() are always reachable
// even if lower() returns errors too.
func pipeline(src string) diag.Diagnostics {
	tf, ds := parser.ParseFile("test.turn", src)
	if ds.HasErrors() {
		return ds
	}
	schema, ds2 := state.Resolve(tf.StateSource, "")
	ds = append(ds, ds2...)
	if ds2.HasErrors() {
		return ds
	}
	model, ds3 := lower.Lower(tf, schema)
	ds = append(ds, ds3...)
	if model == nil {
		return ds
	}
	ds4 := validate.Validate(model, schema)
	return append(ds, ds4...)
}

func hasCode(ds diag.Diagnostics, code string) bool {
	for _, d := range ds {
		if d.Code == code {
			return true
		}
	}
	return false
}

// minScene wraps a prog body in minimal scaffolding with the given state block.
func minScene(stateBlock, progBody string) string {
	return stateBlock + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
` + progBody + `
        v:bool = true
      }
    }
  }
}
`
}

// basicState is the minimal state block used in most tests.
const basicState = `state {
  app {
    score:number  = 0
    active:bool   = false
    label:str     = ""
    items:arr<number> = []
  }
}`

func min(progBody string) string {
	return minScene(basicState, progBody)
}

// ─── positive: valid source ───────────────────────────────────────────────────

func TestValidateNoErrorsOnValid(t *testing.T) {
	src := min("        n:number = 42\n")
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

// ─── Group A: binding validation ─────────────────────────────────────────────

func TestTypeMismatch(t *testing.T) {
	src := min(`        n:number = "oops"
`)
	if !hasCode(pipeline(src), diag.CodeTypeMismatch) {
		t.Error("want TypeMismatch")
	}
}

func TestHeterogeneousArray(t *testing.T) {
	// arr<number> with a string element
	src := min(`        xs:arr<number> = [1, "two"]
`)
	if !hasCode(pipeline(src), diag.CodeHeterogeneousArray) {
		t.Error("want HeterogeneousArray")
	}
}

func TestNestedArrayNotAllowed(t *testing.T) {
	// arr<number> with a nested array element [[1]]
	// The parser supports nested array literals.
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        xs:arr<number> = [[1, 2]]
        v:bool = true
      }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeNestedArrayNotAllowed) {
		t.Error("want NestedArrayNotAllowed")
	}
}

func TestDuplicateBinding(t *testing.T) {
	src := min(`        x:number = 1
        x:number = 2
`)
	if !hasCode(pipeline(src), diag.CodeDuplicateBinding) {
		t.Error("want DuplicateBinding")
	}
}

func TestReservedName(t *testing.T) {
	src := min(`        __foo:number = 1
`)
	if !hasCode(pipeline(src), diag.CodeReservedName) {
		t.Error("want ReservedName")
	}
}

func TestUnknownFnAlias(t *testing.T) {
	src := min(`        x:number = 1
        out:number = nonexistent_fn(x, x)
`)
	if !hasCode(pipeline(src), diag.CodeUnknownFnAlias) {
		t.Error("want UnknownFnAlias")
	}
}

func TestUndefinedRef(t *testing.T) {
	// ref to a binding that doesn't exist
	src := min(`        out:number = ghost
`)
	if !hasCode(pipeline(src), diag.CodeUndefinedRef) {
		t.Error("want UndefinedRef")
	}
}

func TestUndefinedFuncRef(t *testing.T) {
	// then/else referring to an undefined binding
	src := min(`        flag:bool = true
        out:number = {
          cond = {
            condition = flag
            then      = noSuchFn
            else      = noSuchFn
          }
        }
`)
	if !hasCode(pipeline(src), diag.CodeUndefinedFuncRef) {
		t.Error("want UndefinedFuncRef")
	}
}

func TestArgTypeMismatch(t *testing.T) {
	// add expects (number, number); passing bool
	src := min(`        x:number = 5
        b:bool   = true
        out:number = add(x, b)
`)
	if !hasCode(pipeline(src), diag.CodeArgTypeMismatch) {
		t.Error("want ArgTypeMismatch")
	}
}

func TestReturnTypeMismatch(t *testing.T) {
	// add returns number but declared type is bool
	src := min(`        x:number = 1
        y:number = 2
        out:bool = add(x, y)
`)
	if !hasCode(pipeline(src), diag.CodeReturnTypeMismatch) {
		t.Error("want ReturnTypeMismatch")
	}
}

func TestCondNotBool(t *testing.T) {
	// condition binding is number, not bool
	src := min(`        n:number    = 5
        thenFn:bool = true
        elseFn:bool = false
        out:bool = {
          cond = {
            condition = n
            then      = thenFn
            else      = elseFn
          }
        }
`)
	if !hasCode(pipeline(src), diag.CodeCondNotBool) {
		t.Error("want CondNotBool")
	}
}

func TestBranchTypeMismatch(t *testing.T) {
	// then returns number, else returns str → mismatch
	src := min(`        flag:bool    = true
        thenFn:number = add(x, x)
        elseFn:str    = str_concat(s, s)
        x:number = 1
        s:str    = "a"
        out:number = {
          cond = {
            condition = flag
            then      = thenFn
            else      = elseFn
          }
        }
`)
	if !hasCode(pipeline(src), diag.CodeBranchTypeMismatch) {
		t.Error("want BranchTypeMismatch")
	}
}

func TestStepRefOutOfBounds(t *testing.T) {
	// pipe with 1 step, step_ref = 5 → out of bounds
	src := min(`        x:number = 3
        out:number = #pipe(a:x)[
          add(a, a),
          mul({ step_ref = 99 }, a)
        ]
`)
	if !hasCode(pipeline(src), diag.CodeStepRefOutOfBounds) {
		t.Error("want StepRefOutOfBounds")
	}
}

func TestPipeArgNotValue(t *testing.T) {
	// pipe param ident points to a function binding (not a value binding)
	src := min(`        x:number = 3
        y:number = 4
        fnb:number = add(x, y)
        out:number = #pipe(a:fnb)[add(a, a)]
`)
	if !hasCode(pipeline(src), diag.CodePipeArgNotValue) {
		t.Error("want PipeArgNotValue")
	}
}

func TestSingleRefTypeMismatch(t *testing.T) {
	// single-ref: src is bool but declared as number
	src := min(`        src:bool = true
        out:number = src
`)
	if !hasCode(pipeline(src), diag.CodeSingleRefTypeMismatch) {
		t.Error("want SingleRefTypeMismatch")
	}
}

// ─── Group B: effect DSL validation ──────────────────────────────────────────

func TestMissingPrepareEntry(t *testing.T) {
	// ~> binding but no prepare entry
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = score
      prog "p" {
        ~>score:number = _
      }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeMissingPrepareEntry) {
		t.Error("want MissingPrepareEntry")
	}
}

func TestMissingMergeEntry(t *testing.T) {
	// <~ binding but no merge entry
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = score
      prog "p" {
        <~score:number = 0
      }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeMissingMergeEntry) {
		t.Error("want MissingMergeEntry")
	}
}

func TestSpuriousPrepareEntry(t *testing.T) {
	// prepare entry for a non-sigiled binding
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        plain:number = 0
        v:bool = true
      }
    }
    prepare {
      plain { from_state = app.score }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeSpuriousPrepareEntry) {
		t.Error("want SpuriousPrepareEntry")
	}
}

func TestSpuriousMergeEntry(t *testing.T) {
	// merge entry for a non-sigiled binding
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        plain:bool = true
        v:bool = true
      }
    }
    merge {
      plain { to_state = app.active }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeSpuriousMergeEntry) {
		t.Error("want SpuriousMergeEntry")
	}
}

func TestDuplicatePrepareEntry(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = score
      prog "p" {
        ~>score:number = _
      }
    }
    prepare {
      score { from_state = app.score }
      score { from_state = app.score }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeDuplicatePrepareEntry) {
		t.Error("want DuplicatePrepareEntry")
	}
}

func TestDuplicateMergeEntry(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = score
      prog "p" {
        <~score:number = 0
      }
    }
    merge {
      score { to_state = app.score }
      score { to_state = app.score }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeDuplicateMergeEntry) {
		t.Error("want DuplicateMergeEntry")
	}
}

func TestBidirMissingPrepareEntry(t *testing.T) {
	// <~> in merge but not in prepare
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = score
      prog "p" {
        <~>score:number = 0
      }
    }
    merge {
      score { to_state = app.score }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeBidirMissingPrepareEntry) {
		t.Error("want BidirMissingPrepareEntry")
	}
}

func TestBidirMissingMergeEntry(t *testing.T) {
	// <~> in prepare but not in merge
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = score
      prog "p" {
        <~>score:number = _
      }
    }
    prepare {
      score { from_state = app.score }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeBidirMissingMergeEntry) {
		t.Error("want BidirMissingMergeEntry")
	}
}

func TestTransitionOutputSigil(t *testing.T) {
	// <~ in a next (transition) prog
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    next {
      compute {
        condition = go
        prog "n" {
          <~score:number = 0
          go:bool = true
        }
      }
      action = b
    }
  }
  action "b" {
    compute { root = v prog "p" { v:bool = true } }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeTransitionOutputSigil) {
		t.Error("want TransitionOutputSigil")
	}
}

func TestUnresolvedPrepareBinding(t *testing.T) {
	// prepare entry for "ghost" which isn't in prog
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" { v:bool = true }
    }
    prepare {
      ghost { from_state = app.score }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeUnresolvedPrepareBinding) {
		t.Error("want UnresolvedPrepareBinding")
	}
}

func TestUnresolvedMergeBinding(t *testing.T) {
	// merge entry for "ghost" which isn't in prog
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" { v:bool = true }
    }
    merge {
      ghost { to_state = app.score }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeUnresolvedMergeBinding) {
		t.Error("want UnresolvedMergeBinding")
	}
}

// ─── Group C: state validation ────────────────────────────────────────────────

func TestUnresolvedStatePath(t *testing.T) {
	// from_state pointing to a path not in schema
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = score
      prog "p" {
        ~>score:number = _
      }
    }
    prepare {
      score { from_state = nonexistent.path }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeUnresolvedStatePath) {
		t.Error("want UnresolvedStatePath")
	}
}

func TestStateTypeMismatch(t *testing.T) {
	// to_state app.active is bool but binding is number
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = score
      prog "p" {
        <~score:number = 0
      }
    }
    merge {
      score { to_state = app.active }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeStateTypeMismatch) {
		t.Error("want StateTypeMismatch")
	}
}

// ─── Group D: scene structural validation ────────────────────────────────────

func TestDuplicateActionLabel(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" { compute { root = v prog "p" { v:bool = true } } }
  action "a" { compute { root = v prog "p" { v:bool = true } } }
}
`
	if !hasCode(pipeline(src), diag.CodeDuplicateActionLabel) {
		t.Error("want DuplicateActionLabel")
	}
}

func TestSCNInvalidActionGraph_NoActions(t *testing.T) {
	// manually build model with empty actions to trigger this
	// (can't parse an empty scene normally)
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions:      []*lower.HCLAction{},
		}},
	}
	ds := validate.Validate(model, nil)
	if !hasCode(ds, diag.CodeSCNInvalidActionGraph) {
		t.Error("want SCN_INVALID_ACTION_GRAPH for empty actions")
	}
}

func TestSCNInvalidActionGraph_NoEntryActions(t *testing.T) {
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{},
			Actions: []*lower.HCLAction{
				{ID: "a", Compute: &lower.HCLCompute{Root: "v", Prog: &lower.HCLProg{Name: "p", Bindings: []*lower.HCLBinding{
					{Name: "v", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
				}}}},
			},
		}},
	}
	ds := validate.Validate(model, nil)
	if !hasCode(ds, diag.CodeSCNInvalidActionGraph) {
		t.Error("want SCN_INVALID_ACTION_GRAPH for empty entry_actions")
	}
}

func TestSCNActionRootNotFound(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = nonexistent_binding
      prog "p" { v:bool = true }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeSCNActionRootNotFound) {
		t.Error("want SCN_ACTION_ROOT_NOT_FOUND")
	}
}

// ─── Group E: route validation ────────────────────────────────────────────────

func routeSrc(matchBody string) string {
	return basicState + `
scene "scene_1" {
  entry_actions = ["a"]
  action "a" { compute { root = v prog "p" { v:bool = true } } }
}
route "r1" {
  match {
` + matchBody + `
  }
}
`
}

func TestDuplicateFallback(t *testing.T) {
	src := routeSrc(`    _ => scene_1,
    _ => scene_1`)
	if !hasCode(pipeline(src), diag.CodeDuplicateFallback) {
		t.Error("want DuplicateFallback")
	}
}

func TestBareWildcardPath(t *testing.T) {
	src := routeSrc(`    scene_1.* => scene_1`)
	if !hasCode(pipeline(src), diag.CodeBareWildcardPath) {
		t.Error("want BareWildcardPath")
	}
}

func TestMultipleWildcards(t *testing.T) {
	src := routeSrc(`    scene_1.*.*.final => scene_1`)
	if !hasCode(pipeline(src), diag.CodeMultipleWildcards) {
		t.Error("want MultipleWildcards")
	}
}

func TestUnresolvedScene(t *testing.T) {
	src := routeSrc(`    scene_1.*.final => undefined_scene`)
	if !hasCode(pipeline(src), diag.CodeUnresolvedScene) {
		t.Error("want UnresolvedScene")
	}
}

func TestRouteValidNoErrors(t *testing.T) {
	src := routeSrc(`    scene_1.*.final_action => scene_1,
    _ => scene_1`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}
