package validate_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
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
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Compute: &turnoutpb.ComputeModel{
						Root: "r",
						Prog: &turnoutpb.ProgModel{
							Name: "p",
							Bindings: []*turnoutpb.BindingModel{
								{Name: "r", Type: "bool", Value: structpb.NewBoolValue(true)},
							},
						},
					},
					Next: []*turnoutpb.NextRuleModel{
						{
							Action: "a",
							Prepare: []*turnoutpb.NextPrepareEntry{
								{Binding: "x"}, // count=0: no FromAction/FromState/FromLiteral
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil, nil)
	if !hasCode(ds, diag.CodeInvalidTransitionIngress) {
		t.Error("want InvalidTransitionIngress for next prepare entry with no source")
	}
}

// ─── Validate(nil, nil, nil) ──────────────────────────────────────────────────

func TestValidateNilModel(t *testing.T) {
	ds := validate.Validate(nil, nil, nil)
	if ds.HasErrors() {
		t.Error("nil model should produce no errors")
	}
}

// ─── Route pattern: empty / wildcard first segment ────────────────────────────

func TestRoutePatternWildcardFirstSegment(t *testing.T) {
	// Build model manually with a route arm whose pattern starts with "*"
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "scene_1",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{{
				Id: "a",
				Compute: &turnoutpb.ComputeModel{Root: "v", Prog: &turnoutpb.ProgModel{
					Name: "p",
					Bindings: []*turnoutpb.BindingModel{
						{Name: "v", Type: "bool", Value: structpb.NewBoolValue(true)},
					},
				}},
			}},
		}},
		Routes: []*turnoutpb.RouteModel{
			{
				Id: "r1",
				Match: []*turnoutpb.MatchArm{
					{Patterns: []string{"*.action"}, Target: "scene_1"},
				},
			},
		},
	}
	ds := validate.Validate(model, nil, nil)
	if !hasCode(ds, diag.CodeInvalidPathItem) {
		t.Error("want InvalidPathItem for route pattern starting with *")
	}
}

func TestRoutePatternEmptyFirstSegment(t *testing.T) {
	// Pattern with empty first segment (e.g. ".action")
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "scene_1",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{{
				Id: "a",
				Compute: &turnoutpb.ComputeModel{Root: "v", Prog: &turnoutpb.ProgModel{
					Name: "p",
					Bindings: []*turnoutpb.BindingModel{
						{Name: "v", Type: "bool", Value: structpb.NewBoolValue(true)},
					},
				}},
			}},
		}},
		Routes: []*turnoutpb.RouteModel{
			{
				Id: "r1",
				Match: []*turnoutpb.MatchArm{
					{Patterns: []string{".action"}, Target: "scene_1"},
				},
			},
		},
	}
	ds := validate.Validate(model, nil, nil)
	if !hasCode(ds, diag.CodeInvalidPathItem) {
		t.Error("want InvalidPathItem for route pattern with empty first segment")
	}
}

// ─── Route pattern: no action segment (bare scene ID) ────────────────────────

func TestRoutePatternNoActionSegment(t *testing.T) {
	// Pattern "scene_1" (no dot) — no action segment
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "scene_1",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{{
				Id: "a",
				Compute: &turnoutpb.ComputeModel{Root: "v", Prog: &turnoutpb.ProgModel{
					Name: "p",
					Bindings: []*turnoutpb.BindingModel{
						{Name: "v", Type: "bool", Value: structpb.NewBoolValue(true)},
					},
				}},
			}},
		}},
		Routes: []*turnoutpb.RouteModel{
			{
				Id: "r1",
				Match: []*turnoutpb.MatchArm{
					{Patterns: []string{"scene_1"}, Target: "scene_1"},
				},
			},
		},
	}
	ds := validate.Validate(model, nil, nil)
	if !hasCode(ds, diag.CodeBareWildcardPath) {
		t.Error("want BareWildcardPath for route pattern with no action segment")
	}
}

// ─── Action with Compute == nil ───────────────────────────────────────────────

func TestActionComputeNil(t *testing.T) {
	// Action with nil Compute should not panic and produce no extra errors
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{Id: "a", Compute: nil},
			},
		}},
	}
	// Should not panic; may produce no errors (nil compute is allowed structurally)
	ds := validate.Validate(model, nil, nil)
	_ = ds
}

