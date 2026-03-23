package parser_test

import (
	"os"
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
)

// minimalTurnFile wraps a scene body in the minimum scaffolding required for a
// valid Turn DSL file (inline state block + scene block).
func minimalTurnFile(sceneBody string) string {
	return `state {
  ns {
    val:number = 0
  }
}
scene "test" {
` + sceneBody + "\n}\n"
}

// ── helpers ───────────────────────────────────────────────────────────────────

func mustParse(t *testing.T, src string) *ast.TurnFile {
	t.Helper()
	tf, diags := parser.ParseFile("test.turn", src)
	if diags.HasErrors() {
		for _, d := range diags {
			t.Logf("diagnostic: %s", d.Format())
		}
		t.Fatalf("parse failed with errors")
	}
	return tf
}

func mustParseFail(t *testing.T, src string) {
	t.Helper()
	_, diags := parser.ParseFile("test.turn", src)
	if !diags.HasErrors() {
		t.Fatal("expected parse errors but got none")
	}
}

// ── state source ──────────────────────────────────────────────────────────────

func TestParseInlineStateBlock(t *testing.T) {
	src := `state {
  applicant {
    income:number = 0
    debt:number   = 100
  }
  decision {
    approved:bool = false
    status:str    = ""
  }
}
scene "s" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" { v:bool = true }
    }
  }
}
`
	tf := mustParse(t, src)
	ib, ok := tf.StateSource.(*ast.InlineStateBlock)
	if !ok {
		t.Fatalf("expected *InlineStateBlock, got %T", tf.StateSource)
	}
	if len(ib.Namespaces) != 2 {
		t.Fatalf("namespace count = %d, want 2", len(ib.Namespaces))
	}
	ns := ib.Namespaces[0]
	if ns.Name != "applicant" {
		t.Errorf("ns[0].Name = %q, want %q", ns.Name, "applicant")
	}
	if len(ns.Fields) != 2 {
		t.Errorf("ns[0] field count = %d, want 2", len(ns.Fields))
	}
	f := ns.Fields[0]
	if f.Name != "income" || f.Type != ast.FieldTypeNumber {
		t.Errorf("field: name=%q type=%v", f.Name, f.Type)
	}
	if n, ok := f.Default.(*ast.NumberLiteral); !ok || n.Value != 0 {
		t.Errorf("field default: got %T", f.Default)
	}
}

func TestParseStateFileDirective(t *testing.T) {
	src := `state_file = "loan.state.turn"

scene "s" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = v
      prog "p" { v:bool = true }
    }
  }
}
`
	tf := mustParse(t, src)
	sd, ok := tf.StateSource.(*ast.StateFileDirective)
	if !ok {
		t.Fatalf("expected *StateFileDirective, got %T", tf.StateSource)
	}
	if sd.Path != "loan.state.turn" {
		t.Errorf("path = %q, want %q", sd.Path, "loan.state.turn")
	}
}

func TestMissingStateSourceError(t *testing.T) {
	src := `scene "s" {
  entry_actions = ["a"]
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
  }
}
`
	mustParseFail(t, src)
}

func TestConflictingStateSourceError(t *testing.T) {
	src := `state {}
state_file = "x.turn"
scene "s" { entry_actions = ["a"] action "a" { compute { root = v prog "p" { v:bool = true } } } }
`
	mustParseFail(t, src)
}

// ── scene block ───────────────────────────────────────────────────────────────

func TestParseSceneBasic(t *testing.T) {
	src := `state {}
scene "loan_flow" {
  entry_actions = ["score", "init"]
  next_policy   = "first-match"
  action "score" {
    compute {
      root = decision
      prog "p" { decision:bool = true }
    }
  }
}
`
	tf := mustParse(t, src)
	sb := tf.Scenes[0]
	if sb.ID != "loan_flow" {
		t.Errorf("scene ID = %q", sb.ID)
	}
	if len(sb.EntryActions) != 2 || sb.EntryActions[0] != "score" {
		t.Errorf("entry_actions = %v", sb.EntryActions)
	}
	if sb.NextPolicy != "first-match" {
		t.Errorf("next_policy = %q", sb.NextPolicy)
	}
}

