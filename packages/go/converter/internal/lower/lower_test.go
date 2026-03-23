package lower_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/turnout/converter/internal/ast"
	"github.com/turnout/converter/internal/lower"
	"github.com/turnout/converter/internal/parser"
	"github.com/turnout/converter/internal/state"
)

// ─── helpers ──────────────────────────────────────────────────────────────────

// mustLower parses src, resolves state, and lowers to a Model.
func mustLower(t *testing.T, src string) *lower.Model {
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
	model, ds3 := lower.Lower(tf, schema)
	if ds3.HasErrors() {
		for _, d := range ds3 {
			t.Logf("lower diag: %s", d.Format())
		}
		t.Fatalf("lower failed")
	}
	return model
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
func binding(t *testing.T, model *lower.Model, n int) *lower.HCLBinding {
	t.Helper()
	b := model.Scenes[0].Actions[0].Compute.Prog.Bindings
	if n >= len(b) {
		t.Fatalf("binding index %d out of range (have %d)", n, len(b))
	}
	return b[n]
}

// ─── state block lowering ─────────────────────────────────────────────────────

func TestLowerStateBlockInline(t *testing.T) {
	model := mustLower(t, `state {
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
	if model.State == nil {
		t.Fatal("model.State is nil")
	}
	if len(model.State.Namespaces) != 2 {
		t.Fatalf("namespace count = %d, want 2", len(model.State.Namespaces))
	}
	ns0 := model.State.Namespaces[0]
	if ns0.Name != "applicant" {
		t.Errorf("ns[0].Name = %q", ns0.Name)
	}
	if len(ns0.Fields) != 2 {
		t.Errorf("ns[0] fields = %d, want 2", len(ns0.Fields))
	}
	if ns0.Fields[0].Name != "income" || ns0.Fields[0].Type != ast.FieldTypeNumber {
		t.Errorf("field[0]: name=%q type=%v", ns0.Fields[0].Name, ns0.Fields[0].Type)
	}
	n, ok := ns0.Fields[0].Default.(*ast.NumberLiteral)
	if !ok || n.Value != 42 {
		t.Errorf("field[0] default: got %T %v", ns0.Fields[0].Default, ns0.Fields[0].Default)
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
	model, ds3 := lower.Lower(tf, schema)
	if ds3.HasErrors() {
		t.Fatalf("lower: %v", ds3)
	}
	// state_file directive → state block reconstructed from schema (sorted)
	if model.State == nil || len(model.State.Namespaces) != 1 {
		t.Fatalf("want 1 namespace, got %v", model.State)
	}
	if model.State.Namespaces[0].Name != "app" {
		t.Errorf("ns name = %q", model.State.Namespaces[0].Name)
	}
}

// ─── literal RHS ──────────────────────────────────────────────────────────────

func TestLowerLiteralRHS(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
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
	bindings := model.Scenes[0].Actions[0].Compute.Prog.Bindings

	// n:number = 99
	if bindings[0].Value == nil {
		t.Fatal("n: expected value binding")
	}
	if num, ok := bindings[0].Value.(*ast.NumberLiteral); !ok || num.Value != 99 {
		t.Errorf("n value: got %T %v", bindings[0].Value, bindings[0].Value)
	}

	// s:str = "hi"
	if s, ok := bindings[1].Value.(*ast.StringLiteral); !ok || s.Value != "hi" {
		t.Errorf("s value: got %T", bindings[1].Value)
	}

	// b:bool = true
	if bl, ok := bindings[2].Value.(*ast.BoolLiteral); !ok || !bl.Value {
		t.Errorf("b value: got %T", bindings[2].Value)
	}

	// xs:arr<number> = [1, 2]
	if arr, ok := bindings[3].Value.(*ast.ArrayLiteral); !ok || len(arr.Elements) != 2 {
		t.Errorf("xs value: got %T len=%v", bindings[3].Value, bindings[3])
	}
}

// ─── single-ref RHS (identity combine) ────────────────────────────────────────

func TestLowerSingleRefBool(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        src:bool = true
        out:bool = src
      }
    }
  }`))
	b := binding(t, model, 1)
	if b.Expr == nil || b.Expr.Combine == nil {
		t.Fatal("expected combine expr")
	}
	if b.Expr.Combine.Fn != "bool_and" {
		t.Errorf("fn = %q, want bool_and", b.Expr.Combine.Fn)
	}
	if b.Expr.Combine.Args[0].Ref != "src" {
		t.Errorf("arg[0].ref = %q", b.Expr.Combine.Args[0].Ref)
	}
	if lit, ok := b.Expr.Combine.Args[1].Lit.(*ast.BoolLiteral); !ok || !lit.Value {
		t.Errorf("identity arg[1]: got %T", b.Expr.Combine.Args[1].Lit)
	}
}

