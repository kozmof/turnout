package lower_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─── helpers ──────────────────────────────────────────────────────────────────

// mustLower parses src, resolves state, and lowers to a proto model + sidecar.
func mustLower(t *testing.T, src string) (*turnoutpb.TurnModel, *lower.Sidecar) {
	t.Helper()
	tf, ds := parser.ParseFile("test.turn", src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Logf("parse diag: %s", d.Format())
		}
		t.Fatalf("parse failed")
	}
	schema, ds2 := state.Resolve(tf.StateSource, "")
	if ds2.HasErrors() {
		for _, d := range ds2 {
			t.Logf("state diag: %s", d.Format())
		}
		t.Fatalf("state resolve failed")
	}
	tm, sc, ds3 := lower.Lower(tf, schema)
	if ds3.HasErrors() {
		for _, d := range ds3 {
			t.Logf("lower diag: %s", d.Format())
		}
		t.Fatalf("lower failed")
	}
	return tm, sc
}

// minimal wraps a scene body in the minimum valid scaffolding.
func minimal(sceneBody string) string {
	return `state {
  ns {
    val:number = 0
    flag:bool  = false
    name:str   = ""
    items:arr<number> = []
  }
}
scene "test" {
` + sceneBody + "\n}\n"
}

// minimalWithState wraps a scene body with a custom state block.
func minimalWithState(stateBlock, sceneBody string) string {
	return stateBlock + "\nscene \"test\" {\n" + sceneBody + "\n}\n"
}

// binding returns the nth binding from the first action's prog.
func binding(t *testing.T, tm *turnoutpb.TurnModel, n int) *turnoutpb.BindingModel {
	t.Helper()
	b := tm.Scenes[0].Actions[0].Compute.Prog.Bindings
	if n >= len(b) {
		t.Fatalf("binding index %d out of range (have %d)", n, len(b))
	}
	return b[n]
}

// ─── state block lowering ─────────────────────────────────────────────────────

func TestLowerStateBlockInline(t *testing.T) {
	tm, _ := mustLower(t, `state {
  applicant {
    income:number = 42
    approved:bool = true
  }
  meta {
    status:str = "ok"
  }
}
scene "s" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
  }
}`)
	if tm.State == nil {
		t.Fatal("model.State is nil")
	}
	if len(tm.State.Namespaces) != 2 {
		t.Fatalf("namespace count = %d, want 2", len(tm.State.Namespaces))
	}
	ns0 := tm.State.Namespaces[0]
	if ns0.Name != "applicant" {
		t.Errorf("ns[0].Name = %q", ns0.Name)
	}
	if len(ns0.Fields) != 2 {
		t.Errorf("ns[0] fields = %d, want 2", len(ns0.Fields))
	}
	if ns0.Fields[0].Name != "income" || ns0.Fields[0].Type != "number" {
		t.Errorf("field[0]: name=%q type=%q", ns0.Fields[0].Name, ns0.Fields[0].Type)
	}
	nv, ok := ns0.Fields[0].Value.Kind.(*structpb.Value_NumberValue)
	if !ok || nv.NumberValue != 42 {
		t.Errorf("field[0] default: got %T %v", ns0.Fields[0].Value, ns0.Fields[0].Value)
	}
}

func TestLowerStateFileProducesSchema(t *testing.T) {
	dir := t.TempDir()
	stateContent := `state {
  app {
    score:number = 0
    label:str    = ""
  }
}`
	if err := os.WriteFile(filepath.Join(dir, "mystate.turn"), []byte(stateContent), 0o644); err != nil {
		t.Fatalf("write state file: %v", err)
	}
	src := `state_file = "mystate.turn"
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = v prog "p" { v:bool = true } } }
}`
	tf, ds := parser.ParseFile("test.turn", src)
	if ds.HasErrors() {
		t.Fatalf("parse: %v", ds)
	}
	schema, ds2 := state.Resolve(tf.StateSource, dir)
	if ds2.HasErrors() {
		t.Fatalf("state: %v", ds2)
	}
	tm, _, ds3 := lower.Lower(tf, schema)
	if ds3.HasErrors() {
		t.Fatalf("lower: %v", ds3)
	}
	// state_file directive → state block reconstructed from schema (sorted)
	if tm.State == nil || len(tm.State.Namespaces) != 1 {
		t.Fatalf("want 1 namespace, got %v", tm.State)
	}
	if tm.State.Namespaces[0].Name != "app" {
		t.Errorf("ns name = %q", tm.State.Namespaces[0].Name)
	}
}

