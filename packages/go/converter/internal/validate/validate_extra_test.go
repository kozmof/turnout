package validate_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
)

// ─── Array functions ──────────────────────────────────────────────────────────

func TestArrGetValid(t *testing.T) {
	src := min(`        items:arr<number> = [1, 2, 3]
        idx:number = 0
        out:number = arr_get(items, idx)
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestArrGetArgTypeMismatch(t *testing.T) {
	// arr_get arg1 must be array; arg2 must be number
	src := min(`        n:number = 1
        out:number = arr_get(n, n)
`)
	if !hasCode(pipeline(src), diag.CodeArgTypeMismatch) {
		t.Error("want ArgTypeMismatch for arr_get with non-array arg1")
	}
}

func TestArrIncludesValid(t *testing.T) {
	src := min(`        items:arr<number> = [1, 2, 3]
        val:number = 1
        out:bool = arr_includes(items, val)
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestArrIncludesArgTypeMismatch(t *testing.T) {
	// arr_includes arg2 type must match array element type
	src := min(`        items:arr<number> = [1, 2]
        s:str = "x"
        out:bool = arr_includes(items, s)
`)
	if !hasCode(pipeline(src), diag.CodeArgTypeMismatch) {
		t.Error("want ArgTypeMismatch for arr_includes element type mismatch")
	}
}

func TestArrConcatValid(t *testing.T) {
	src := min(`        a:arr<number> = [1]
        b:arr<number> = [2]
        out:arr<number> = arr_concat(a, b)
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestArrConcatArgTypeMismatch(t *testing.T) {
	// arr_concat args must have matching array types
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        a:arr<number> = [1]
        b:arr<str>    = ["x"]
        out:arr<number> = arr_concat(a, b)
        v:bool = true
      }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeArgTypeMismatch) {
		t.Error("want ArgTypeMismatch for arr_concat type mismatch")
	}
}

// ─── String functions ─────────────────────────────────────────────────────────

func TestStrIncludesValid(t *testing.T) {
	src := min(`        s:str = "hello world"
        sub:str = "world"
        out:bool = str_includes(s, sub)
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestStrStartsValid(t *testing.T) {
	src := min(`        s:str = "hello"
        prefix:str = "hel"
        out:bool = str_starts(s, prefix)
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestStrEndsValid(t *testing.T) {
	src := min(`        s:str = "hello"
        suffix:str = "lo"
        out:bool = str_ends(s, suffix)
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

// ─── Boolean and numeric call-only functions ──────────────────────────────────

func TestBoolXorValid(t *testing.T) {
	src := min(`        p:bool = true
        q:bool = false
        out:bool = bool_xor(p, q)
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestMaxValid(t *testing.T) {
	src := min(`        x:number = 3
        y:number = 5
        out:number = max(x, y)
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestMinValid(t *testing.T) {
	src := min(`        x:number = 3
        y:number = 5
        out:number = min(x, y)
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

// ─── Generic eq/neq operators ─────────────────────────────────────────────────

func TestEqHomogeneousNoError(t *testing.T) {
	// eq with two numbers — valid
	src := min(`        x:number = 1
        y:number = 2
        out:bool = x == y
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestNeqHomogeneousNoError(t *testing.T) {
	// neq with two bools — valid
	src := min(`        p:bool = true
        q:bool = false
        out:bool = p != q
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestEqMismatchedTypesError(t *testing.T) {
	// eq with number and bool — ArgTypeMismatch
	src := min(`        n:number = 1
        b:bool = true
        out:bool = n == b
`)
	if !hasCode(pipeline(src), diag.CodeArgTypeMismatch) {
		t.Error("want ArgTypeMismatch for eq with mismatched types")
	}
}

func TestNeqMismatchedTypesError(t *testing.T) {
	// neq with str and number — ArgTypeMismatch
	src := min(`        s:str = "hi"
        n:number = 1
        out:bool = s != n
`)
	if !hasCode(pipeline(src), diag.CodeArgTypeMismatch) {
		t.Error("want ArgTypeMismatch for neq with mismatched types")
	}
}

// ─── SCNNextComputeNotBool ────────────────────────────────────────────────────

func TestSCNNextComputeNotBool(t *testing.T) {
	// next compute condition bound to a number binding — must be bool
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
    next {
      compute {
        condition = score
        prog "n" {
          score:number = 1
        }
      }
      action = a
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeSCNNextComputeNotBool) {
		t.Error("want SCNNextComputeNotBool for non-bool condition")
	}
}

// ─── InvalidTransitionIngress ─────────────────────────────────────────────────

func TestInvalidTransitionIngress(t *testing.T) {
	// Manually build a model with a next prepare entry that has no source (count=0).
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "r",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								{Name: "r", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
							},
						},
					},
					Next: []*lower.HCLNextRule{
						{
							Action: "a",
							Prepare: &lower.HCLNextPrepare{
								Entries: []*lower.HCLNextPrepareEntry{
									{BindingName: "x"}, // count=0: no FromAction/FromState/FromLiteral
								},
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil)
	if !hasCode(ds, diag.CodeInvalidTransitionIngress) {
		t.Error("want InvalidTransitionIngress for next prepare entry with no source")
	}
}

// ─── Validate(nil, nil) ───────────────────────────────────────────────────────

func TestValidateNilModel(t *testing.T) {
	ds := validate.Validate(nil, nil)
	if ds.HasErrors() {
		t.Error("nil model should produce no errors")
	}
}

// ─── Route pattern: empty / wildcard first segment (lines 142-146) ───────────

func TestRoutePatternWildcardFirstSegment(t *testing.T) {
	// Build model manually with a route arm whose pattern starts with "*"
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "scene_1",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{ID: "a", Compute: &lower.HCLCompute{Root: "v", Prog: &lower.HCLProg{
					Name: "p",
					Bindings: []*lower.HCLBinding{
						{Name: "v", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
					},
				}}},
			},
		}},
		Routes: []*lower.HCLRouteBlock{
			{
				ID: "r1",
				Arms: []*lower.HCLMatchArm{
					{Patterns: []string{"*.action"}, Target: "scene_1"},
				},
			},
		},
	}
	ds := validate.Validate(model, nil)
	if !hasCode(ds, diag.CodeInvalidPathItem) {
		t.Error("want InvalidPathItem for route pattern starting with *")
	}
}

func TestRoutePatternEmptyFirstSegment(t *testing.T) {
	// Pattern with empty first segment (e.g. ".action")
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "scene_1",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{ID: "a", Compute: &lower.HCLCompute{Root: "v", Prog: &lower.HCLProg{
					Name: "p",
					Bindings: []*lower.HCLBinding{
						{Name: "v", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
					},
				}}},
			},
		}},
		Routes: []*lower.HCLRouteBlock{
			{
				ID: "r1",
				Arms: []*lower.HCLMatchArm{
					{Patterns: []string{".action"}, Target: "scene_1"},
				},
			},
		},
	}
	ds := validate.Validate(model, nil)
	if !hasCode(ds, diag.CodeInvalidPathItem) {
		t.Error("want InvalidPathItem for route pattern with empty first segment")
	}
}

// ─── Route pattern: no action segment (bare scene ID, lines 149-153) ─────────

func TestRoutePatternNoActionSegment(t *testing.T) {
	// Pattern "scene_1" (no dot) — no action segment
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "scene_1",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{ID: "a", Compute: &lower.HCLCompute{Root: "v", Prog: &lower.HCLProg{
					Name: "p",
					Bindings: []*lower.HCLBinding{
						{Name: "v", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
					},
				}}},
			},
		}},
		Routes: []*lower.HCLRouteBlock{
			{
				ID: "r1",
				Arms: []*lower.HCLMatchArm{
					{Patterns: []string{"scene_1"}, Target: "scene_1"},
				},
			},
		},
	}
	ds := validate.Validate(model, nil)
	if !hasCode(ds, diag.CodeBareWildcardPath) {
		t.Error("want BareWildcardPath for route pattern with no action segment")
	}
}

// ─── Action with Compute == nil (lines 221-223) ───────────────────────────────

func TestActionComputeNil(t *testing.T) {
	// Action with nil Compute should not panic and produce no extra errors
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{ID: "a", Compute: nil},
			},
		}},
	}
	// Should not panic; may produce no errors (nil compute is allowed structurally)
	ds := validate.Validate(model, nil)
	_ = ds
}

// ─── next rule references unknown action (lines 228-231) ─────────────────────

func TestNextRuleUnknownAction(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
    next { action = unknown }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeSCNInvalidActionGraph) {
		t.Error("want SCNInvalidActionGraph for next rule referencing unknown action")
	}
}

// ─── validateProg(nil) (lines 246-248) ───────────────────────────────────────

func TestValidateProgNil(t *testing.T) {
	// Build model with action that has Compute with nil Prog
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "r",
						Prog: nil,
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil)
	// Root "r" won't be found in empty scope → SCNActionRootNotFound
	if !hasCode(ds, diag.CodeSCNActionRootNotFound) {
		t.Error("want SCNActionRootNotFound when prog is nil and root is set")
	}
}

// ─── pipe param source undefined (lines 382-385) ─────────────────────────────

func TestPipeParamSourceUndefined(t *testing.T) {
	src := min(`        result:number = #pipe(a:undefined_ref)[add(a, a)]
`)
	if !hasCode(pipeline(src), diag.CodeUndefinedRef) {
		t.Error("want UndefinedRef for pipe param with undefined source")
	}
}

// ─── pipe step unknown function (lines 401-405) ───────────────────────────────

func TestPipeStepUnknownFunction(t *testing.T) {
	src := min(`        x:number = 1
        result:number = #pipe(a:x)[unknown_fn(a, a)]
`)
	if !hasCode(pipeline(src), diag.CodeUnknownFnAlias) {
		t.Error("want UnknownFnAlias for pipe step with unknown function")
	}
}

// ─── pipe last step type mismatch (lines 427-431) ────────────────────────────

func TestPipeLastStepTypeMismatch(t *testing.T) {
	// add returns number but binding is bool
	src := min(`        x:number = 1
        result:bool = #pipe(a:x)[add(a, a)]
`)
	if !hasCode(pipeline(src), diag.CodeReturnTypeMismatch) {
		t.Error("want ReturnTypeMismatch for pipe last step type mismatch")
	}
}

// ─── cond condition reference undefined (lines 441-444) ──────────────────────

func TestCondConditionRefUndefined(t *testing.T) {
	// Build model manually with HCLCond whose Condition refs an undefined name
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "v",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								{Name: "v", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
								{
									Name: "r",
									Type: ast.FieldTypeNumber,
									Expr: &lower.HCLExpr{
										Cond: &lower.HCLCond{
											Condition: &lower.HCLArg{Ref: "undefined_cond"},
											Then:      &lower.HCLArg{FuncRef: "v"},
											Else:      &lower.HCLArg{FuncRef: "v"},
										},
									},
								},
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil)
	if !hasCode(ds, diag.CodeUndefinedRef) {
		t.Error("want UndefinedRef for cond condition reference to undefined name")
	}
}

// ─── cond branch type mismatch vs binding (lines 490-494) ────────────────────

func TestCondBranchTypeMismatchVsBinding(t *testing.T) {
	// thenFn has type bool but binding declares number — then==else so BranchTypeMismatch
	// won't fire, but ReturnTypeMismatch will (thenType != b.Type)
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "v",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								{Name: "flag", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
								// thenFn is a function binding returning bool
								{
									Name: "thenFn",
									Type: ast.FieldTypeBool,
									Expr: &lower.HCLExpr{
										Combine: &lower.HCLCombine{
											Fn:   "bool_and",
											Args: []*lower.HCLArg{{Ref: "flag"}, {Lit: &ast.BoolLiteral{Value: true}}},
										},
									},
								},
								// binding r declares number but cond branches return bool
								{
									Name: "r",
									Type: ast.FieldTypeNumber,
									Expr: &lower.HCLExpr{
										Cond: &lower.HCLCond{
											Condition: &lower.HCLArg{Ref: "flag"},
											Then:      &lower.HCLArg{FuncRef: "thenFn"},
											Else:      &lower.HCLArg{FuncRef: "thenFn"},
										},
									},
								},
								{Name: "v", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil)
	if !hasCode(ds, diag.CodeReturnTypeMismatch) {
		t.Error("want ReturnTypeMismatch for cond branch type != binding type")
	}
}

// ─── to_state invalid path (lines 547-553) ───────────────────────────────────

func TestMergeToStateInvalidPath(t *testing.T) {
	// to_state = "nodot" has no dot → InvalidStatePath
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        <~x:number = 1
        v:bool = true
      }
    }
    merge {
      x { to_state = "nodot" }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeInvalidStatePath) {
		t.Error("want InvalidStatePath for merge to_state without dot")
	}
}

func TestMergeToStateNotInSchema(t *testing.T) {
	// to_state = "app.nonexistent" → UnresolvedStatePath
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        <~x:number = 1
        v:bool = true
      }
    }
    merge {
      x { to_state = "app.nonexistent" }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeUnresolvedStatePath) {
		t.Error("want UnresolvedStatePath for merge to_state not in schema")
	}
}

// ─── SigilIngress with no prepare (lines 566-569) ────────────────────────────

func TestSigilIngressNoPrepare(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        ~>x:number = _
        v:bool = true
      }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeMissingPrepareEntry) {
		t.Error("want MissingPrepareEntry for ~> with no prepare block")
	}
}

// ─── SigilBiDir with neither prepare nor merge (lines 578-583) ───────────────

func TestSigilBiDirNoPrepareNoMerge(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        <~>x:number = 0
        v:bool = true
      }
    }
  }
}
`
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeMissingPrepareEntry) {
		t.Error("want MissingPrepareEntry for <~> with neither prepare nor merge")
	}
	if !hasCode(ds, diag.CodeMissingMergeEntry) {
		t.Error("want MissingMergeEntry for <~> with neither prepare nor merge")
	}
}

// ─── next prepare FromAction/FromState/FromLiteral (lines 622-630) ───────────

func TestNextPrepareFromAction(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
    next {
      compute { condition = go prog "n" { ~>score:number = _ go:bool = true } }
      prepare { score { from_action = r } }
      action = a
    }
  }
}
`
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestNextPrepareFromState(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
    next {
      compute { condition = go prog "n" { ~>score:number = _ go:bool = true } }
      prepare { score { from_state = app.score } }
      action = a
    }
  }
}
`
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestNextPrepareFromLiteral(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
    next {
      compute { condition = go prog "n" { ~>score:number = _ go:bool = true } }
      prepare { score { from_literal = 42 } }
      action = a
    }
  }
}
`
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

// ─── validateStatePath from next prepare from_state (lines 636-638) ──────────

func TestNextPrepareFromStateInvalidPath(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
    next {
      compute { condition = go prog "n" { ~>score:number = 0 go:bool = true } }
      prepare { score { from_state = nodot } }
      action = a
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeInvalidStatePath) {
		t.Error("want InvalidStatePath for next prepare from_state with invalid path")
	}
}

// ─── next rule condition not found in prog (lines 652-655) ───────────────────

func TestNextRuleConditionNotInProg(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
    next {
      compute {
        condition = nonexistent
        prog "n" { go:bool = true }
      }
      action = a
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeSCNNextComputeNotBool) {
		t.Error("want SCNNextComputeNotBool for next condition not found in prog")
	}
}

// ─── validateStatePath: invalid path and not in schema (lines 668-676) ───────

func TestValidateStatePathInvalidPath(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        ~>x:number = 0
        v:bool = true
      }
    }
    prepare {
      x { from_state = nodot }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeInvalidStatePath) {
		t.Error("want InvalidStatePath for prepare from_state with invalid path")
	}
}

func TestValidateStatePathNotInSchema(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        ~>x:number = _
        v:bool = true
      }
    }
    prepare {
      x { from_state = app.nonexistent }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeUnresolvedStatePath) {
		t.Error("want UnresolvedStatePath for prepare from_state not in schema")
	}
}

// ─── isValidStatePath: len<2 and invalid ident (lines 682-688) ───────────────

func TestIsValidStatePathTooShort(t *testing.T) {
	// "nodot" → only one segment after split → len < 2 → invalid
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        <~score:number = 0
        v:bool = true
      }
    }
    merge {
      score { to_state = "nodot" }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeInvalidStatePath) {
		t.Error("want InvalidStatePath for to_state with no dot")
	}
}

func TestIsValidStatePathInvalidIdentFirst(t *testing.T) {
	// "1app.score" — first segment starts with digit → invalid ident
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        <~score:number = 0
        v:bool = true
      }
    }
    merge {
      score { to_state = "1app.score" }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeInvalidStatePath) {
		t.Error("want InvalidStatePath for to_state with invalid first ident")
	}
}

func TestIsValidStatePathInvalidIdentSubsequent(t *testing.T) {
	// "a-b.score" — hyphen is invalid in subsequent chars
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        <~score:number = 0
        v:bool = true
      }
    }
    merge {
      score { to_state = "a-b.score" }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeInvalidStatePath) {
		t.Error("want InvalidStatePath for to_state with hyphen in ident")
	}
}

func TestIsValidStatePathEmptySegment(t *testing.T) {
	// "." → parts ["",""] → empty string → isIdent("") returns false
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        <~score:number = 0
        v:bool = true
      }
    }
    merge {
      score { to_state = "." }
    }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeInvalidStatePath) {
		t.Error("want InvalidStatePath for to_state = \".\"")
	}
}

// ─── validateArgRefs FuncRef undefined and func_ref on value (lines 705-714) ──

func TestFuncRefUndefined(t *testing.T) {
	// Build model manually with a combine that has a FuncRef pointing to undefined
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "v",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								{Name: "x", Type: ast.FieldTypeNumber, Value: &ast.NumberLiteral{Value: 1}},
								{
									Name: "result",
									Type: ast.FieldTypeNumber,
									Expr: &lower.HCLExpr{
										Combine: &lower.HCLCombine{
											Fn: "add",
											Args: []*lower.HCLArg{
												{FuncRef: "nonexistent"},
												{Ref: "x"},
											},
										},
									},
								},
								{Name: "v", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil)
	if !hasCode(ds, diag.CodeUndefinedFuncRef) {
		t.Error("want UndefinedFuncRef for func_ref pointing to undefined name")
	}
}

func TestFuncRefOnValueBinding(t *testing.T) {
	// func_ref points to a value binding (not a function) → UndefinedFuncRef
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "v",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								{Name: "x", Type: ast.FieldTypeNumber, Value: &ast.NumberLiteral{Value: 1}},
								{
									Name: "result",
									Type: ast.FieldTypeNumber,
									Expr: &lower.HCLExpr{
										Combine: &lower.HCLCombine{
											Fn: "add",
											Args: []*lower.HCLArg{
												{FuncRef: "x"}, // x is a value binding, not func
												{Ref: "x"},
											},
										},
									},
								},
								{Name: "v", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil)
	if !hasCode(ds, diag.CodeUndefinedFuncRef) {
		t.Error("want UndefinedFuncRef for func_ref pointing to value binding")
	}
}

// ─── resolveExpectedReturn arr_concat with no args (line 740) ────────────────

func TestArrConcatNoArgs(t *testing.T) {
	// arr_concat combine with empty args → resolveExpectedReturn returns (0,false)
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "v",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								{
									Name: "result",
									Type: ast.FieldTypeArrNumber,
									Expr: &lower.HCLExpr{
										Combine: &lower.HCLCombine{
											Fn:   "arr_concat",
											Args: []*lower.HCLArg{}, // no args
										},
									},
								},
								{Name: "v", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
							},
						},
					},
				},
			},
		}},
	}
	// Should not panic; validateCombineArgTypes with < 2 args returns early
	ds := validate.Validate(model, nil)
	_ = ds
}

// ─── resolveArgType branches ──────────────────────────────────────────────────

func TestResolveArgTypeLitNumber(t *testing.T) {
	// arr_get(items, 0) — the "0" is a LitArg (NumberLiteral) → literalFieldType called
	src := min(`        items:arr<number> = [1, 2, 3]
        out:number = arr_get(items, 0)
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestResolveArgTypeLitString(t *testing.T) {
	// str_includes(label, "hello") — "hello" is a StringLiteral LitArg
	src := min(`        label:str = ""
        out:bool = str_includes(label, "hello")
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestResolveArgTypeLitBool(t *testing.T) {
	// bool_xor(active, true) — true is a BoolLiteral LitArg
	src := min(`        active:bool = false
        out:bool = bool_xor(active, true)
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestResolveArgTypeLitArrayNonEmpty(t *testing.T) {
	// arr_concat(items, [1,2]) — [1,2] is ArrayLiteral LitArg
	src := min(`        items:arr<number> = []
        out:arr<number> = arr_concat(items, [1, 2])
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestResolveArgTypeLitArrayEmpty(t *testing.T) {
	// arr_concat(items, []) — empty ArrayLiteral → literalFieldType returns (0, false)
	src := min(`        items:arr<number> = []
        out:arr<number> = arr_concat(items, [])
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestResolveArgTypeFuncRef(t *testing.T) {
	// pipe step with func_ref arg — resolveArgType FuncRef branch
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "v",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								{Name: "x", Type: ast.FieldTypeNumber, Value: &ast.NumberLiteral{Value: 1}},
								{
									Name: "fn1",
									Type: ast.FieldTypeNumber,
									Expr: &lower.HCLExpr{
										Combine: &lower.HCLCombine{
											Fn:   "add",
											Args: []*lower.HCLArg{{Ref: "x"}, {Lit: &ast.NumberLiteral{Value: 0}}},
										},
									},
								},
								{
									Name: "result",
									Type: ast.FieldTypeNumber,
									Expr: &lower.HCLExpr{
										Pipe: &lower.HCLPipe{
											Params: []*lower.HCLPipeParam{{ParamName: "a", SourceIdent: "x"}},
											Steps: []*lower.HCLPipeStep{
												{
													Fn:   "add",
													Args: []*lower.HCLArg{{FuncRef: "fn1"}, {Ref: "a"}},
												},
											},
										},
									},
								},
								{Name: "v", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil)
	_ = ds
}

func TestResolveArgTypeStepRef(t *testing.T) {
	// pipe with step_ref — resolveArgType StepRef branch
	src := min(`        x:number = 1
        y:number = 2
        out:number = #pipe(a:x, b:y)[
          add(a, b),
          add({ step_ref = 0 }, b)
        ]
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

// ─── validateCombineArgTypes with < 2 args (lines 772-774) ───────────────────

func TestCombineArgTypesLessThan2Args(t *testing.T) {
	// Combine with 1 arg → validateCombineArgTypes returns early (no panic)
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "v",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								{Name: "x", Type: ast.FieldTypeNumber, Value: &ast.NumberLiteral{Value: 1}},
								{
									Name: "result",
									Type: ast.FieldTypeNumber,
									Expr: &lower.HCLExpr{
										Combine: &lower.HCLCombine{
											Fn:   "add",
											Args: []*lower.HCLArg{{Ref: "x"}}, // only 1 arg
										},
									},
								},
								{Name: "v", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
							},
						},
					},
				},
			},
		}},
	}
	// Should not panic
	ds := validate.Validate(model, nil)
	_ = ds
}

// ─── arr_get arg2 type not number (lines 790-793) ────────────────────────────

func TestArrGetArg2NotNumber(t *testing.T) {
	// arr_get(items, label) — label is str, not number
	src := min(`        items:arr<number> = []
        label:str = ""
        out:number = arr_get(items, label)
`)
	if !hasCode(pipeline(src), diag.CodeArgTypeMismatch) {
		t.Error("want ArgTypeMismatch for arr_get arg2 not number")
	}
}

// ─── arr_concat arg1 not array (lines 805-808) ────────────────────────────────

func TestArrConcatArg1NotArray(t *testing.T) {
	// arr_concat(score, items) — score is number, not array
	src := min(`        score:number = 0
        items:arr<number> = []
        out:arr<number> = arr_concat(score, items)
`)
	if !hasCode(pipeline(src), diag.CodeArgTypeMismatch) {
		t.Error("want ArgTypeMismatch for arr_concat arg1 not array")
	}
}

// ─── default case arg type mismatch (lines 815-818) ──────────────────────────

func TestDefaultCaseArgTypeMismatch(t *testing.T) {
	// add(label, score) — label is str but add expects number
	src := min(`        label:str = ""
        score:number = 0
        out:number = add(label, score)
`)
	if !hasCode(pipeline(src), diag.CodeArgTypeMismatch) {
		t.Error("want ArgTypeMismatch for add with str arg1")
	}
}

// ─── isIdentityCombine str_concat and arr_concat branches (lines 835-848) ────

func TestIdentityCombineStrConcat(t *testing.T) {
	// t:str = label → lowered as str_concat(label, "") → identity combine
	src := min(`        label:str = ""
        t:str = label
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestIdentityCombineArrConcat(t *testing.T) {
	// t:arr<number> = items → lowered as arr_concat(items, []) → identity combine
	src := min(`        items:arr<number> = []
        t:arr<number> = items
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

// ─── literalMatchesFieldType arr with non-array value (lines 865-867) ────────

func TestLiteralMatchesFieldTypeArrWithNonArray(t *testing.T) {
	// Build model manually with array-typed binding but NumberLiteral value
	model := &lower.Model{
		State: &lower.HCLStateBlock{},
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "v",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								// arr<number> typed but has a NumberLiteral value → literalMatchesFieldType returns false
								{
									Name:  "bad",
									Type:  ast.FieldTypeArrNumber,
									Value: &ast.NumberLiteral{Value: 42},
								},
								{Name: "v", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil)
	if !hasCode(ds, diag.CodeTypeMismatch) {
		t.Error("want TypeMismatch for arr<number> binding with NumberLiteral value")
	}
}

// ─── literalFieldType: BoolLiteral branch (lines 887-888) ────────────────────

func TestLiteralFieldTypeBoolLiteral(t *testing.T) {
	// bool_xor(active, false) — false is BoolLiteral → literalFieldType returns bool
	src := min(`        active:bool = false
        out:bool = bool_xor(active, false)
`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

// ─── Ref not found in resolveArgType (line 753) ───────────────────────────────

func TestResolveArgTypeRefNotFound(t *testing.T) {
	// combine where first arg refs an undefined name — resolveArgType returns (0, false)
	// but validateArgRefs already caught UndefinedRef; validateCombineArgTypes won't emit
	// because ok1 is false. Just verify no panic.
	src := min(`        x:number = 1
        out:number = add(ghost, x)
`)
	if !hasCode(pipeline(src), diag.CodeUndefinedRef) {
		t.Error("want UndefinedRef for combine with undefined ref")
	}
}