// ── view block ────────────────────────────────────────────────────────────────

func TestParseViewBlock(t *testing.T) {
	src := `state {}
scene "s" {
  view "overview" {
    flow = <<-EOT
      a |=> b
    EOT
    enforce = "at_least"
  }
  action "a" {
    compute { root = v prog "p" { v:bool = true } }
  }
}
`
	tf := mustParse(t, src)
	v := tf.Scenes[0].View
	if v == nil {
		t.Fatal("view is nil")
	}
	if v.Name != "overview" {
		t.Errorf("view name = %q", v.Name)
	}
	if !strings.Contains(v.Flow, "a |=> b") {
		t.Errorf("flow = %q", v.Flow)
	}
	if v.Enforce != "at_least" {
		t.Errorf("enforce = %q", v.Enforce)
	}
}

// ── action text / docstring ────────────────────────────────────────────────────

func TestParseActionTripleQuoteDocstring(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    """
    Hello, world.
    """
    compute { root = v prog "p" { v:bool = true } }
  }`)
	tf := mustParse(t, src)
	ab := tf.Scenes[0].Actions[0]
	if ab.Text == nil {
		t.Fatal("action.Text is nil")
	}
	if !strings.Contains(*ab.Text, "Hello, world.") {
		t.Errorf("text = %q", *ab.Text)
	}
}

func TestParseActionExplicitText(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    text = "explicit text"
    compute { root = v prog "p" { v:bool = true } }
  }`)
	tf := mustParse(t, src)
	ab := tf.Scenes[0].Actions[0]
	if ab.Text == nil || *ab.Text != "explicit text" {
		t.Errorf("text = %v", ab.Text)
	}
}

// ── compute / prog / bindings ─────────────────────────────────────────────────

func TestParseComputeBlock(t *testing.T) {
	src := minimalTurnFile(`  action "score" {
    compute {
      root = decision
      prog "score_graph" {
        income:number = 0
        <~decision:bool = true
      }
    }
  }`)
	tf := mustParse(t, src)
	ab := tf.Scenes[0].Actions[0]
	cb := ab.Compute
	if cb == nil {
		t.Fatal("compute is nil")
	}
	if cb.Root != "decision" {
		t.Errorf("root = %q", cb.Root)
	}
	pg := cb.Prog
	if pg == nil || pg.Name != "score_graph" {
		t.Fatalf("prog = %v", pg)
	}
	if len(pg.Bindings) != 2 {
		t.Fatalf("binding count = %d, want 2", len(pg.Bindings))
	}
	b0 := pg.Bindings[0]
	if b0.Name != "income" || b0.Sigil != ast.SigilNone || b0.Type != ast.FieldTypeNumber {
		t.Errorf("binding[0]: name=%q sigil=%v type=%v", b0.Name, b0.Sigil, b0.Type)
	}
	b1 := pg.Bindings[1]
	if b1.Sigil != ast.SigilEgress || b1.Name != "decision" {
		t.Errorf("binding[1]: sigil=%v name=%q", b1.Sigil, b1.Name)
	}
}