func TestLowerSingleRefNumber(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        src:number = 5
        out:number = src
      }
    }
  }`))
	b := binding(t, model, 1)
	if b.Expr.Combine.Fn != "add" {
		t.Errorf("fn = %q, want add", b.Expr.Combine.Fn)
	}
	if lit, ok := b.Expr.Combine.Args[1].Lit.(*ast.NumberLiteral); !ok || lit.Value != 0 {
		t.Errorf("identity lit: got %T", b.Expr.Combine.Args[1].Lit)
	}
}

func TestLowerSingleRefStr(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        src:str = "x"
        out:str = src
      }
    }
  }`))
	b := binding(t, model, 1)
	if b.Expr.Combine.Fn != "str_concat" {
		t.Errorf("fn = %q, want str_concat", b.Expr.Combine.Fn)
	}
}

func TestLowerSingleRefArr(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute {
      root = out
      prog "p" {
        src:arr<number> = []
        out:arr<number> = src
      }
    }
  }`))
	b := binding(t, model, 1)
	if b.Expr.Combine.Fn != "arr_concat" {
		t.Errorf("fn = %q, want arr_concat", b.Expr.Combine.Fn)
	}
}

// ─── func-call RHS ────────────────────────────────────────────────────────────

func TestLowerFuncCallRHS(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
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
	b := binding(t, model, 2)
	if b.Expr == nil || b.Expr.Combine == nil {
		t.Fatal("expected combine")
	}
	if b.Expr.Combine.Fn != "add" {
		t.Errorf("fn = %q", b.Expr.Combine.Fn)
	}
	if len(b.Expr.Combine.Args) != 2 {
		t.Errorf("args = %d", len(b.Expr.Combine.Args))
	}
	if b.Expr.Combine.Args[0].Ref != "a" || b.Expr.Combine.Args[1].Ref != "b" {
		t.Errorf("args: %v", b.Expr.Combine.Args)
	}
}

// ─── infix RHS ────────────────────────────────────────────────────────────────

func TestLowerInfixBoolAnd(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
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
	b := binding(t, model, 2)
	if b.Expr.Combine.Fn != "bool_and" {
		t.Errorf("fn = %q", b.Expr.Combine.Fn)
	}
}

func TestLowerInfixGTE(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
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
	b := binding(t, model, 2)
	if b.Expr.Combine.Fn != "gte" {
		t.Errorf("fn = %q, want gte", b.Expr.Combine.Fn)
	}
}

func TestLowerInfixPlusNumberIsAdd(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
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
	b := binding(t, model, 2)
	if b.Expr.Combine.Fn != "add" {
		t.Errorf("fn = %q, want add", b.Expr.Combine.Fn)
	}
}

func TestLowerInfixPlusStrIsConcat(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
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
	b := binding(t, model, 2)
	if b.Expr.Combine.Fn != "str_concat" {
		t.Errorf("fn = %q, want str_concat", b.Expr.Combine.Fn)
	}
}

// ─── placeholder RHS ──────────────────────────────────────────────────────────

func TestLowerPlaceholderWithState(t *testing.T) {
	// ~>income:number = _ with state default 100 → binding value = 100
	model := mustLower(t, `state {
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
	b := binding(t, model, 0)
	if b.Value == nil {
		t.Fatal("expected value binding from placeholder")
	}
	num, ok := b.Value.(*ast.NumberLiteral)
	if !ok || num.Value != 100 {
		t.Errorf("placeholder value: got %T %v, want 100", b.Value, b.Value)
	}
}