// ─── literal RHS ──────────────────────────────────────────────────────────────

func TestLowerLiteralRHS(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" {
        n:number       = 99
        s:str          = "hi"
        b:bool         = true
        xs:arr<number> = [1, 2]
        v:bool         = true
      }
    }
  }`))
	bindings := tm.Scenes[0].Actions[0].Compute.Prog.Bindings

	// n:number = 99
	if bindings[0].Value == nil {
		t.Fatal("n: expected value binding")
	}
	if nv, ok := bindings[0].Value.Kind.(*structpb.Value_NumberValue); !ok || nv.NumberValue != 99 {
		t.Errorf("n value: got %T %v", bindings[0].Value.Kind, bindings[0].Value)
	}

	// s:str = "hi"
	if sv, ok := bindings[1].Value.Kind.(*structpb.Value_StringValue); !ok || sv.StringValue != "hi" {
		t.Errorf("s value: got %T", bindings[1].Value.Kind)
	}

	// b:bool = true
	if bv, ok := bindings[2].Value.Kind.(*structpb.Value_BoolValue); !ok || !bv.BoolValue {
		t.Errorf("b value: got %T", bindings[2].Value.Kind)
	}

	// xs:arr<number> = [1, 2]
	if lv, ok := bindings[3].Value.Kind.(*structpb.Value_ListValue); !ok || len(lv.ListValue.Values) != 2 {
		t.Errorf("xs value: got %T len=%v", bindings[3].Value.Kind, bindings[3])
	}
}

// ─── single-ref RHS (identity combine) ────────────────────────────────────────

func TestLowerSingleRefBool(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        src:bool = true
        out:bool = src
      }
    }
  }`))
	b := binding(t, tm, 1)
	if b.Expr == nil || b.Expr.Combine == nil {
		t.Fatal("expected combine expr")
	}
	if b.Expr.Combine.Fn != "bool_and" {
		t.Errorf("fn = %q, want bool_and", b.Expr.Combine.Fn)
	}
	if b.Expr.Combine.Args[0].Ref == nil || *b.Expr.Combine.Args[0].Ref != "src" {
		t.Errorf("arg[0].ref = %v", b.Expr.Combine.Args[0].Ref)
	}
	if bv, ok := b.Expr.Combine.Args[1].Lit.Kind.(*structpb.Value_BoolValue); !ok || !bv.BoolValue {
		t.Errorf("identity arg[1]: got %T", b.Expr.Combine.Args[1].Lit.Kind)
	}
}

func TestLowerSingleRefNumber(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        src:number = 5
        out:number = src
      }
    }
  }`))
	b := binding(t, tm, 1)
	if b.Expr.Combine.Fn != "add" {
		t.Errorf("fn = %q, want add", b.Expr.Combine.Fn)
	}
	if nv, ok := b.Expr.Combine.Args[1].Lit.Kind.(*structpb.Value_NumberValue); !ok || nv.NumberValue != 0 {
		t.Errorf("identity lit: got %T", b.Expr.Combine.Args[1].Lit.Kind)
	}
}

func TestLowerSingleRefStr(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        src:str = "x"
        out:str = src
      }
    }
  }`))
	b := binding(t, tm, 1)
	if b.Expr.Combine.Fn != "str_concat" {
		t.Errorf("fn = %q, want str_concat", b.Expr.Combine.Fn)
	}
}

