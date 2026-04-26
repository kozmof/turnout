package lower_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"google.golang.org/protobuf/types/known/structpb"
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
          ~>score:number
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
	tm, _ := mustLower(t, src)
	nr := tm.Scenes[0].Actions[0].Next[0]
	if len(nr.Prepare) == 0 {
		t.Fatal("expected prepare entries")
	}
	e := nr.Prepare[0]
	if e.Binding != "score" {
		t.Errorf("binding = %q, want score", e.Binding)
	}
	if e.FromState == nil || *e.FromState != "app.score" {
		t.Errorf("from_state = %v, want app.score", e.FromState)
	}
	// Placeholder _ with from_state should resolve to the state default (10)
	b := nr.Compute.Prog.Bindings[0]
	if b.Name != "score" {
		t.Errorf("binding name = %q, want score", b.Name)
	}
	if nv, ok := b.Value.Kind.(*structpb.Value_NumberValue); !ok || nv.NumberValue != 10 {
		t.Errorf("binding value: got %T %v, want 10", b.Value.Kind, b.Value)
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
          ~>val:number
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
	tm, _ := mustLower(t, src)
	nr := tm.Scenes[0].Actions[0].Next[0]
	if len(nr.Prepare) == 0 {
		t.Fatal("expected prepare entries")
	}
	e := nr.Prepare[0]
	if e.Binding != "val" {
		t.Errorf("binding = %q, want val", e.Binding)
	}
	if nv, ok := e.FromLiteral.Kind.(*structpb.Value_NumberValue); !ok || nv.NumberValue != 99 {
		t.Errorf("from_literal = %T %v, want 99", e.FromLiteral.Kind, e.FromLiteral)
	}
	// Placeholder _ with from_literal = 99 → binding value should be 99
	b := nr.Compute.Prog.Bindings[0]
	if nv, ok := b.Value.Kind.(*structpb.Value_NumberValue); !ok || nv.NumberValue != 99 {
		t.Errorf("binding value: got %T %v, want 99", b.Value.Kind, b.Value)
	}
}

// ─── lowerArg: FuncRefArg and TransformArg branches ──────────────────────────