// ─── pipe RHS ─────────────────────────────────────────────────────────────────

func TestLowerPipeRHS(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
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
	b := binding(t, model, 2)
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
	if !pipe.Steps[1].Args[0].IsStepRef || pipe.Steps[1].Args[0].StepRef != 0 {
		t.Errorf("step[1].args[0]: want step_ref=0, got %+v", pipe.Steps[1].Args[0])
	}
}

// ─── cond RHS ─────────────────────────────────────────────────────────────────

func TestLowerCondRHS(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
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
	b := binding(t, model, 3)
	if b.Expr == nil || b.Expr.Cond == nil {
		t.Fatal("expected cond expr")
	}
	cond := b.Expr.Cond
	if cond.Condition.Ref != "flag" {
		t.Errorf("condition.ref = %q", cond.Condition.Ref)
	}
	if cond.Then.FuncRef != "thenFn" {
		t.Errorf("then.func_ref = %q", cond.Then.FuncRef)
	}
	if cond.Else.FuncRef != "elseFn" {
		t.Errorf("else.func_ref = %q", cond.Else.FuncRef)
	}
}

// ─── #if RHS ──────────────────────────────────────────────────────────────────

func TestLowerIfRHSBareRef(t *testing.T) {
	// #if with bare ref → single cond binding (no auto-gen)
	model := mustLower(t, minimal(`  entry_actions = ["a"]
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
	bindings := model.Scenes[0].Actions[0].Compute.Prog.Bindings
	// 4 bindings: flag, thenFn, elseFn, result
	if len(bindings) != 4 {
		t.Errorf("binding count = %d, want 4", len(bindings))
	}
	result := bindings[3]
	if result.Name != "result" {
		t.Errorf("last binding name = %q", result.Name)
	}
	if result.Expr.Cond.Condition.Ref != "flag" {
		t.Errorf("cond ref = %q", result.Expr.Cond.Condition.Ref)
	}
}

func TestLowerIfRHSCall(t *testing.T) {
	// #if with inline call → auto-generated __if_result_cond binding first
	model := mustLower(t, minimal(`  entry_actions = ["a"]
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
	bindings := model.Scenes[0].Actions[0].Compute.Prog.Bindings
	// 6 bindings: x, y, thenFn, elseFn, __if_result_cond, result
	if len(bindings) != 6 {
		t.Errorf("binding count = %d, want 6", len(bindings))
	}
	autoGen := bindings[4]
	if autoGen.Name != "__if_result_cond" {
		t.Errorf("auto-gen name = %q, want __if_result_cond", autoGen.Name)
	}
	if autoGen.Type != ast.FieldTypeBool {
		t.Errorf("auto-gen type = %v, want bool", autoGen.Type)
	}
	if autoGen.Expr.Combine.Fn != "gt" {
		t.Errorf("auto-gen fn = %q, want gt", autoGen.Expr.Combine.Fn)
	}
	mainB := bindings[5]
	if mainB.Name != "result" {
		t.Errorf("main binding name = %q", mainB.Name)
	}
	if mainB.Expr.Cond.Condition.Ref != "__if_result_cond" {
		t.Errorf("cond ref = %q", mainB.Expr.Cond.Condition.Ref)
	}
}

// ─── sigil lowering ───────────────────────────────────────────────────────────

func TestLowerSigilIngress(t *testing.T) {
	model := mustLower(t, `state {
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
	b := binding(t, model, 0)
	if b.Sigil != ast.SigilIngress {
		t.Errorf("sigil = %v, want Ingress", b.Sigil)
	}
	if b.Value == nil {
		t.Error("expected value binding for ingress placeholder")
	}
	prep := model.Scenes[0].Actions[0].Prepare
	if prep == nil || len(prep.Entries) != 1 {
		t.Fatal("expected 1 prepare entry")
	}
	if prep.Entries[0].BindingName != "score" || prep.Entries[0].FromState != "app.score" {
		t.Errorf("prepare entry: %+v", prep.Entries[0])
	}
}

func TestLowerSigilEgress(t *testing.T) {
	model := mustLower(t, `state {
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
	b := binding(t, model, 0)
	if b.Sigil != ast.SigilEgress {
		t.Errorf("sigil = %v, want Egress", b.Sigil)
	}
	mg := model.Scenes[0].Actions[0].Merge
	if mg == nil || len(mg.Entries) != 1 {
		t.Fatal("expected 1 merge entry")
	}
	if mg.Entries[0].ToState != "app.approved" {
		t.Errorf("to_state = %q", mg.Entries[0].ToState)
	}
}

func TestLowerSigilBiDir(t *testing.T) {
	model := mustLower(t, `state {
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
	b := binding(t, model, 0)
	if b.Sigil != ast.SigilBiDir {
		t.Errorf("sigil = %v, want BiDir", b.Sigil)
	}
	if model.Scenes[0].Actions[0].Prepare == nil {
		t.Error("expected prepare block")
	}
	if model.Scenes[0].Actions[0].Merge == nil {
		t.Error("expected merge block")
	}
}

// ─── docstring lowering ───────────────────────────────────────────────────────

func TestLowerDocstringTrimming(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    """
    Hello world.
    """
    compute { root = v prog "p" { v:bool = true } }
  }`))
	text := model.Scenes[0].Actions[0].Text
	if text == nil {
		t.Fatal("action.Text is nil")
	}
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
	model := mustLower(t, `state { ns { v:number = 0 } }
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
	if len(model.Routes) != 1 {
		t.Fatalf("route count = %d, want 1", len(model.Routes))
	}
	r := model.Routes[0]
	if r.ID != "route_1" {
		t.Errorf("route ID = %q", r.ID)
	}
	if len(r.Arms) != 2 {
		t.Fatalf("arm count = %d, want 2", len(r.Arms))
	}
	arm0 := r.Arms[0]
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
	arm1 := r.Arms[1]
	if arm1.Patterns[0] != "_" {
		t.Errorf("fallback pattern = %q", arm1.Patterns[0])
	}
}

// ─── publish lowering ─────────────────────────────────────────────────────────

func TestLowerPublishBlock(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    publish {
      hook = "hook_a"
      hook = "hook_b"
    }
  }`))
	pub := model.Scenes[0].Actions[0].Publish
	if pub == nil || len(pub.Hooks) != 2 {
		t.Fatalf("publish hooks = %v", pub)
	}
	if pub.Hooks[0] != "hook_a" || pub.Hooks[1] != "hook_b" {
		t.Errorf("hooks = %v", pub.Hooks)
	}
}

// ─── next rule lowering ───────────────────────────────────────────────────────

func TestLowerNextRule(t *testing.T) {
	model := mustLower(t, minimal(`  entry_actions = ["a"]
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
	rules := model.Scenes[0].Actions[0].Next
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
	m1 := mustLower(t, src)
	m2 := mustLower(t, src)
	if m1.Scenes[0].ID != m2.Scenes[0].ID {
		t.Errorf("scene ID differs: %q vs %q", m1.Scenes[0].ID, m2.Scenes[0].ID)
	}
	if len(m1.Scenes[0].Actions) != len(m2.Scenes[0].Actions) {
		t.Errorf("action count differs: %d vs %d", len(m1.Scenes[0].Actions), len(m2.Scenes[0].Actions))
	}
}
