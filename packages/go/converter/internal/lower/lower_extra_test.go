package lower_test

import (
	"testing"

	"github.com/turnout/converter/internal/ast"
	"github.com/turnout/converter/internal/diag"
	"github.com/turnout/converter/internal/lower"
	"github.com/turnout/converter/internal/parser"
	"github.com/turnout/converter/internal/state"
)

// ─── lowerNextPrepare: from_state and from_literal branches ──────────────────

func TestLowerNextPrepareFromState(t *testing.T) {
	src := `state {
  app { score:number = 10 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
    next {
      compute {
        condition = go
        prog "n" {
          ~>score:number = _
          go:bool = true
        }
      }
      prepare {
        score { from_state = app.score }
      }
      action = a
    }
  }
}`
	model := mustLower(t, src)
	nr := model.Scene.Actions[0].Next[0]
	if nr.Prepare == nil || len(nr.Prepare.Entries) == 0 {
		t.Fatal("expected prepare entries")
	}
	e := nr.Prepare.Entries[0]
	if e.BindingName != "score" {
		t.Errorf("binding = %q, want score", e.BindingName)
	}
	if e.FromState != "app.score" {
		t.Errorf("from_state = %q, want app.score", e.FromState)
	}
	// Placeholder _ with from_state should resolve to the state default (10)
	b := nr.Compute.Prog.Bindings[0]
	if b.Name != "score" {
		t.Errorf("binding name = %q, want score", b.Name)
	}
	num, ok := b.Value.(*ast.NumberLiteral)
	if !ok || num.Value != 10 {
		t.Errorf("binding value: got %T %v, want NumberLiteral 10", b.Value, b.Value)
	}
}

func TestLowerNextPrepareFromLiteral(t *testing.T) {
	src := `state {
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
          ~>val:number = _
          go:bool = true
        }
      }
      prepare {
        val { from_literal = 99 }
      }
      action = a
    }
  }
}`
	model := mustLower(t, src)
	nr := model.Scene.Actions[0].Next[0]
	if nr.Prepare == nil || len(nr.Prepare.Entries) == 0 {
		t.Fatal("expected prepare entries")
	}
	e := nr.Prepare.Entries[0]
	if e.BindingName != "val" {
		t.Errorf("binding = %q, want val", e.BindingName)
	}
	if lit, ok := e.FromLiteral.(*ast.NumberLiteral); !ok || lit.Value != 99 {
		t.Errorf("from_literal = %T %v, want NumberLiteral 99", e.FromLiteral, e.FromLiteral)
	}
	// Placeholder _ with from_literal = 99 → binding value should be 99
	b := nr.Compute.Prog.Bindings[0]
	num, ok := b.Value.(*ast.NumberLiteral)
	if !ok || num.Value != 99 {
		t.Errorf("binding value: got %T %v, want NumberLiteral 99", b.Value, b.Value)
	}
}

// ─── lowerArg: FuncRefArg and TransformArg branches ──────────────────────────

func TestLowerArgFuncRef(t *testing.T) {
	// Uses { func_ref = "thenFn" } as a pipe step argument, exercising lowerArg(FuncRefArg).
	// Lower does not type-check; validation is a separate phase.
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number      = 1
        thenFn:number = add(x, x)
        result:number = #pipe(a:x)[
          add({ func_ref = "thenFn" }, a)
        ]
      }
    }
  }`)
	model := mustLower(t, src)
	bindings := model.Scene.Actions[0].Compute.Prog.Bindings
	// result binding is the 3rd (index 2)
	b := bindings[2]
	if b.Expr == nil || b.Expr.Pipe == nil {
		t.Fatal("expected pipe expr on result binding")
	}
	step := b.Expr.Pipe.Steps[0]
	if step.Args[0].FuncRef != "thenFn" {
		t.Errorf("step arg[0].FuncRef = %q, want thenFn", step.Args[0].FuncRef)
	}
}

func TestLowerArgTransform(t *testing.T) {
	// Uses { transform = { ref = "x" fn = "doThing" } } as a pipe step arg.
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number      = 1
        result:number = #pipe(a:x)[
          add({ transform = { ref = "x" fn = "doThing" } }, a)
        ]
      }
    }
  }`)
	model := mustLower(t, src)
	bindings := model.Scene.Actions[0].Compute.Prog.Bindings
	b := bindings[1]
	if b.Expr == nil || b.Expr.Pipe == nil {
		t.Fatal("expected pipe expr on result binding")
	}
	step := b.Expr.Pipe.Steps[0]
	if step.Args[0].Transform == nil {
		t.Fatal("expected transform arg")
	}
	if step.Args[0].Transform.Ref != "x" {
		t.Errorf("transform.ref = %q, want x", step.Args[0].Transform.Ref)
	}
	if step.Args[0].Transform.Fn != "doThing" {
		t.Errorf("transform.fn = %q, want doThing", step.Args[0].Transform.Fn)
	}
}