func TestLowerSingleRefArr(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        src:arr<number> = []
        out:arr<number> = src
      }
    }
  }`))
	b := binding(t, tm, 1)
	if b.Expr.Combine.Fn != "arr_concat" {
		t.Errorf("fn = %q, want arr_concat", b.Expr.Combine.Fn)
	}
}

// ─── func-call RHS ────────────────────────────────────────────────────────────

func TestLowerFuncCallRHS(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        a:number = 3
        b:number = 4
        out:number = add(a, b)
      }
    }
  }`))
	b := binding(t, tm, 2)
	if b.Expr == nil || b.Expr.Combine == nil {
		t.Fatal("expected combine")
	}
	if b.Expr.Combine.Fn != "add" {
		t.Errorf("fn = %q", b.Expr.Combine.Fn)
	}
	if len(b.Expr.Combine.Args) != 2 {
		t.Errorf("args = %d", len(b.Expr.Combine.Args))
	}
	a0, a1 := b.Expr.Combine.Args[0], b.Expr.Combine.Args[1]
	if a0.Ref == nil || *a0.Ref != "a" || a1.Ref == nil || *a1.Ref != "b" {
		t.Errorf("args: %v %v", a0.Ref, a1.Ref)
	}
}

// ─── infix RHS ────────────────────────────────────────────────────────────────

func TestLowerInfixBoolAnd(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        p:bool = true
        q:bool = false
        out:bool = p & q
      }
    }
  }`))
	b := binding(t, tm, 2)
	if b.Expr.Combine.Fn != "bool_and" {
		t.Errorf("fn = %q", b.Expr.Combine.Fn)
	}
}

func TestLowerInfixGTE(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        x:number = 5
        y:number = 3
        out:bool = x >= y
      }
    }
  }`))
	b := binding(t, tm, 2)
	if b.Expr.Combine.Fn != "gte" {
		t.Errorf("fn = %q, want gte", b.Expr.Combine.Fn)
	}
}

func TestLowerInfixPlusNumberIsAdd(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        x:number = 1
        y:number = 2
        out:number = x + y
      }
    }
  }`))
	b := binding(t, tm, 2)
	if b.Expr.Combine.Fn != "add" {
		t.Errorf("fn = %q, want add", b.Expr.Combine.Fn)
	}
}

func TestLowerInfixPlusStrIsConcat(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        p:str = "a"
        q:str = "b"
        out:str = p + q
      }
    }
  }`))
	b := binding(t, tm, 2)
	if b.Expr.Combine.Fn != "str_concat" {
		t.Errorf("fn = %q, want str_concat", b.Expr.Combine.Fn)
	}
}

// ─── placeholder RHS ──────────────────────────────────────────────────────────

func TestLowerPlaceholderWithState(t *testing.T) {
	// ~>income:number = _ with state default 100 → binding value = 100
	tm, _ := mustLower(t, `state {
  applicant {
    income:number = 100
  }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = income
      prog "p" {
        ~>income:number = _
      }
    }
    prepare {
      income { from_state = applicant.income }
    }
  }
}`)
	b := binding(t, tm, 0)
	if b.Value == nil {
		t.Fatal("expected value binding from placeholder")
	}
	if nv, ok := b.Value.Kind.(*structpb.Value_NumberValue); !ok || nv.NumberValue != 100 {
		t.Errorf("placeholder value: got %T %v, want 100", b.Value.Kind, b.Value)
	}
}

// ─── pipe RHS ─────────────────────────────────────────────────────────────────