func TestParseSigils(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = x
      prog "p" {
        ~>a:number = _
        <~b:bool   = true
        <~>c:str   = ""
        d:number   = 0
      }
    }
  }`)
	tf := mustParse(t, src)
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
	cases := []struct {
		name  string
		sigil ast.Sigil
	}{
		{"a", ast.SigilIngress},
		{"b", ast.SigilEgress},
		{"c", ast.SigilBiDir},
		{"d", ast.SigilNone},
	}
	for i, tc := range cases {
		if bindings[i].Name != tc.name || bindings[i].Sigil != tc.sigil {
			t.Errorf("binding[%d]: name=%q sigil=%v, want name=%q sigil=%v",
				i, bindings[i].Name, bindings[i].Sigil, tc.name, tc.sigil)
		}
	}
}

// ── RHS forms ─────────────────────────────────────────────────────────────────

func TestRHSLiteralForms(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = v
      prog "p" {
        n:number       = 42
        s:str          = "hello"
        b:bool         = false
        xs:arr<number> = [1, 2, 3]
      }
    }
  }`)
	tf := mustParse(t, src)
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings

	if r, ok := bindings[0].RHS.(*ast.LiteralRHS); !ok {
		t.Errorf("n RHS: got %T", bindings[0].RHS)
	} else if n, ok2 := r.Value.(*ast.NumberLiteral); !ok2 || n.Value != 42 {
		t.Errorf("n value: got %T %v", r.Value, r.Value)
	}

	if r, ok := bindings[1].RHS.(*ast.LiteralRHS); !ok {
		t.Errorf("s RHS: got %T", bindings[1].RHS)
	} else if s, ok2 := r.Value.(*ast.StringLiteral); !ok2 || s.Value != "hello" {
		t.Errorf("s value: got %q", s.Value)
	}

	if r, ok := bindings[2].RHS.(*ast.LiteralRHS); !ok {
		t.Errorf("b RHS: got %T", bindings[2].RHS)
	} else if bl, ok2 := r.Value.(*ast.BoolLiteral); !ok2 || bl.Value != false {
		t.Errorf("b value: got %v", bl.Value)
	}

	if r, ok := bindings[3].RHS.(*ast.LiteralRHS); !ok {
		t.Errorf("xs RHS: got %T", bindings[3].RHS)
	} else if arr, ok2 := r.Value.(*ast.ArrayLiteral); !ok2 || len(arr.Elements) != 3 {
		t.Errorf("xs value: got %T len=%d", r.Value, len(arr.Elements))
	}
}

func TestRHSPlaceholder(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = v
      prog "p" {
        ~>v:number = _
      }
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	if _, ok := b.RHS.(*ast.PlaceholderRHS); !ok {
		t.Errorf("RHS: got %T, want *PlaceholderRHS", b.RHS)
	}
}

func TestRHSSingleRef(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = out
      prog "p" {
        v:number = 5
        out:number = v
      }
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[1]
	if sr, ok := b.RHS.(*ast.SingleRefRHS); !ok || sr.RefName != "v" {
		t.Errorf("RHS: got %T, want *SingleRefRHS{v}", b.RHS)
	}
}

func TestRHSFuncCall(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = out
      prog "p" {
        v1:number = 5
        v2:number = 3
        out:number = add(v1, v2)
      }
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[2]
	fc, ok := b.RHS.(*ast.FuncCallRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *FuncCallRHS", b.RHS)
	}
	if fc.FnAlias != "add" || len(fc.Args) != 2 {
		t.Errorf("fn=%q args=%d", fc.FnAlias, len(fc.Args))
	}
}

func TestRHSNamedFuncCall(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = out
      prog "p" {
        v1:number = 5
        v2:number = 3
        out:number = add(a: v1, b: v2)
      }
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[2]
	fc, ok := b.RHS.(*ast.FuncCallRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *FuncCallRHS", b.RHS)
	}
	// named args are normalized to positional
	if len(fc.Args) != 2 {
		t.Errorf("args count = %d, want 2", len(fc.Args))
	}
}