// ─── zeroLiteralFor: all types via from_hook ──────────────────────────────────

func TestLowerZeroLiteralForArrayFromHook(t *testing.T) {
	// ~>items:arr<number> = _ with from_hook triggers zeroLiteralFor for array types.
	src := `state {
  app { items:arr<number> = [] }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = items
      prog "p" {
        ~>items:arr<number> = _
      }
    }
    prepare {
      items { from_hook = "my_hook" }
    }
  }
}`
	model := mustLower(t, src)
	b := model.Scene.Actions[0].Compute.Prog.Bindings[0]
	if b.Name != "items" {
		t.Fatalf("binding = %q, want items", b.Name)
	}
	arr, ok := b.Value.(*ast.ArrayLiteral)
	if !ok {
		t.Fatalf("value type = %T, want *ast.ArrayLiteral", b.Value)
	}
	if len(arr.Elements) != 0 {
		t.Errorf("zero array should be empty, got %d elements", len(arr.Elements))
	}
}

func TestLowerZeroLiteralForStr(t *testing.T) {
	// ~>label:str = _ with from_hook → zeroLiteralFor(FieldTypeStr) = StringLiteral{""}
	src := `state {
  app { label:str = "default" }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = label
      prog "p" {
        ~>label:str = _
      }
    }
    prepare {
      label { from_hook = "lbl_hook" }
    }
  }
}`
	model := mustLower(t, src)
	b := model.Scene.Actions[0].Compute.Prog.Bindings[0]
	lit, ok := b.Value.(*ast.StringLiteral)
	if !ok {
		t.Fatalf("value type = %T, want *ast.StringLiteral", b.Value)
	}
	if lit.Value != "" {
		t.Errorf("zero str = %q, want empty string", lit.Value)
	}
}

func TestLowerZeroLiteralForBool(t *testing.T) {
	// ~>flag:bool = _ with from_hook → zeroLiteralFor(FieldTypeBool) = BoolLiteral{false}
	src := `state {
  app { flag:bool = true }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = flag
      prog "p" {
        ~>flag:bool = _
      }
    }
    prepare {
      flag { from_hook = "flag_hook" }
    }
  }
}`
	model := mustLower(t, src)
	b := model.Scene.Actions[0].Compute.Prog.Bindings[0]
	lit, ok := b.Value.(*ast.BoolLiteral)
	if !ok {
		t.Fatalf("value type = %T, want *ast.BoolLiteral", b.Value)
	}
	if lit.Value != false {
		t.Errorf("zero bool = %v, want false", lit.Value)
	}
}

// ─── lowerArg: LitArg branch ──────────────────────────────────────────────────