func TestLowerPipeRHS(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number = 3
        y:number = 4
        result:number = #pipe(a:x, b:y)[
          add(a, b),
          mul({ step_ref = 0 }, a)
        ]
      }
    }
  }`))
	b := binding(t, tm, 2)
	if b.Expr == nil || b.Expr.Pipe == nil {
		t.Fatal("expected pipe expr")
	}
	pipe := b.Expr.Pipe
	if len(pipe.Params) != 2 {
		t.Errorf("params = %d, want 2", len(pipe.Params))
	}
	if pipe.Params[0].ParamName != "a" || pipe.Params[0].SourceIdent != "x" {
		t.Errorf("param[0]: %+v", pipe.Params[0])
	}
	if len(pipe.Steps) != 2 {
		t.Errorf("steps = %d, want 2", len(pipe.Steps))
	}
	if pipe.Steps[0].Fn != "add" {
		t.Errorf("step[0].fn = %q", pipe.Steps[0].Fn)
	}
	// step[1] first arg is step_ref = 0
	if pipe.Steps[1].Args[0].StepRef == nil || *pipe.Steps[1].Args[0].StepRef != 0 {
		t.Errorf("step[1].args[0]: want step_ref=0, got %+v", pipe.Steps[1].Args[0])
	}
}

// ─── cond RHS ─────────────────────────────────────────────────────────────────

func TestLowerCondRHS(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        flag:bool    = true
        thenFn:number = add(x, y)
        elseFn:number = add(x, y)
        result:number = {
          cond = {
            condition = flag
            then      = thenFn
            else      = elseFn
          }
        }
      }
    }
  }`))
	b := binding(t, tm, 3)
	if b.Expr == nil || b.Expr.Cond == nil {
		t.Fatal("expected cond expr")
	}
	cond := b.Expr.Cond
	if cond.Condition.Ref == nil || *cond.Condition.Ref != "flag" {
		t.Errorf("condition.ref = %v", cond.Condition.Ref)
	}
	if cond.Then.FuncRef == nil || *cond.Then.FuncRef != "thenFn" {
		t.Errorf("then.func_ref = %v", cond.Then.FuncRef)
	}
	if cond.ElseBranch.FuncRef == nil || *cond.ElseBranch.FuncRef != "elseFn" {
		t.Errorf("else.func_ref = %v", cond.ElseBranch.FuncRef)
	}
}

// ─── #if RHS ──────────────────────────────────────────────────────────────────

func TestLowerIfRHSBareRef(t *testing.T) {
	// #if with bare ref → single cond binding (no auto-gen)
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        flag:bool    = true
        thenFn:number = add(x, y)
        elseFn:number = add(x, y)
        result:number = #if {
          cond = flag
          then = thenFn
          else = elseFn
        }
      }
    }
  }`))
	bindings := tm.Scenes[0].Actions[0].Compute.Prog.Bindings
	// 4 bindings: flag, thenFn, elseFn, result
	if len(bindings) != 4 {
		t.Errorf("binding count = %d, want 4", len(bindings))
	}
	result := bindings[3]
	if result.Name != "result" {
		t.Errorf("last binding name = %q", result.Name)
	}
	if result.Expr.Cond.Condition.Ref == nil || *result.Expr.Cond.Condition.Ref != "flag" {
		t.Errorf("cond ref = %v", result.Expr.Cond.Condition.Ref)
	}
}

func TestLowerIfRHSCall(t *testing.T) {
	// #if with inline call → auto-generated __if_result_cond binding first
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number     = 5
        y:number     = 3
        thenFn:number = add(x, y)
        elseFn:number = add(x, y)
        result:number = #if {
          cond = gt(x, y)
          then = thenFn
          else = elseFn
        }
      }
    }
  }`))
	bindings := tm.Scenes[0].Actions[0].Compute.Prog.Bindings
	// 6 bindings: x, y, thenFn, elseFn, __if_result_cond, result
	if len(bindings) != 6 {
		t.Errorf("binding count = %d, want 6", len(bindings))
	}
	autoGen := bindings[4]
	if autoGen.Name != "__if_result_cond" {
		t.Errorf("auto-gen name = %q, want __if_result_cond", autoGen.Name)
	}
	if autoGen.Type != "bool" {
		t.Errorf("auto-gen type = %q, want bool", autoGen.Type)
	}
	if autoGen.Expr.Combine.Fn != "gt" {
		t.Errorf("auto-gen fn = %q, want gt", autoGen.Expr.Combine.Fn)
	}
	mainB := bindings[5]
	if mainB.Name != "result" {
		t.Errorf("main binding name = %q", mainB.Name)
	}
	if mainB.Expr.Cond.Condition.Ref == nil || *mainB.Expr.Cond.Condition.Ref != "__if_result_cond" {
		t.Errorf("cond ref = %v", mainB.Expr.Cond.Condition.Ref)
	}
}