func TestRHSInfixForms(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = out
      prog "p" {
        a:number   = 5
        b:number   = 3
        ge:bool    = a >= b
        le:bool    = a <= b
        gt:bool    = a > b
        lt:bool    = a < b
        and:bool   = ge & le
        or:bool    = ge | le
        eq:bool    = ge == le
        neq:bool   = ge != le
        sum:number = a + b
        diff:number = a - b
        prod:number = a * b
        quot:number = a / b
        rem:number  = a % b
        p:str      = "prefix"
        q:str      = "suffix"
        cat:str    = p + q
        out:bool   = true
      }
    }
  }`)
	tf := mustParse(t, src)
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
	cases := []struct {
		idx int
		op  ast.InfixOp
	}{
		{2, ast.InfixGTE},
		{3, ast.InfixLTE},
		{4, ast.InfixGT},
		{5, ast.InfixLT},
		{6, ast.InfixAnd},
		{7, ast.InfixBoolOr},
		{8, ast.InfixEq},
		{9, ast.InfixNeq},
		{10, ast.InfixPlus},
		{11, ast.InfixSub},
		{12, ast.InfixMul},
		{13, ast.InfixDiv},
		{14, ast.InfixMod},
		{17, ast.InfixPlus}, // cat:str = p + q — same InfixPlus, str context
	}
	for _, tc := range cases {
		ir, ok := bindings[tc.idx].RHS.(*ast.InfixRHS)
		if !ok {
			t.Errorf("binding[%d] (%s) RHS: got %T, want *InfixRHS",
				tc.idx, bindings[tc.idx].Name, bindings[tc.idx].RHS)
			continue
		}
		if ir.Op != tc.op {
			t.Errorf("binding[%d] (%s) op = %v, want %v",
				tc.idx, bindings[tc.idx].Name, ir.Op, tc.op)
		}
	}
}

func TestRHSPipe(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = result
      prog "p" {
        v1:number = 5
        v2:number = 3
        result:number = #pipe(x:v1, y:v2)[
          add(x, y),
          mul({ step_ref = 0 }, x)
        ]
      }
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[2]
	pr, ok := b.RHS.(*ast.PipeRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *PipeRHS", b.RHS)
	}
	if len(pr.Params) != 2 {
		t.Errorf("param count = %d, want 2", len(pr.Params))
	}
	if pr.Params[0].ParamName != "x" || pr.Params[0].SourceIdent != "v1" {
		t.Errorf("param[0]: %+v", pr.Params[0])
	}
	if len(pr.Steps) != 2 {
		t.Errorf("step count = %d, want 2", len(pr.Steps))
	}
	// second step's first arg should be StepRefArg{0}
	sa, ok := pr.Steps[1].Args[0].(*ast.StepRefArg)
	if !ok || sa.Index != 0 {
		t.Errorf("step[1].args[0]: got %T", pr.Steps[1].Args[0])
	}
}

func TestRHSCondBlock(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = result
      prog "p" {
        flag:bool    = true
        addFn:number = add(v1, v2)
        subFn:number = add(v1, v2)
        result:number = {
          cond = {
            condition = flag
            then      = addFn
            else      = subFn
          }
        }
      }
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[3]
	cr, ok := b.RHS.(*ast.CondRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *CondRHS", b.RHS)
	}
	ref, ok := cr.Condition.(*ast.CondExprRef)
	if !ok || ref.BindingName != "flag" {
		t.Errorf("condition: got %T", cr.Condition)
	}
	if cr.Then != "addFn" || cr.Else != "subFn" {
		t.Errorf("then=%q else=%q", cr.Then, cr.Else)
	}
}

func TestRHSIfInlineCall(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = result
      prog "p" {
        v1:number    = 10
        v2:number    = 3
        addFn:number = add(v1, v2)
        subFn:number = add(v1, v2)
        result:number = #if {
          cond = gt(v1, v2)
          then = addFn
          else = subFn
        }
      }
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[4]
	ir, ok := b.RHS.(*ast.IfRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *IfRHS", b.RHS)
	}
	call, ok := ir.Cond.(*ast.CondExprCall)
	if !ok || call.FnAlias != "gt" || len(call.Args) != 2 {
		t.Errorf("cond: got %T", ir.Cond)
	}
	if ir.Then != "addFn" || ir.Else != "subFn" {
		t.Errorf("then=%q else=%q", ir.Then, ir.Else)
	}
}

func TestRHSIfBareRef(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = result
      prog "p" {
        flag:bool    = true
        addFn:number = add(v1, v2)
        subFn:number = add(v1, v2)
        result:number = #if {
          cond = flag
          then = addFn
          else = subFn
        }
      }
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[3]
	ir, ok := b.RHS.(*ast.IfRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *IfRHS", b.RHS)
	}
	ref, ok := ir.Cond.(*ast.CondExprRef)
	if !ok || ref.BindingName != "flag" {
		t.Errorf("cond: got %T %v", ir.Cond, ir.Cond)
	}
}

// ── prepare / merge / publish ─────────────────────────────────────────────────

func TestParsePrepareBlock(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = v
      prog "p" {
        ~>income:number = _
        v:bool = true
      }
    }
    prepare {
      income { from_state = applicant.income }
    }
  }`)
	tf := mustParse(t, src)
	pb := tf.Scenes[0].Actions[0].Prepare
	if pb == nil || len(pb.Entries) != 1 {
		t.Fatalf("prepare entries = %v", pb)
	}
	e := pb.Entries[0]
	if e.BindingName != "income" {
		t.Errorf("binding name = %q", e.BindingName)
	}
	fs, ok := e.Source.(*ast.FromState)
	if !ok || fs.Path != "applicant.income" {
		t.Errorf("source: got %T %v", e.Source, e.Source)
	}
}

