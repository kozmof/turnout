package lower_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
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
	tm := mustLower(t, src)
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

func TestLowerExtExprScopesActionAndNext(t *testing.T) {
	src := `state { app { n:number = 0 } }
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        flag:bool = true
        out:number = #if(flag, 1, 0)
      }
    }
    next {
      compute {
        condition = out
        prog "p" {
          out:bool = #if(true, true, false)
        }
      }
      action = a
    }
  }
}`
	tm := mustLower(t, src)
	action := tm.Scenes[0].Actions[0]

	// Action compute prog: find "out" binding and check ext_expr.
	var actionOut *turnoutpb.BindingModel
	for _, b := range action.Compute.Prog.Bindings {
		if b.Name == "out" {
			actionOut = b
		}
	}
	if actionOut == nil || actionOut.ExtExpr == nil {
		t.Fatal("missing ExtExpr on action out binding")
	}
	actionIfExpr, ok := actionOut.ExtExpr.Expr.(*turnoutpb.LocalExprModel_IfExpr)
	if !ok {
		t.Fatalf("action out ExtExpr: got %T, want IfExpr", actionOut.ExtExpr.Expr)
	}
	if _, ok := actionIfExpr.IfExpr.GetThen().Expr.(*turnoutpb.LocalExprModel_Lit); !ok {
		t.Errorf("action then = %T, want Lit", actionIfExpr.IfExpr.GetThen().Expr)
	}

	// Next compute prog: find "out" binding and check ext_expr.
	var nextOut *turnoutpb.BindingModel
	for _, b := range action.Next[0].Compute.Prog.Bindings {
		if b.Name == "out" {
			nextOut = b
		}
	}
	if nextOut == nil || nextOut.ExtExpr == nil {
		t.Fatal("missing ExtExpr on next out binding")
	}
	nextIfExpr, ok := nextOut.ExtExpr.Expr.(*turnoutpb.LocalExprModel_IfExpr)
	if !ok {
		t.Fatalf("next out ExtExpr: got %T, want IfExpr", nextOut.ExtExpr.Expr)
	}
	if _, ok := nextIfExpr.IfExpr.GetThen().Expr.(*turnoutpb.LocalExprModel_Lit); !ok {
		t.Errorf("next then = %T, want Lit", nextIfExpr.IfExpr.GetThen().Expr)
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
	tm := mustLower(t, src)
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
        thenFn:number = max(x, x)
        result:number = max({ func_ref = "thenFn" }, x)
      }
    }
  }`)
	tm := mustLower(t, src)
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
        result:number = max({ transform = { ref = "x" fn = "doThing" } }, x)
      }
    }
  }`)
	tm := mustLower(t, src)
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
	tm := mustLower(t, src)
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
	tm := mustLower(t, src)
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
	tm := mustLower(t, src)
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
	// max(x, 5) — the literal 5 goes through lowerArg LitArg branch.
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number      = 3
        result:number = max(x, 5)
      }
    }
  }`)
	tm := mustLower(t, src)
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
	tm := mustLower(t, src)
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

// lowerWithErrors parses src and lowers it, returning diagnostics without failing on errors.
func lowerWithErrors(t *testing.T, src string) diag.Diagnostics {
	t.Helper()
	tf, ds := parser.ParseFile("test.turn", src)
	if ds.HasErrors() {
		t.Fatalf("parse failed: %v", ds)
	}
	_, ds2 := lower.LowerResolvingState(tf, "")
	return ds2
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

// TestLowerCaseIntoTopologicalOrder verifies that lowerCaseInto emits bindings
// in reverse arm order: each CondExpr.ElseBranch.FuncRef must reference a
// binding name that was emitted earlier (lower index) in the slice, guaranteeing
// topological order so every reference is defined before it is used.
func TestLowerCaseIntoTopologicalOrder(t *testing.T) {
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        score:number = 1
        result:str = #case(score, 1 => "one", 2 => "two", 3 => "three", _ => "other")
      }
    }
  }`)
	tm := mustLower(t, src)
	bindings := tm.Scenes[0].Actions[0].Compute.Prog.Bindings

	// Build an index from binding name → position in the slice.
	nameToIndex := make(map[string]int, len(bindings))
	for i, b := range bindings {
		nameToIndex[b.Name] = i
	}

	// For every CondExpr binding, its ElseBranch.FuncRef must refer to a name
	// that was defined earlier (lower index) than the CondExpr binding itself.
	for i, b := range bindings {
		if b.Expr == nil || b.Expr.Cond == nil {
			continue
		}
		cond := b.Expr.Cond
		if cond.ElseBranch == nil || cond.ElseBranch.FuncRef == nil {
			continue
		}
		elseRef := *cond.ElseBranch.FuncRef
		elseIdx, ok := nameToIndex[elseRef]
		if !ok {
			// ElseBranch references a synthetic name not in the slice (e.g. a
			// function literal emitted outside prog bindings) — skip.
			continue
		}
		if elseIdx >= i {
			t.Errorf("binding[%d] %q: ElseBranch.FuncRef=%q is at index %d (>= %d); "+
				"want it defined before this binding (topological order violation)",
				i, b.Name, elseRef, elseIdx, i)
		}
	}
}