// ─── next rule references unknown action ─────────────────────────────────────

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

// ─── validateProg(nil) ───────────────────────────────────────────────────────

func TestValidateProgNil(t *testing.T) {
	// Build model with action that has Compute with nil Prog
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Compute: &turnoutpb.ComputeModel{
						Root: "r",
						Prog: nil,
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil, nil)
	// Root "r" won't be found in empty scope → SCNActionRootNotFound
	if !hasCode(ds, diag.CodeSCNActionRootNotFound) {
		t.Error("want SCNActionRootNotFound when prog is nil and root is set")
	}
}

// ─── pipe param source undefined ─────────────────────────────────────────────

func TestPipeParamSourceUndefined(t *testing.T) {
	src := min(`        result:number = #pipe(a:undefined_ref)[add(a, a)]
`)
	if !hasCode(pipeline(src), diag.CodeUndefinedRef) {
		t.Error("want UndefinedRef for pipe param with undefined source")
	}
}

// ─── pipe step unknown function ───────────────────────────────────────────────

func TestPipeStepUnknownFunction(t *testing.T) {
	src := min(`        x:number = 1
        result:number = #pipe(a:x)[unknown_fn(a, a)]
`)
	if !hasCode(pipeline(src), diag.CodeUnknownFnAlias) {
		t.Error("want UnknownFnAlias for pipe step with unknown function")
	}
}

// ─── pipe last step type mismatch ────────────────────────────────────────────

func TestPipeLastStepTypeMismatch(t *testing.T) {
	// add returns number but binding is bool
	src := min(`        x:number = 1
        result:bool = #pipe(a:x)[add(a, a)]
`)
	if !hasCode(pipeline(src), diag.CodeReturnTypeMismatch) {
		t.Error("want ReturnTypeMismatch for pipe last step type mismatch")
	}
}

// ─── cond condition reference undefined ──────────────────────────────────────