func TestParsePrepareFromHook(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute { root = v prog "p" { ~>data:str = _ v:bool = true } }
    prepare {
      data { from_hook = "score_api" }
    }
  }`)
	tf := mustParse(t, src)
	e := tf.Scenes[0].Actions[0].Prepare.Entries[0]
	fh, ok := e.Source.(*ast.FromHook)
	if !ok || fh.HookName != "score_api" {
		t.Errorf("source: got %T %v", e.Source, e.Source)
	}
}

func TestParseMergeBlock(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = v
      prog "p" {
        <~decision:bool = true
        v:bool = true
      }
    }
    merge {
      decision { to_state = decision.approved }
    }
  }`)
	tf := mustParse(t, src)
	mb := tf.Scenes[0].Actions[0].Merge
	if mb == nil || len(mb.Entries) != 1 {
		t.Fatalf("merge entries = %v", mb)
	}
	e := mb.Entries[0]
	if e.BindingName != "decision" || e.ToState != "decision.approved" {
		t.Errorf("entry: name=%q toState=%q", e.BindingName, e.ToState)
	}
}

func TestParsePublishBlock(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    publish {
      hook = "audit_hook"
      hook = "notify_hook"
    }
  }`)
	tf := mustParse(t, src)
	pub := tf.Scenes[0].Actions[0].Publish
	if pub == nil || len(pub.Hooks) != 2 {
		t.Fatalf("publish hooks = %v", pub)
	}
	if pub.Hooks[0] != "audit_hook" || pub.Hooks[1] != "notify_hook" {
		t.Errorf("hooks = %v", pub.Hooks)
	}
}

// ── next rules ────────────────────────────────────────────────────────────────

func TestParseNextBlock(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = v
      prog "p" {
        <~decision:bool = true
        v:bool = true
      }
    }
    next {
      compute {
        condition = go
        prog "to_approve" {
          ~>decision:bool = _
          go:bool = decision
        }
      }
      prepare {
        decision { from_action = decision }
      }
      action = approve
    }
  }`)
	tf := mustParse(t, src)
	rules := tf.Scenes[0].Actions[0].Next
	if len(rules) != 1 {
		t.Fatalf("next rule count = %d", len(rules))
	}
	r := rules[0]
	if r.ActionID != "approve" {
		t.Errorf("actionID = %q", r.ActionID)
	}
	if r.Compute == nil || r.Compute.Condition != "go" {
		t.Errorf("compute.condition = %q", r.Compute.Condition)
	}
	if r.Prepare == nil || len(r.Prepare.Entries) != 1 {
		t.Fatalf("prepare entries = %v", r.Prepare)
	}
	pe := r.Prepare.Entries[0]
	fa, ok := pe.Source.(*ast.FromAction)
	if !ok || fa.BindingName != "decision" {
		t.Errorf("source: got %T %v", pe.Source, pe.Source)
	}
}