func TestLowerBidirMissingPrepareUsesBidirDiagnostic(t *testing.T) {
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = score
      prog "p" {
        <~>score:number
      }
    }
    merge {
      score { to_state = app.score }
    }
  }
}`
	ds := lowerWithErrors(t, src)
	if !hasLowerDiagCode(ds, diag.CodeBidirMissingPrepareEntry) {
		t.Fatalf("want BidirMissingPrepareEntry diagnostic, got %v", ds)
	}
}

func TestLowerBidirFromStateErrorsAreNotSwallowed(t *testing.T) {
	src := `state {
  app { score:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = score
      prog "p" {
        <~>score:number
      }
    }
    prepare {
      score { from_state = app.missing }
    }
    merge {
      score { to_state = app.score }
    }
  }
}`
	ds := lowerWithErrors(t, src)
	if !hasLowerDiagCode(ds, diag.CodeUnresolvedStatePath) {
		t.Fatalf("want UnresolvedStatePath diagnostic, got %v", ds)
	}
}

func TestTupleCasePatternRejectedAtParse(t *testing.T) {
	// Tuple patterns are rejected by the parser; the error surfaces before lowering.
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        score:number = 1
        result:str = #case(score, (1, 2) => "tuple", _ => "other")
      }
    }
  }`)
	_, ds := parser.ParseFile("test.turn", src)
	if !ds.HasErrors() {
		t.Fatal("want parse error for tuple pattern, got none")
	}
	found := false
	for _, d := range ds {
		if d.Code == "ParseSyntaxError" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("want ParseSyntaxError diagnostic, got %v", ds)
	}
}

func hasLowerDiagCode(ds diag.Diagnostics, code string) bool {
	for _, d := range ds {
		if d.Code == code {
			return true
		}
	}
	return false
}

// ─── early unknown-function diagnostic in local expressions ──────────────────

func TestLowerLocalCallUnknownFnEmitsEarlyDiagnostic(t *testing.T) {
	// An unknown function inside a #if condition should produce CodeUnknownFnAlias
	// pinned to the call site, not a cascade of type-mismatch errors.
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number = 1
        result:bool = #if(no_such_fn(x, x), true, false)
      }
    }
  }`)
	ds := lowerWithErrors(t, src)
	if !hasLowerDiagCode(ds, diag.CodeUnknownFnAlias) {
		t.Errorf("want CodeUnknownFnAlias from lowerer, got %v", ds)
	}
}

func TestLowerLocalCallUnknownFnInPipeEmitsEarlyDiagnostic(t *testing.T) {
	// An unknown function inside a #pipe step should also produce CodeUnknownFnAlias
	// from the lowerer — including when inside a pipe step where operator-only
	// functions are otherwise permitted.
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number = 1
        result:number = #pipe(x, no_such_fn(#it, x))
      }
    }
  }`)
	ds := lowerWithErrors(t, src)
	if !hasLowerDiagCode(ds, diag.CodeUnknownFnAlias) {
		t.Errorf("want CodeUnknownFnAlias from lowerer, got %v", ds)
	}
}

// ─── lowerCaseInto: double wildcard ──────────────────────────────────────────

// TestLowerCaseIntoDoubleWildcard verifies that a #case expression with two
// wildcard arms does not overwrite the first wildcard's fallback body and does
// not emit duplicate unreachable-arm diagnostics.
//
// Input: [_ => "first", _ => "second", 1 => "third"]  (indices 0, 1, 2)
// Expected: exactly 2 CodeUnsupportedConstruct diagnostics — "arm 1 unreachable"
// and "arm 2 unreachable", both emitted by the FIRST wildcard's j-loop.
//
// Before the fix the second wildcard re-entered the wildcard branch and emitted
// an extra "arm 2 unreachable" duplicate, producing 3 diagnostics total.
func TestLowerCaseIntoDoubleWildcard(t *testing.T) {
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number = 1
        result:str = #case(x, _ => "first", _ => "second", 1 => "third")
      }
    }
  }`)
	ds := lowerWithErrors(t, src)

	// Exactly 2 unreachable-arm diagnostics (arm 1 and arm 2, not arm 2 twice).
	unreachable := 0
	for _, d := range ds {
		if d.Code == diag.CodeUnsupportedConstruct {
			unreachable++
		}
	}
	if unreachable != 2 {
		t.Errorf("expected 2 unreachable-arm diagnostics (arm 1, arm 2), got %d: %v", unreachable, ds)
	}
}

func TestLowerLocalCallUnknownFnNoCascadingErrors(t *testing.T) {
	// The early unknown-function diagnostic must not produce cascading ArgTypeMismatch
	// errors. The lowerer emits a zero-value binding so downstream type checking sees
	// a valid (if wrong) value rather than an unresolved reference.
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number = 1
        result:bool = #if(no_such_fn(x, x), true, false)
      }
    }
  }`)
	ds := lowerWithErrors(t, src)
	for _, d := range ds {
		if d.Code == diag.CodeArgTypeMismatch || d.Code == diag.CodeUndefinedRef {
			t.Errorf("unexpected cascading diagnostic %q: %s", d.Code, d.Message)
		}
	}
}