func TestCondConditionRefUndefined(t *testing.T) {
	// Build model manually with CondExpr whose Condition refs an undefined name
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Compute: &turnoutpb.ComputeModel{
						Root: "v",
						Prog: &turnoutpb.ProgModel{
							Name: "p",
							Bindings: []*turnoutpb.BindingModel{
								{Name: "v", Type: "bool", Value: structpb.NewBoolValue(true)},
								{
									Name: "r",
									Type: "number",
									Expr: &turnoutpb.ExprModel{
										Cond: &turnoutpb.CondExpr{
											Condition:  &turnoutpb.ArgModel{Ref: proto.String("undefined_cond")},
											Then:       &turnoutpb.ArgModel{FuncRef: proto.String("v")},
											ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String("v")},
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
	ds := validate.Validate(model, nil, nil)
	if !hasCode(ds, diag.CodeUndefinedRef) {
		t.Error("want UndefinedRef for cond condition reference to undefined name")
	}
}

// ─── cond branch type mismatch vs binding ────────────────────────────────────

func TestCondBranchTypeMismatchVsBinding(t *testing.T) {
	// thenFn has type bool but binding declares number — then==else so BranchTypeMismatch
	// won't fire, but ReturnTypeMismatch will (thenType != b.Type)
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Compute: &turnoutpb.ComputeModel{
						Root: "v",
						Prog: &turnoutpb.ProgModel{
							Name: "p",
							Bindings: []*turnoutpb.BindingModel{
								{Name: "flag", Type: "bool", Value: structpb.NewBoolValue(true)},
								// thenFn is a function binding returning bool
								{
									Name: "thenFn",
									Type: "bool",
									Expr: &turnoutpb.ExprModel{
										Combine: &turnoutpb.CombineExpr{
											Fn:   "bool_and",
											Args: []*turnoutpb.ArgModel{{Ref: proto.String("flag")}, {Lit: structpb.NewBoolValue(true)}},
										},
									},
								},
								// binding r declares number but cond branches return bool
								{
									Name: "r",
									Type: "number",
									Expr: &turnoutpb.ExprModel{
										Cond: &turnoutpb.CondExpr{
											Condition:  &turnoutpb.ArgModel{Ref: proto.String("flag")},
											Then:       &turnoutpb.ArgModel{FuncRef: proto.String("thenFn")},
											ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String("thenFn")},
										},
									},
								},
								{Name: "v", Type: "bool", Value: structpb.NewBoolValue(true)},
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil, nil)
	if !hasCode(ds, diag.CodeReturnTypeMismatch) {
		t.Error("want ReturnTypeMismatch for cond branch type != binding type")
	}
}

// ─── to_state invalid path ────────────────────────────────────────────────────

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

// ─── SigilIngress with no prepare ────────────────────────────────────────────

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

// ─── SigilBiDir with neither prepare nor merge ───────────────────────────────

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

// ─── next prepare FromAction/FromState/FromLiteral ───────────────────────────

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

// ─── validateStatePath from next prepare from_state ──────────────────────────

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

// ─── next rule condition not found in prog ────────────────────────────────────

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

// ─── validateStatePath: invalid path and not in schema ───────────────────────

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

// ─── isValidStatePath: len<2 and invalid ident ───────────────────────────────

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

// ─── validateArgRefs FuncRef undefined and func_ref on value ─────────────────

func TestFuncRefUndefined(t *testing.T) {
	// Build model manually with a combine that has a FuncRef pointing to undefined
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Compute: &turnoutpb.ComputeModel{
						Root: "v",
						Prog: &turnoutpb.ProgModel{
							Name: "p",
							Bindings: []*turnoutpb.BindingModel{
								{Name: "x", Type: "number", Value: structpb.NewNumberValue(1)},
								{
									Name: "result",
									Type: "number",
									Expr: &turnoutpb.ExprModel{
										Combine: &turnoutpb.CombineExpr{
											Fn: "add",
											Args: []*turnoutpb.ArgModel{
												{FuncRef: proto.String("nonexistent")},
												{Ref: proto.String("x")},
											},
										},
									},
								},
								{Name: "v", Type: "bool", Value: structpb.NewBoolValue(true)},
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil, nil)
	if !hasCode(ds, diag.CodeUndefinedFuncRef) {
		t.Error("want UndefinedFuncRef for func_ref pointing to undefined name")
	}
}

func TestFuncRefOnValueBinding(t *testing.T) {
	// func_ref points to a value binding (not a function) → UndefinedFuncRef
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Compute: &turnoutpb.ComputeModel{
						Root: "v",
						Prog: &turnoutpb.ProgModel{
							Name: "p",
							Bindings: []*turnoutpb.BindingModel{
								{Name: "x", Type: "number", Value: structpb.NewNumberValue(1)},
								{
									Name: "result",
									Type: "number",
									Expr: &turnoutpb.ExprModel{
										Combine: &turnoutpb.CombineExpr{
											Fn: "add",
											Args: []*turnoutpb.ArgModel{
												{FuncRef: proto.String("x")}, // x is a value binding, not func
												{Ref: proto.String("x")},
											},
										},
									},
								},
								{Name: "v", Type: "bool", Value: structpb.NewBoolValue(true)},
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil, nil)
	if !hasCode(ds, diag.CodeUndefinedFuncRef) {
		t.Error("want UndefinedFuncRef for func_ref pointing to value binding")
	}
}

// ─── resolveExpectedReturn arr_concat with no args ───────────────────────────

func TestArrConcatNoArgs(t *testing.T) {
	// arr_concat combine with empty args → resolveExpectedReturn returns (0,false)
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Compute: &turnoutpb.ComputeModel{
						Root: "v",
						Prog: &turnoutpb.ProgModel{
							Name: "p",
							Bindings: []*turnoutpb.BindingModel{
								{
									Name: "result",
									Type: "arr<number>",
									Expr: &turnoutpb.ExprModel{
										Combine: &turnoutpb.CombineExpr{
											Fn:   "arr_concat",
											Args: []*turnoutpb.ArgModel{}, // no args
										},
									},
								},
								{Name: "v", Type: "bool", Value: structpb.NewBoolValue(true)},
							},
						},
					},
				},
			},
		}},
	}
	// Should not panic; validateCombineArgTypes with < 2 args returns early
	ds := validate.Validate(model, nil, nil)
	_ = ds
}

// ─── resolveArgType branches ──────────────────────────────────────────────────

func TestResolveArgTypeLitNumber(t *testing.T) {
	// arr_get(items, 0) — the "0" is a LitArg (NumberValue) → literalFieldType called
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
	// str_includes(label, "hello") — "hello" is a StringValue LitArg
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
	// bool_xor(active, true) — true is a BoolValue LitArg
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
	// arr_concat(items, [1,2]) — [1,2] is ListValue LitArg
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
	// arr_concat(items, []) — empty ListValue → literalFieldType returns (0, false)
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
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Compute: &turnoutpb.ComputeModel{
						Root: "v",
						Prog: &turnoutpb.ProgModel{
							Name: "p",
							Bindings: []*turnoutpb.BindingModel{
								{Name: "x", Type: "number", Value: structpb.NewNumberValue(1)},
								{
									Name: "fn1",
									Type: "number",
									Expr: &turnoutpb.ExprModel{
										Combine: &turnoutpb.CombineExpr{
											Fn:   "add",
											Args: []*turnoutpb.ArgModel{{Ref: proto.String("x")}, {Lit: structpb.NewNumberValue(0)}},
										},
									},
								},
								{
									Name: "result",
									Type: "number",
									Expr: &turnoutpb.ExprModel{
										Pipe: &turnoutpb.PipeExpr{
											Params: []*turnoutpb.PipeParam{{ParamName: "a", SourceIdent: "x"}},
											Steps: []*turnoutpb.PipeStep{
												{
													Fn:   "add",
													Args: []*turnoutpb.ArgModel{{FuncRef: proto.String("fn1")}, {Ref: proto.String("a")}},
												},
											},
										},
									},
								},
								{Name: "v", Type: "bool", Value: structpb.NewBoolValue(true)},
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil, nil)
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

// ─── validateCombineArgTypes with < 2 args ────────────────────────────────────

func TestCombineArgTypesLessThan2Args(t *testing.T) {
	// Combine with 1 arg → validateCombineArgTypes returns early (no panic)
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Compute: &turnoutpb.ComputeModel{
						Root: "v",
						Prog: &turnoutpb.ProgModel{
							Name: "p",
							Bindings: []*turnoutpb.BindingModel{
								{Name: "x", Type: "number", Value: structpb.NewNumberValue(1)},
								{
									Name: "result",
									Type: "number",
									Expr: &turnoutpb.ExprModel{
										Combine: &turnoutpb.CombineExpr{
											Fn:   "add",
											Args: []*turnoutpb.ArgModel{{Ref: proto.String("x")}}, // only 1 arg
										},
									},
								},
								{Name: "v", Type: "bool", Value: structpb.NewBoolValue(true)},
							},
						},
					},
				},
			},
		}},
	}
	// Should not panic
	ds := validate.Validate(model, nil, nil)
	_ = ds
}

// ─── arr_get arg2 type not number ────────────────────────────────────────────

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

// ─── arr_concat arg1 not array ────────────────────────────────────────────────

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

// ─── default case arg type mismatch ──────────────────────────────────────────

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

// ─── isIdentityCombine str_concat and arr_concat branches ────────────────────

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

// ─── literalMatchesFieldType arr with non-array value ────────────────────────

func TestLiteralMatchesFieldTypeArrWithNonArray(t *testing.T) {
	// Build model manually with array-typed binding but NumberValue → literalMatchesFieldType returns false
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Compute: &turnoutpb.ComputeModel{
						Root: "v",
						Prog: &turnoutpb.ProgModel{
							Name: "p",
							Bindings: []*turnoutpb.BindingModel{
								// arr<number> typed but has a NumberValue → literalMatchesFieldType returns false
								{
									Name:  "bad",
									Type:  "arr<number>",
									Value: structpb.NewNumberValue(42),
								},
								{Name: "v", Type: "bool", Value: structpb.NewBoolValue(true)},
							},
						},
					},
				},
			},
		}},
	}
	ds := validate.Validate(model, nil, nil)
	if !hasCode(ds, diag.CodeTypeMismatch) {
		t.Error("want TypeMismatch for arr<number> binding with NumberValue value")
	}
}

// ─── literalFieldType: BoolValue branch ──────────────────────────────────────

func TestLiteralFieldTypeBoolLiteral(t *testing.T) {
	// bool_xor(active, false) — false is BoolValue → literalFieldType returns bool
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

// ─── Ref not found in resolveArgType ─────────────────────────────────────────

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