func TestParseNextFromState(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    next {
      compute { condition = always prog "n" { always:bool = true } }
      prepare {
        x { from_state = ns.field }
      }
      action = b
    }
  }`)
	tf := mustParse(t, src)
	pe := tf.Scenes[0].Actions[0].Next[0].Prepare.Entries[0]
	fs, ok := pe.Source.(*ast.FromState)
	if !ok || fs.Path != "ns.field" {
		t.Errorf("source: got %T %v", pe.Source, pe.Source)
	}
}

func TestParseNextFromLiteral(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute { root = v prog "p" { v:bool = true } }
    next {
      compute { condition = always prog "n" { always:bool = true } }
      prepare {
        x { from_literal = 42 }
      }
      action = b
    }
  }`)
	tf := mustParse(t, src)
	pe := tf.Scenes[0].Actions[0].Next[0].Prepare.Entries[0]
	fl, ok := pe.Source.(*ast.FromLiteral)
	if !ok {
		t.Fatalf("source: got %T", pe.Source)
	}
	n, ok := fl.Value.(*ast.NumberLiteral)
	if !ok || n.Value != 42 {
		t.Errorf("literal: got %T %v", fl.Value, fl.Value)
	}
}

// ── reference normalization ───────────────────────────────────────────────────

func TestReferenceNormalization(t *testing.T) {
	// Both bare and quoted forms should produce the same string.
	srcBare := minimalTurnFile(`  action "a" {
    compute {
      root = decision
      prog "p" { decision:bool = true }
    }
    merge { decision { to_state = ns.field } }
  }`)
	srcQuoted := minimalTurnFile(`  action "a" {
    compute {
      root = "decision"
      prog "p" { decision:bool = true }
    }
    merge { decision { to_state = "ns.field" } }
  }`)

	tf1 := mustParse(t, srcBare)
	tf2 := mustParse(t, srcQuoted)

	if tf1.Scenes[0].Actions[0].Compute.Root != tf2.Scenes[0].Actions[0].Compute.Root {
		t.Errorf("root differs: %q vs %q",
			tf1.Scenes[0].Actions[0].Compute.Root,
			tf2.Scenes[0].Actions[0].Compute.Root)
	}
	if tf1.Scenes[0].Actions[0].Merge.Entries[0].ToState !=
		tf2.Scenes[0].Actions[0].Merge.Entries[0].ToState {
		t.Error("to_state differs")
	}
}