// ─── sigil lowering ───────────────────────────────────────────────────────────

func TestLowerSigilIngress(t *testing.T) {
	tm, sc := mustLower(t, `state {
  app {
    score:number = 0
  }
}
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
    }
  }
}`)
	key := lower.BindingKey{SceneID: "test", ActionID: "a", ProgName: "p", BindingName: "score"}
	if sc.Sigils[key] != ast.SigilIngress {
		t.Errorf("sigil = %v, want Ingress", sc.Sigils[key])
	}
	b := binding(t, tm, 0)
	if b.Value == nil {
		t.Error("expected value binding for ingress placeholder")
	}
	prep := tm.Scenes[0].Actions[0].Prepare
	if len(prep) != 1 {
		t.Fatalf("expected 1 prepare entry, got %d", len(prep))
	}
	if prep[0].Binding != "score" || prep[0].FromState == nil || *prep[0].FromState != "app.score" {
		t.Errorf("prepare entry: binding=%q fromState=%v", prep[0].Binding, prep[0].FromState)
	}
}

func TestLowerSigilEgress(t *testing.T) {
	tm, sc := mustLower(t, `state {
  app { approved:bool = false }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = approved
      prog "p" {
        <~approved:bool = true
      }
    }
    merge {
      approved { to_state = app.approved }
    }
  }
}`)
	key := lower.BindingKey{SceneID: "test", ActionID: "a", ProgName: "p", BindingName: "approved"}
	if sc.Sigils[key] != ast.SigilEgress {
		t.Errorf("sigil = %v, want Egress", sc.Sigils[key])
	}
	mg := tm.Scenes[0].Actions[0].Merge
	if len(mg) != 1 {
		t.Fatalf("expected 1 merge entry, got %d", len(mg))
	}
	if mg[0].ToState != "app.approved" {
		t.Errorf("to_state = %q", mg[0].ToState)
	}
}

func TestLowerSigilBiDir(t *testing.T) {
	tm, sc := mustLower(t, `state {
  app { count:number = 0 }
}
scene "test" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = count
      prog "p" {
        <~>count:number = _
      }
    }
    prepare {
      count { from_state = app.count }
    }
    merge {
      count { to_state = app.count }
    }
  }
}`)
	key := lower.BindingKey{SceneID: "test", ActionID: "a", ProgName: "p", BindingName: "count"}
	if sc.Sigils[key] != ast.SigilBiDir {
		t.Errorf("sigil = %v, want BiDir", sc.Sigils[key])
	}
	if len(tm.Scenes[0].Actions[0].Prepare) == 0 {
		t.Error("expected prepare entries")
	}
	if len(tm.Scenes[0].Actions[0].Merge) == 0 {
		t.Error("expected merge entries")
	}
}

// ─── docstring lowering ───────────────────────────────────────────────────────

func TestLowerDocstringTrimming(t *testing.T) {
	_, sc := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    """
    Hello world.
    """
    compute { root = v prog "p" { v:bool = true } }
  }`))
	meta, ok := sc.Actions["test/a"]
	if !ok || meta.Text == nil {
		t.Fatal("action text not found in sidecar")
	}
	text := meta.Text
	if strings.HasPrefix(*text, "\n") {
		t.Errorf("text has leading newline: %q", *text)
	}
	if strings.HasSuffix(*text, "\n") {
		t.Errorf("text has trailing newline: %q", *text)
	}
	if !strings.Contains(*text, "Hello world.") {
		t.Errorf("text = %q", *text)
	}
}

// ─── route block lowering ────────────────────────────────────────────────────

func TestLowerRouteBlock(t *testing.T) {
	tm, _ := mustLower(t, `state { ns { v:number = 0 } }