func TestLowerArgFuncRef(t *testing.T) {
	// Uses { func_ref = "thenFn" } as a function argument, exercising lowerArg(FuncRefArg).
	// Lower does not type-check; validation is a separate phase.
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number      = 1
        thenFn:number = add(x, x)
        result:number = add({ func_ref = "thenFn" }, x)
      }
    }
  }`)
	tm, _ := mustLower(t, src)
	bindings := tm.Scenes[0].Actions[0].Compute.Prog.Bindings
	// result binding is the 3rd (index 2)
	b := bindings[2]
	if b.Expr == nil || b.Expr.Combine == nil {
		t.Fatal("expected combine expr on result binding")
	}
	if b.Expr.Combine.Args[0].FuncRef == nil || *b.Expr.Combine.Args[0].FuncRef != "thenFn" {
		t.Errorf("arg[0].FuncRef = %v, want thenFn", b.Expr.Combine.Args[0].FuncRef)
	}
}

func TestLowerArgTransform(t *testing.T) {
	// Uses { transform = { ref = "x" fn = "doThing" } } as a function argument.
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number      = 1
        result:number = add({ transform = { ref = "x" fn = "doThing" } }, x)
      }
    }
  }`)
	tm, _ := mustLower(t, src)
	bindings := tm.Scenes[0].Actions[0].Compute.Prog.Bindings
	b := bindings[1]
	if b.Expr == nil || b.Expr.Combine == nil {
		t.Fatal("expected combine expr on result binding")
	}
	if b.Expr.Combine.Args[0].Transform == nil {
		t.Fatal("expected transform arg")
	}
	if b.Expr.Combine.Args[0].Transform.Ref != "x" {
		t.Errorf("transform.ref = %q, want x", b.Expr.Combine.Args[0].Transform.Ref)
	}
	if len(b.Expr.Combine.Args[0].Transform.Fn) != 1 || b.Expr.Combine.Args[0].Transform.Fn[0] != "doThing" {
		t.Errorf("transform.fn = %v, want [doThing]", b.Expr.Combine.Args[0].Transform.Fn)
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
        ~>items:arr<number>
      }
    }
    prepare {
      items { from_hook = "my_hook" }
    }
  }
}`
	tm, _ := mustLower(t, src)
	b := tm.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	if b.Name != "items" {
		t.Fatalf("binding = %q, want items", b.Name)
	}
	lv, ok := b.Value.Kind.(*structpb.Value_ListValue)
	if !ok {
		t.Fatalf("value type = %T, want ListValue", b.Value.Kind)
	}
	if len(lv.ListValue.Values) != 0 {
		t.Errorf("zero array should be empty, got %d elements", len(lv.ListValue.Values))
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
        ~>label:str
      }
    }
    prepare {
      label { from_hook = "lbl_hook" }
    }
  }
}`
	tm, _ := mustLower(t, src)
	b := tm.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	sv, ok := b.Value.Kind.(*structpb.Value_StringValue)
	if !ok {
		t.Fatalf("value type = %T, want StringValue", b.Value.Kind)
	}
	if sv.StringValue != "" {
		t.Errorf("zero str = %q, want empty string", sv.StringValue)
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
        ~>flag:bool
      }
    }
    prepare {
      flag { from_hook = "flag_hook" }
    }
  }
}`
	tm, _ := mustLower(t, src)
	b := tm.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	bv, ok := b.Value.Kind.(*structpb.Value_BoolValue)
	if !ok {
		t.Fatalf("value type = %T, want BoolValue", b.Value.Kind)
	}
	if bv.BoolValue != false {
		t.Errorf("zero bool = %v, want false", bv.BoolValue)
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
	tm, _ := mustLower(t, src)
	b := tm.Scenes[0].Actions[0].Compute.Prog.Bindings[1]
	if b.Expr == nil || b.Expr.Combine == nil {
		t.Fatal("expected combine expr on result binding")
	}
	if b.Expr.Combine.Args[1].Lit == nil {
		t.Fatal("expected lit arg for numeric literal 5")
	}
	if nv, ok := b.Expr.Combine.Args[1].Lit.Kind.(*structpb.Value_NumberValue); !ok || nv.NumberValue != 5 {
		t.Errorf("lit arg = %T %v, want 5", b.Expr.Combine.Args[1].Lit.Kind, b.Expr.Combine.Args[1].Lit)
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
          ~>score:number
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
	tm, _ := mustLower(t, src)
	nr := tm.Scenes[0].Actions[0].Next[0]
	if len(nr.Prepare) == 0 {
		t.Fatal("expected prepare entries")
	}
	e := nr.Prepare[0]
	if e.Binding != "score" {
		t.Errorf("binding = %q, want score", e.Binding)
	}
	if e.FromAction == nil || *e.FromAction != "r" {
		t.Errorf("from_action = %v, want r", e.FromAction)
	}
	// zeroLiteralFor(Number) → NumberValue{0}
	b := nr.Compute.Prog.Bindings[0]
	if nv, ok := b.Value.Kind.(*structpb.Value_NumberValue); !ok || nv.NumberValue != 0 {
		t.Errorf("binding value: got %T %v, want 0", b.Value.Kind, b.Value)
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
	_, _, ds3 := lower.Lower(tf, schema)
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
        ~>x:number
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
        ~>x:number
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
          ~>score:number
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
	schema := state.Schema{"nodot": {DefaultValue: nil}}
	tm, _, ds3 := lower.Lower(tf, schema)
	if ds3.HasErrors() {
		t.Fatalf("lower: %v", ds3)
	}
	// The bad key was skipped, so no namespaces in the state block.
	if tm.State != nil && len(tm.State.Namespaces) != 0 {
		t.Errorf("expected 0 namespaces, got %d", len(tm.State.Namespaces))
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
          ~>score:number
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