func TestThreeSegmentPath(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute { root = v prog "p" { ~>v:number = _ } }
    prepare {
      v { from_state = session.cart.items }
    }
  }`)
	tf := mustParse(t, src)
	e := tf.Scenes[0].Actions[0].Prepare.Entries[0]
	fs, ok := e.Source.(*ast.FromState)
	if !ok || fs.Path != "session.cart.items" {
		t.Errorf("path: got %q", fs.Path)
	}
}

// ── example files ─────────────────────────────────────────────────────────────

// parseWithDummyState prepends a minimal state block to scene-only example files.
func parseWithDummyState(t *testing.T, path string) *ast.TurnFile {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("example file not found: %v", err)
	}
	src := "state {}\n" + string(data)
	return mustParse(t, src)
}

func TestExampleSceneGraphWithActions(t *testing.T) {
	tf := parseWithDummyState(t, "../../../../../spec/examples/scene-graph-with-actions.turn")
	if tf.Scenes[0].ID != "loan_flow" {
		t.Errorf("scene ID = %q", tf.Scenes[0].ID)
	}
	if len(tf.Scenes[0].Actions) != 3 {
		t.Errorf("action count = %d, want 3", len(tf.Scenes[0].Actions))
	}
	// verify nested next rules
	score := tf.Scenes[0].Actions[0]
	if len(score.Next) != 2 {
		t.Errorf("score next count = %d, want 2", len(score.Next))
	}
}

func TestExampleDetectivePhase(t *testing.T) {
	data, err := os.ReadFile("../../../../../spec/examples/detective-phase.turn")
	if err != nil {
		t.Skip("detective example not found")
	}
	src := "state {}\n" + string(data)
	tf, diags := parser.ParseFile("detective-phase.turn", src)
	if diags.HasErrors() {
		for _, d := range diags {
			t.Logf("diag: %s", d.Format())
		}
		t.Fatalf("parse failed")
	}
	if tf.Scenes[0].ID != "detective_evidence_hunt" {
		t.Errorf("scene ID = %q", tf.Scenes[0].ID)
	}
}

func TestExampleAdventureStory(t *testing.T) {
	tf := parseWithDummyState(t, "../../../../../spec/examples/adventure-story-graph-with-actions.turn")
	if tf.Scenes[0] == nil {
		t.Fatal("scene is nil")
	}
}

func TestExampleLLMWorkflow(t *testing.T) {
	tf := parseWithDummyState(t, "../../../../../spec/examples/llm-workflow-with-actions.turn")
	if tf.Scenes[0] == nil {
		t.Fatal("scene is nil")
	}
}

// ── arr<T> type in bindings ───────────────────────────────────────────────────

func TestArrTypeInStateField(t *testing.T) {
	src := `state {
  ns {
    tags:arr<str>    = []
    scores:arr<number> = []
    flags:arr<bool>  = []
  }
}
scene "s" {
  action "a" { compute { root = v prog "p" { v:bool = true } } }
}
`
	tf := mustParse(t, src)
	fields := tf.StateSource.(*ast.InlineStateBlock).Namespaces[0].Fields
	types := []ast.FieldType{ast.FieldTypeArrStr, ast.FieldTypeArrNumber, ast.FieldTypeArrBool}
	for i, f := range fields {
		if f.Type != types[i] {
			t.Errorf("field[%d] type = %v, want %v", i, f.Type, types[i])
		}
		if _, ok := f.Default.(*ast.ArrayLiteral); !ok {
			t.Errorf("field[%d] default is not ArrayLiteral", i)
		}
	}
}

// ── compat block forms ────────────────────────────────────────────────────────

func TestRHSCompatFuncBlock(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = out
      prog "p" {
        v1:number = 5
        v2:number = 3
        out:number = { add = [v1, v2] }
      }
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[2]
	fc, ok := b.RHS.(*ast.FuncCallRHS)
	if !ok || fc.FnAlias != "add" || len(fc.Args) != 2 {
		t.Errorf("RHS: got %T", b.RHS)
	}
}

// ── route block ───────────────────────────────────────────────────────────────

func TestParseRouteBlock(t *testing.T) {
	src := `state { ns { v:number = 0 } }
scene "s1" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}
route "main" {
  match {
    s1.*.done => s1,
    _ => s1
  }
}`
	tf := mustParse(t, src)
	if len(tf.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(tf.Routes))
	}
	r := tf.Routes[0]
	if r.ID != "main" {
		t.Errorf("route ID = %q, want %q", r.ID, "main")
	}
	if r.Match == nil {
		t.Fatal("route.Match is nil")
	}
	if len(r.Match.Arms) != 2 {
		t.Fatalf("expected 2 arms, got %d", len(r.Match.Arms))
	}

	// First arm: s1.*.done => s1
	arm0 := r.Match.Arms[0]
	if len(arm0.Branches) != 1 {
		t.Fatalf("arm0: expected 1 branch, got %d", len(arm0.Branches))
	}
	pe0 := arm0.Branches[0]
	if pe0.Fallback {
		t.Error("arm0: should not be fallback")
	}
	if pe0.SceneID != "s1" {
		t.Errorf("arm0 SceneID = %q, want %q", pe0.SceneID, "s1")
	}
	if len(pe0.Segments) != 2 || pe0.Segments[0] != "*" || pe0.Segments[1] != "done" {
		t.Errorf("arm0 Segments = %v, want [* done]", pe0.Segments)
	}
	if arm0.Target != "s1" {
		t.Errorf("arm0 Target = %q, want %q", arm0.Target, "s1")
	}

	// Second arm: _ => s1
	arm1 := r.Match.Arms[1]
	if len(arm1.Branches) != 1 {
		t.Fatalf("arm1: expected 1 branch, got %d", len(arm1.Branches))
	}
	if !arm1.Branches[0].Fallback {
		t.Error("arm1: expected fallback")
	}
	if arm1.Target != "s1" {
		t.Errorf("arm1 Target = %q, want %q", arm1.Target, "s1")
	}
}

func TestParseRouteORBranches(t *testing.T) {
	src := `state { ns { v:number = 0 } }