scene "scene_1" {
  entry_actions = ["a"]
  action "a" { compute { root = v prog "p" { v:bool = true } } }
}
route "route_1" {
  match {
    scene_1.*.final_action |
    scene_other.*.end
      => scene_1,
    _ => scene_1
  }
}`)
	if len(tm.Routes) != 1 {
		t.Fatalf("route count = %d, want 1", len(tm.Routes))
	}
	r := tm.Routes[0]
	if r.Id != "route_1" {
		t.Errorf("route ID = %q", r.Id)
	}
	if len(r.Match) != 2 {
		t.Fatalf("arm count = %d, want 2", len(r.Match))
	}
	arm0 := r.Match[0]
	if len(arm0.Patterns) != 2 {
		t.Errorf("arm[0] patterns = %d, want 2", len(arm0.Patterns))
	}
	if arm0.Patterns[0] != "scene_1.*.final_action" {
		t.Errorf("arm[0].patterns[0] = %q", arm0.Patterns[0])
	}
	if arm0.Patterns[1] != "scene_other.*.end" {
		t.Errorf("arm[0].patterns[1] = %q", arm0.Patterns[1])
	}
	if arm0.Target != "scene_1" {
		t.Errorf("arm[0].target = %q", arm0.Target)
	}
	arm1 := r.Match[1]
	if arm1.Patterns[0] != "_" {
		t.Errorf("fallback pattern = %q", arm1.Patterns[0])
	}
}

// ─── publish lowering ─────────────────────────────────────────────────────────

func TestLowerPublishBlock(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    publish {
      hook = "hook_a"
      hook = "hook_b"
    }
  }`))
	pub := tm.Scenes[0].Actions[0].Publish
	if len(pub) != 2 {
		t.Fatalf("publish hooks = %v", pub)
	}
	if pub[0] != "hook_a" || pub[1] != "hook_b" {
		t.Errorf("hooks = %v", pub)
	}
}

// ─── next rule lowering ───────────────────────────────────────────────────────

func TestLowerNextRule(t *testing.T) {
	tm, _ := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    next {
      compute {
        condition = go
        prog "n" { go:bool = true }
      }
      action = b
    }
  }
  action "b" {
    compute { root = v prog "p" { v:bool = true } }
  }`))
	rules := tm.Scenes[0].Actions[0].Next
	if len(rules) != 1 {
		t.Fatalf("next rules = %d, want 1", len(rules))
	}
	nr := rules[0]
	if nr.Action != "b" {
		t.Errorf("action = %q", nr.Action)
	}
	if nr.Compute == nil || nr.Compute.Condition != "go" {
		t.Errorf("compute.condition = %q", nr.Compute.Condition)
	}
}

// ─── idempotency ─────────────────────────────────────────────────────────────

func TestLowerIdempotency(t *testing.T) {
	// Lower the same source twice; check struct equality at the string level
	// by rendering the scene ID and action count.
	src := minimal(`  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
  }`)
	m1, _ := mustLower(t, src)
	m2, _ := mustLower(t, src)
	if m1.Scenes[0].Id != m2.Scenes[0].Id {
		t.Errorf("scene ID differs: %q vs %q", m1.Scenes[0].Id, m2.Scenes[0].Id)
	}
	if len(m1.Scenes[0].Actions) != len(m2.Scenes[0].Actions) {
		t.Errorf("action count differs: %d vs %d", len(m1.Scenes[0].Actions), len(m2.Scenes[0].Actions))
	}
}