func TestLowerArgLit(t *testing.T) {
	// add(x, 5) — the literal 5 goes through lowerArg LitArg branch.
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number      = 3
        result:number = add(x, 5)
      }
    }
  }`)
	model := mustLower(t, src)
	b := model.Scene.Actions[0].Compute.Prog.Bindings[1]
	if b.Expr == nil || b.Expr.Combine == nil {
		t.Fatal("expected combine expr on result binding")
	}
	if b.Expr.Combine.Args[1].Lit == nil {
		t.Fatal("expected lit arg for numeric literal 5")
	}
	num, ok := b.Expr.Combine.Args[1].Lit.(*ast.NumberLiteral)
	if !ok || num.Value != 5 {
		t.Errorf("lit arg = %T %v, want NumberLiteral 5", b.Expr.Combine.Args[1].Lit, b.Expr.Combine.Args[1].Lit)
	}
}

// ─── lowerNextPrepare: from_action branch ────────────────────────────────────

func TestLowerNextPrepareFromAction(t *testing.T) {
	// from_action in next prepare covers lowerNextPrepare FromAction case and
	// transitionPrepareResolver.resolveDefault FromAction case (zeroLiteralFor Number).
	src := `state {
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
          ~>score:number = _
          go:bool = true
        }
      }
      prepare {
        score { from_action = r }
      }
      action = a
    }
  }
}`
	model := mustLower(t, src)
	nr := model.Scene.Actions[0].Next[0]
	if nr.Prepare == nil || len(nr.Prepare.Entries) == 0 {
		t.Fatal("expected prepare entries")
	}
	e := nr.Prepare.Entries[0]
	if e.BindingName != "score" {
		t.Errorf("binding = %q, want score", e.BindingName)
	}
	if e.FromAction != "r" {
		t.Errorf("from_action = %q, want r", e.FromAction)
	}
	// zeroLiteralFor(Number) → NumberLiteral{0}
	b := nr.Compute.Prog.Bindings[0]
	num, ok := b.Value.(*ast.NumberLiteral)
	if !ok || num.Value != 0 {
		t.Errorf("binding value: got %T %v, want NumberLiteral 0", b.Value, b.Value)
	}
}

// ─── error paths: action prepare resolver ────────────────────────────────────

// lowerWithErrors calls lower.Lower and returns diagnostics (without failing on errors).
func lowerWithErrors(t *testing.T, src string) diag.Diagnostics {
	t.Helper()
	tf, ds := parser.ParseFile("test.turn", src)
	if ds.HasErrors() {
		t.Fatalf("parse failed: %v", ds)
	}
	schema, ds2 := state.Resolve(tf.StateSource, "")
	if ds2.HasErrors() {
		t.Fatalf("state resolve failed: %v", ds2)
	}
	_, ds3 := lower.Lower(tf, schema)
	return ds3
}

func TestLowerPrepareMissingEntry(t *testing.T) {
	// ~>x:number = _ with no prepare entry → CodeMissingPrepareEntry
	src := `state {
  app { x:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = x
      prog "p" {
        ~>x:number = _
      }
    }
  }
}`
	ds := lowerWithErrors(t, src)
	found := false
	for _, d := range ds {
		if d.Code == diag.CodeMissingPrepareEntry {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("want MissingPrepareEntry diagnostic, got: %v", ds)
	}
}

func TestLowerPrepareFromStateNotFound(t *testing.T) {
	// from_state pointing to nonexistent path → CodeUnresolvedStatePath
	src := `state {
  app { x:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = x
      prog "p" {
        ~>x:number = _
      }
    }
    prepare {
      x { from_state = app.nonexistent }
    }
  }
}`
	ds := lowerWithErrors(t, src)
	found := false
	for _, d := range ds {
		if d.Code == diag.CodeUnresolvedStatePath {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("want UnresolvedStatePath diagnostic, got: %v", ds)
	}
}

func TestLowerTransitionPrepareMissingEntry(t *testing.T) {
	// ~>score:number = _ in next compute with no next prepare → CodeMissingPrepareEntry
	src := `state {
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
          ~>score:number = _
          go:bool = true
        }
      }
      action = a
    }
  }
}`
	ds := lowerWithErrors(t, src)
	found := false
	for _, d := range ds {
		if d.Code == diag.CodeMissingPrepareEntry {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("want MissingPrepareEntry diagnostic, got: %v", ds)
	}
}

// ─── lowerStateBlockFromSchema: skip non-dotted key ──────────────────────────

func TestLowerStateBlockFromSchemaBadKey(t *testing.T) {
	// A schema entry without a dot is skipped (continue branch in lowerStateBlockFromSchema).
	// Requires a TurnFile with a state_file directive to reach lowerStateBlockFromSchema.
	src := `state_file = "fake.turn"
scene "test" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}`
	tf, ds := parser.ParseFile("test.turn", src)
	if ds.HasErrors() {
		t.Fatalf("parse: %v", ds)
	}
	// Pass a schema with a non-dotted key to exercise the continue branch.
	schema := state.Schema{"nodot": {DefaultValue: &ast.NumberLiteral{Value: 0}}}
	model, ds3 := lower.Lower(tf, schema)
	if ds3.HasErrors() {
		t.Fatalf("lower: %v", ds3)
	}
	// The bad key was skipped, so no namespaces in the state block.
	if model.State != nil && len(model.State.Namespaces) != 0 {
		t.Errorf("expected 0 namespaces, got %d", len(model.State.Namespaces))
	}
}

func TestLowerTransitionPrepareFromStateNotFound(t *testing.T) {
	// from_state pointing to nonexistent path in next prepare → CodeUnresolvedStatePath
	src := `state {
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
          ~>score:number = _
          go:bool = true
        }
      }
      prepare {
        score { from_state = app.nonexistent }
      }
      action = a
    }
  }
}`
	ds := lowerWithErrors(t, src)
	found := false
	for _, d := range ds {
		if d.Code == diag.CodeUnresolvedStatePath {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("want UnresolvedStatePath diagnostic, got: %v", ds)
	}
}