scene "s1" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}
route "r" {
  match {
    s1.start | s1.*.end => s1
  }
}`
	tf := mustParse(t, src)
	if len(tf.Routes) != 1 {
		t.Fatalf("expected 1 route")
	}
	arm := tf.Routes[0].Match.Arms[0]
	if len(arm.Branches) != 2 {
		t.Fatalf("expected 2 OR branches, got %d", len(arm.Branches))
	}
	// First branch: s1.start
	b0 := arm.Branches[0]
	if b0.SceneID != "s1" || len(b0.Segments) != 1 || b0.Segments[0] != "start" {
		t.Errorf("branch0: SceneID=%q Segments=%v", b0.SceneID, b0.Segments)
	}
	// Second branch: s1.*.end
	b1 := arm.Branches[1]
	if b1.SceneID != "s1" || len(b1.Segments) != 2 || b1.Segments[0] != "*" || b1.Segments[1] != "end" {
		t.Errorf("branch1: SceneID=%q Segments=%v", b1.SceneID, b1.Segments)
	}
}

func TestParseRouteFallbackOnly(t *testing.T) {
	src := `state { ns { v:number = 0 } }
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}
route "r" { match { _ => s } }`
	tf := mustParse(t, src)
	arm := tf.Routes[0].Match.Arms[0]
	if !arm.Branches[0].Fallback {
		t.Error("expected fallback branch")
	}
	if arm.Target != "s" {
		t.Errorf("target = %q, want %q", arm.Target, "s")
	}
}

func TestParseMultipleRoutes(t *testing.T) {
	src := `state { ns { v:number = 0 } }
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}
route "r1" { match { _ => s } }
route "r2" { match { s.done => s } }`
	tf := mustParse(t, src)
	if len(tf.Routes) != 2 {
		t.Fatalf("expected 2 routes, got %d", len(tf.Routes))
	}
	if tf.Routes[0].ID != "r1" || tf.Routes[1].ID != "r2" {
		t.Errorf("route IDs = %q, %q", tf.Routes[0].ID, tf.Routes[1].ID)
	}
}

func TestParseRouteWildcardSegment(t *testing.T) {
	src := `state { ns { v:number = 0 } }
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}
route "r" { match { s.*.final => s } }`
	tf := mustParse(t, src)
	pe := tf.Routes[0].Match.Arms[0].Branches[0]
	if len(pe.Segments) != 2 || pe.Segments[0] != "*" || pe.Segments[1] != "final" {
		t.Errorf("segments = %v, want [* final]", pe.Segments)
	}
}

// TestRouteDoesNotBreakBindingNamedRoute verifies that using "route" as a
// binding name in a scene still parses correctly (contextual keyword).
func TestRouteDoesNotBreakBindingNamedRoute(t *testing.T) {
	src := `state { ns { v:number = 0 } }
scene "s" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = route
      prog "p" {
        route:str = "forest_trail"
      }
    }
  }
}`
	tf := mustParse(t, src)
	if tf.Scenes[0] == nil {
		t.Fatal("scene not parsed")
	}
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	if b.Name != "route" {
		t.Errorf("binding name = %q, want %q", b.Name, "route")
	}
	if len(tf.Routes) != 0 {
		t.Errorf("expected 0 routes, got %d", len(tf.Routes))
	}
}
