package parser_test

import (
	"os"
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
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
	tf, diags := parser.ParseFile("test.tu", src)
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
	_, diags := parser.ParseFile("test.tu", src)
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
  entry_action = a
  action "a" {
    compute "p" { v:bool := true }
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
	src := `state_file = "loan.state.tu"

scene "s" {
  entry_action = a
  action "a" {
    compute "p" { v:bool := true }
  }
}
`
	tf := mustParse(t, src)
	sd, ok := tf.StateSource.(*ast.StateFileDirective)
	if !ok {
		t.Fatalf("expected *StateFileDirective, got %T", tf.StateSource)
	}
	if sd.Path != "loan.state.tu" {
		t.Errorf("path = %q, want %q", sd.Path, "loan.state.tu")
	}
}

func TestMissingStateSourceError(t *testing.T) {
	src := `scene "s" {
  entry_action = a
  action "a" {
    compute "p" { v:bool := true }
  }
}
`
	mustParseFail(t, src)
}

func TestConflictingStateSourceError(t *testing.T) {
	src := `state {}
state_file = "x.tu"
scene "s" { entry_action = a action "a" { compute "p" { v:bool := true } } }
`
	mustParseFail(t, src)
}

// ── scene block ───────────────────────────────────────────────────────────────

func TestParseSceneBasic(t *testing.T) {
	src := `state {}
scene "loan_flow" {
  entry_action = score
  action "score" {
    compute "p" { decision:bool := true }
  }
}
`
	tf := mustParse(t, src)
	sb := tf.Scenes[0]
	if sb.ID != "loan_flow" {
		t.Errorf("scene ID = %q", sb.ID)
	}
	if sb.EntryAction != "score" {
		t.Errorf("entry_action = %q", sb.EntryAction)
	}
}

// ── view block ────────────────────────────────────────────────────────────────

func TestParseViewBlock(t *testing.T) {
	src := `state {}
scene "s" {
  overview at_least {
    a |-> b
  }
  action "a" {
    compute "p" { v:bool := true }
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
	if len(v.Edges) != 1 || v.Edges[0].From != "a" || v.Edges[0].To != "b" {
		t.Errorf("edges = %v, want one a |-> b", v.Edges)
	}
	// Every edge carries a real source position — the reason the flow moved out
	// of the heredoc (NEW_SYNTAX.md 2.2).
	if v.Edges[0].Pos.Line == 0 || v.Edges[0].Pos.Col == 0 {
		t.Errorf("edge position = %+v, want a real line/col", v.Edges[0].Pos)
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
    compute "p" { v:bool := true }
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
    compute "p" { v:bool := true }
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
    compute "score_graph" {
      income:number = 0
      decision:bool := true
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
	if b1.Sigil != ast.SigilNone || b1.Name != "decision" {
		t.Errorf("binding[1]: sigil=%v name=%q", b1.Sigil, b1.Name)
	}
}

// TestParseInlineIOSigils covers NEW_SYNTAX.md 3: a binding's direction comes
// from its inline IO clauses, and the arrow points at the destination — so `<~`
// on the right of the name is input and `~>` is output, the opposite of the
// retired prefix sigils.
func TestParseInlineIOSigils(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" {
      a:number <~ @ns.val
      b:bool   = (true) ~> @ns.flag
      c:str    <~ @ns.name ~> @ns.name
      d:number := 0
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
		{"c", ast.SigilBiDir}, // both arrows replace the retired <~>
		{"d", ast.SigilNone},
	}
	for i, tc := range cases {
		if bindings[i].Name != tc.name || bindings[i].Sigil != tc.sigil {
			t.Errorf("binding[%d]: name=%q sigil=%v, want name=%q sigil=%v",
				i, bindings[i].Name, bindings[i].Sigil, tc.name, tc.sigil)
		}
	}
	// The state paths are captured on the clauses themselves.
	in, ok := bindings[0].Ingress.(*ast.IngressState)
	if !ok || in.Path != "ns.val" {
		t.Errorf("binding[0] ingress = %v, want @ns.val", bindings[0].Ingress)
	}
	if bindings[1].Egress == nil || bindings[1].Egress.Path != "ns.flag" {
		t.Errorf("binding[1] egress = %v, want @ns.flag", bindings[1].Egress)
	}
}

// TestParseLeadingSigilRejected covers a sigil written before the binding name.
// The sigil follows the binding it applies to, so the leading position is a
// syntax error like any other.
func TestParseLeadingSigilRejected(t *testing.T) {
	_, ds := parser.ParseFile("test.tu", minimalTurnFile(`  action "a" {
    compute "p" {
      ~>a:number :=
    }
  }`))
	if !hasSyntaxError(ds, "unexpected ~> before binding name") {
		t.Errorf("want leading-sigil syntax error, got %v", ds)
	}
}

// TestParseLeadingSigilAfterBinding covers the same spelling one line down.
// `~>` is also this DSL's egress clause and the grammar is newline-insensitive,
// so a leading arrow here could be read as the previous binding's egress and
// reported against a binding its author never wrote.
func TestParseLeadingSigilAfterBinding(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" {
      x:number = 5
      ~>out:bool = true
      d:bool := true
    }
  }`)
	_, ds := parser.ParseFile("test.tu", src)
	if !hasSyntaxError(ds, "unexpected ~> before binding name") {
		t.Fatalf("want leading-sigil syntax error, got %v", ds)
	}
	wantLine := lineOf(t, src, "~>out:bool")
	for _, d := range ds {
		if d.Line != wantLine {
			t.Errorf("diagnostic %q on line %d, want all on line %d (the arrow)", d.Message, d.Line, wantLine)
		}
	}
}

// TestParseEgressOnOwnLine covers `~> @ns.field` opening a line. Both readings
// fit it — this binding's destination, or the retired leading sigil of the next
// binding — and they mean opposite things, so it is reported rather than
// silently attached to the binding above.
func TestParseEgressOnOwnLine(t *testing.T) {
	_, ds := parser.ParseFile("test.tu", minimalTurnFile(`  action "a" {
    compute "p" {
      d:bool := (true)
      ~> @ns.val
    }
  }`))
	if !hasSyntaxError(ds, "must be on the same line as the binding it writes from") {
		t.Errorf("want same-line egress error, got %v", ds)
	}
}

// TestParseEgressAfterMultilineRHS pins what the same-line rule anchors on: the
// line the binding's value ends on, not the line it starts on. An RHS may span
// lines, and the arrow still follows it.
func TestParseEgressAfterMultilineRHS(t *testing.T) {
	tf := mustParse(t, minimalTurnFile(`  action "a" {
    compute "p" {
      x:number = 5
      d:number := (x |>
        max(#it, 0)
      ) ~> @ns.val
    }
  }`))
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
	last := bindings[len(bindings)-1]
	if last.Egress == nil || last.Egress.Path != "ns.val" {
		t.Errorf("binding %q egress = %v, want @ns.val", last.Name, last.Egress)
	}
}

// TestParseIngressOnOwnLine is the ingress half of the same-line rule. A source
// opening a line reads both as this binding's source and as the leading sigil
// of the next one, so it is reported rather than silently attached.
func TestParseIngressOnOwnLine(t *testing.T) {
	_, ds := parser.ParseFile("test.tu", minimalTurnFile(`  action "a" {
    compute "p" {
      a:number
      <~ @ns.val
      d:bool := true
    }
  }`))
	if !hasSyntaxError(ds, "must be on the same line as the binding it feeds") {
		t.Errorf("want same-line ingress error, got %v", ds)
	}
}

// TestParseLeadingIngressSigilAfterBinding covers the retired spelling one line
// below a binding that would otherwise take the arrow as its own source: no
// ingress source is a bare identifier, so `<~ name:type` belongs to the binding
// it names.
func TestParseLeadingIngressSigilAfterBinding(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" {
      a:number
      <~debt:number
      d:bool := true
    }
  }`)
	_, ds := parser.ParseFile("test.tu", src)
	if !hasSyntaxError(ds, "unexpected <~ before binding name") {
		t.Fatalf("want leading-sigil syntax error, got %v", ds)
	}
	wantLine := lineOf(t, src, "<~debt:number")
	for _, d := range ds {
		if d.Code == diag.CodeParseSyntaxError && d.Line != wantLine {
			t.Errorf("syntax error %q on line %d, want line %d (the arrow)", d.Message, d.Line, wantLine)
		}
	}
}

// TestParseEgressMissingStatePath keeps the arrow attached to its own binding
// when what follows is not a binding at all: a missing `@` is this binding's
// typo, not the next binding's sigil.
func TestParseEgressMissingStatePath(t *testing.T) {
	_, ds := parser.ParseFile("test.tu", minimalTurnFile(`  action "a" {
    compute "p" {
      d:bool := (true) ~> ns.val
    }
  }`))
	if !hasSyntaxError(ds, "expected a state path after ~>") {
		t.Errorf("want missing-state-path syntax error, got %v", ds)
	}
}

// TestParseBareInputDeclaration covers a binding with no RHS and no inline
// clause. It used to be an input fed by `prepare`; with the blocks retired it
// has no source, and a silent zero value is worse than a diagnostic.
func TestParseBareInputDeclaration(t *testing.T) {
	_, ds := parser.ParseFile("test.tu", minimalTurnFile(`  action "a" {
    compute "p" {
      a:number
      d:bool := true
    }
  }`))
	if !hasDiagCode(ds, diag.CodeMissingBindingSource) {
		t.Errorf("want MissingBindingSource, got %v", ds)
	}
}

// TestParseRetiredEffectBlocks covers both retired blocks, in an action and in
// a transition. No parser rule accepts them, so each falls to its block's
// default branch and is skipped whole — one diagnostic, nothing trailing from
// the entries inside.
func TestParseRetiredEffectBlocks(t *testing.T) {
	t.Run("prepare", func(t *testing.T) {
		_, ds := parser.ParseFile("test.tu", minimalTurnFile(`  action "a" {
    compute "p" {
      a:number <~ @ns.val
      d:bool := true
    }
    prepare {
      a { from_state = ns.val }
    }
  }`))
		if !hasSyntaxError(ds, "unexpected token prepare") {
			t.Errorf("want prepare-block syntax error, got %v", ds)
		}
	})

	t.Run("merge", func(t *testing.T) {
		_, ds := parser.ParseFile("test.tu", minimalTurnFile(`  action "a" {
    compute "p" {
      d:number := 1
    }
    merge {
      d { to_state = ns.val }
    }
  }`))
		if !hasSyntaxError(ds, "unexpected token merge") {
			t.Errorf("want merge-block syntax error, got %v", ds)
		}
	})

	t.Run("transition_prepare", func(t *testing.T) {
		_, ds := parser.ParseFile("test.tu", minimalTurnFile(`  action "a" {
    compute "p" { d:bool := true }
    next {
      compute "n" { go:bool := true }
      prepare { d { from_action = d } }
      action = a
    }
  }`))
		if !hasSyntaxError(ds, "unexpected token prepare") {
			t.Errorf("want prepare-block syntax error, got %v", ds)
		}
	})
}

// ── RHS forms ─────────────────────────────────────────────────────────────────

func TestRHSLiteralForms(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" {
      n:number       = 42
      s:str          = "hello"
      b:bool         = false
      xs:arr<number> := [1, 2, 3]
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
    compute "p" {
      v:number := <~ @ns.val
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	if _, ok := b.RHS.(*ast.SigilInputRHS); !ok {
		t.Errorf("RHS: got %T, want *SigilInputRHS", b.RHS)
	}
}

func TestRHSSingleRef(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" {
      v:number = 5
      out:number := v
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
    compute "p" {
      v1:number = 5
      v2:number = 3
      out:number := add(v1, v2)
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
    compute "p" {
      v1:number = 5
      v2:number = 3
      out:number := add(a: v1, b: v2)
    }
  }`)
	_, ds := parser.ParseFile("test.tu", src)
	if !ds.HasErrors() {
		t.Fatal("expected named function call args to be rejected")
	}
}

func TestRHSInfixForms(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" {
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
      out:bool := true
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
    compute "p" {
      v1:number = 5
      v2:number = 3
      result:number := v1 |> add(#it, v2)
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[2]
	pr, ok := b.RHS.(*ast.PipeCallRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *PipeCallRHS", b.RHS)
	}
	initRef, ok := pr.Initial.(*ast.LocalRefExpr)
	if !ok || initRef.Name != "v1" {
		t.Errorf("initial: got %T, want ref to v1", pr.Initial)
	}
	if len(pr.Steps) != 1 {
		t.Errorf("step count = %d, want 1", len(pr.Steps))
	}
	call, ok := pr.Steps[0].(*ast.LocalCallExpr)
	if !ok || call.FnAlias != "add" {
		t.Errorf("step[0]: got %T, want LocalCallExpr{add}", pr.Steps[0])
	}
}

func TestRHSCondBlock(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" {
      flag:bool    = true
      addFn:number = add(v1, v2)
      subFn:number = add(v1, v2)
      result:number := if(flag, addFn, subFn)
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[3]
	ir, ok := b.RHS.(*ast.IfCallRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *IfCallRHS", b.RHS)
	}
	ref, ok := ir.Cond.(*ast.LocalRefExpr)
	if !ok || ref.Name != "flag" {
		t.Errorf("cond: got %T", ir.Cond)
	}
	thenRef, ok := ir.Then.(*ast.LocalRefExpr)
	if !ok || thenRef.Name != "addFn" {
		t.Errorf("then: got %T", ir.Then)
	}
	elseRef, ok := ir.Else.(*ast.LocalRefExpr)
	if !ok || elseRef.Name != "subFn" {
		t.Errorf("else: got %T", ir.Else)
	}
}

func TestRHSIfInlineCall(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" {
      v1:number    = 10
      v2:number    = 3
      addFn:number = add(v1, v2)
      subFn:number = add(v1, v2)
      result:number := if(gt(v1, v2), addFn, subFn)
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[4]
	ir, ok := b.RHS.(*ast.IfCallRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *IfCallRHS", b.RHS)
	}
	call, ok := ir.Cond.(*ast.LocalCallExpr)
	if !ok || call.FnAlias != "gt" || len(call.Args) != 2 {
		t.Errorf("cond: got %T", ir.Cond)
	}
	thenRef, ok := ir.Then.(*ast.LocalRefExpr)
	if !ok || thenRef.Name != "addFn" {
		t.Errorf("then: got %T", ir.Then)
	}
	elseRef, ok := ir.Else.(*ast.LocalRefExpr)
	if !ok || elseRef.Name != "subFn" {
		t.Errorf("else: got %T", ir.Else)
	}
}

func TestRHSIfBareRef(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" {
      flag:bool    = true
      addFn:number = add(v1, v2)
      subFn:number = add(v1, v2)
      result:number := if(flag, addFn, subFn)
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[3]
	ir, ok := b.RHS.(*ast.IfCallRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *IfCallRHS", b.RHS)
	}
	ref, ok := ir.Cond.(*ast.LocalRefExpr)
	if !ok || ref.Name != "flag" {
		t.Errorf("cond: got %T %v", ir.Cond, ir.Cond)
	}
}

// ── inline IO / publish ───────────────────────────────────────────────────────

func TestParseInlineStateIngress(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" {
      income:number <~ @applicant.income
      v:bool := true
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	if b.Name != "income" || b.Sigil != ast.SigilIngress {
		t.Fatalf("binding = %q sigil = %v", b.Name, b.Sigil)
	}
	in, ok := b.Ingress.(*ast.IngressState)
	if !ok || in.Path != "applicant.income" {
		t.Errorf("ingress: got %T %v", b.Ingress, b.Ingress)
	}
}

func TestParseInlineHookIngress(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" {
      data:str <~ hook("score_api")
      v:bool := true
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	in, ok := b.Ingress.(*ast.IngressHook)
	if !ok || in.HookName != "score_api" {
		t.Errorf("ingress: got %T %v", b.Ingress, b.Ingress)
	}
}

func TestParseInlineEgress(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" {
      decision:bool = (true) ~> @decision.approved
      v:bool := true
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	if b.Sigil != ast.SigilEgress {
		t.Fatalf("sigil = %v, want egress", b.Sigil)
	}
	if b.Egress == nil || b.Egress.Path != "decision.approved" {
		t.Errorf("egress = %v", b.Egress)
	}
}

func TestParsePublishBlock(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" { v:bool := true }
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
    compute "p" {
      decision:bool = true
      v:bool := true
    }
    next {
      compute "to_approve" {
        decision:bool <~ action(decision)
        go:bool := decision
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
	in, ok := r.Compute.Prog.Bindings[0].Ingress.(*ast.IngressAction)
	if !ok || in.BindingName != "decision" {
		t.Errorf("ingress: got %T %v", r.Compute.Prog.Bindings[0].Ingress, r.Compute.Prog.Bindings[0].Ingress)
	}
}

func TestParseNextFromState(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" { v:bool := true }
    next {
      compute "n" {
        x:bool <~ @ns.field
        always:bool := x
      }
      action = b
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Next[0].Compute.Prog.Bindings[0]
	in, ok := b.Ingress.(*ast.IngressState)
	if !ok || in.Path != "ns.field" {
		t.Errorf("ingress: got %T %v", b.Ingress, b.Ingress)
	}
}

func TestParseNextFromLiteral(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" { v:bool := true }
    next {
      compute "n" {
        x:number <~ 42
        always:bool := true
      }
      action = b
    }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Next[0].Compute.Prog.Bindings[0]
	in, ok := b.Ingress.(*ast.IngressLiteral)
	if !ok {
		t.Fatalf("ingress: got %T", b.Ingress)
	}
	n, ok := in.Value.(*ast.NumberLiteral)
	if !ok || n.Value != 42 {
		t.Errorf("literal: got %T %v", in.Value, in.Value)
	}
}

// ── reference normalization ───────────────────────────────────────────────────

func TestReferenceNormalization(t *testing.T) {
	// Both bare and quoted forms should produce the same string.
	srcBare := minimalTurnFile(`  action "a" {
    compute "p" { decision:bool := true }
    next { compute "n" { go:bool := true } action = b }
  }`)
	srcQuoted := minimalTurnFile(`  action "a" {
    compute "p" { decision:bool := true }
    next { compute "n" { go:bool := true } action = "b" }
  }`)

	tf1 := mustParse(t, srcBare)
	tf2 := mustParse(t, srcQuoted)

	if tf1.Scenes[0].Actions[0].Compute.Root != tf2.Scenes[0].Actions[0].Compute.Root {
		t.Errorf("root differs: %q vs %q",
			tf1.Scenes[0].Actions[0].Compute.Root,
			tf2.Scenes[0].Actions[0].Compute.Root)
	}
	if tf1.Scenes[0].Actions[0].Next[0].ActionID != tf2.Scenes[0].Actions[0].Next[0].ActionID {
		t.Error("action reference differs")
	}
}

func TestThreeSegmentPath(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute "p" { v:number := <~ @session.cart.items }
  }`)
	tf := mustParse(t, src)
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	in, ok := b.Ingress.(*ast.IngressState)
	if !ok || in.Path != "session.cart.items" {
		t.Errorf("path: got %T %v", b.Ingress, b.Ingress)
	}
}

// ── example files ─────────────────────────────────────────────────────────────

// parseWithDummyState parses an example file, prepending a minimal state block
// only when the file does not already declare one.
//
// A missing file fails rather than skips: the examples are committed alongside
// this test, so "not found" means one was renamed or deleted and this test
// stopped covering anything — which a skip would hide behind a green run.
func parseWithDummyState(t *testing.T, path string) *ast.TurnFile {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("example not found — retarget this test if it was renamed: %v", err)
	}
	return mustParse(t, withDummyState(string(data)))
}

// withDummyState prepends a minimal state block only when src declares no state
// source of its own.
//
// The check is containment rather than a leading-token match: a file may open
// with a header comment, and prepending a second state block to one that
// already has one is a hard parse error.
func withDummyState(src string) string {
	if strings.Contains(src, "state {") || strings.Contains(src, "state_file") {
		return src
	}
	return "state {}\n" + src
}

func TestExampleVendingMachine(t *testing.T) {
	tf := parseWithDummyState(t, "../../../../../spec/examples/01-vending-machine.tu")
	if tf.Scenes[0].ID != "vend" {
		t.Errorf("scene ID = %q, want vend", tf.Scenes[0].ID)
	}
	if len(tf.Scenes[0].Actions) != 4 {
		t.Errorf("action count = %d, want 4", len(tf.Scenes[0].Actions))
	}
	// The entry action carries both transition spellings: a guarded sugar rule
	// and the bare fallthrough.
	check := tf.Scenes[0].Actions[0]
	if len(check.Next) != 2 {
		t.Errorf("check_availability next count = %d, want 2", len(check.Next))
	}
}

func TestExampleIncidentTriage(t *testing.T) {
	data, err := os.ReadFile("../../../../../spec/examples/02-incident-triage.tu")
	if err != nil {
		t.Fatalf("example not found — retarget this test if it was renamed: %v", err)
	}
	tf, diags := parser.ParseFile("02-incident-triage.tu", withDummyState(string(data)))
	if diags.HasErrors() {
		for _, d := range diags {
			t.Logf("diag: %s", d.Format())
		}
		t.Fatalf("parse failed")
	}
	if tf.Scenes[0].ID != "incident_response" {
		t.Errorf("scene ID = %q, want incident_response", tf.Scenes[0].ID)
	}
	// The five-arm match block expands to five next rules; the entry action
	// declares no other transition.
	classify := tf.Scenes[0].Actions[0]
	if len(classify.Next) != 5 {
		t.Fatalf("classify_incident next count = %d, want 5", len(classify.Next))
	}
}

func TestExampleWarehouseRoute(t *testing.T) {
	tf := parseWithDummyState(t, "../../../../../spec/examples/03-warehouse-route.tu")
	if len(tf.Scenes) != 4 {
		t.Errorf("scene count = %d, want 4", len(tf.Scenes))
	}
	if len(tf.Routes) != 1 {
		t.Fatalf("route count = %d, want 1", len(tf.Routes))
	}
	if tf.Routes[0].EntrySceneID != "picking" {
		t.Errorf("route entry = %q, want picking", tf.Routes[0].EntrySceneID)
	}
}

func TestExampleSensorCalibration(t *testing.T) {
	tf := parseWithDummyState(t, "../../../../../spec/examples/04-sensor-calibration.tu")
	if tf.Scenes[0] == nil {
		t.Fatal("scene is nil")
	}
	if tf.Scenes[0].EntryAction != "evaluate_array" {
		t.Errorf("entry action = %q, want evaluate_array", tf.Scenes[0].EntryAction)
	}
}

func TestExampleTicketTypes(t *testing.T) {
	tf := parseWithDummyState(t, "../../../../../spec/examples/05-ticket-types.tu")
	if tf.Scenes[0] == nil {
		t.Fatal("scene is nil")
	}
	// Three top-level type declarations: two unions and one template.
	if len(tf.TypeDecls) != 3 {
		t.Errorf("type decl count = %d, want 3", len(tf.TypeDecls))
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
  action "a" { compute "p" { v:bool := true } }
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
	// Old block form { add = [v1, v2] } is now rejected; use function call syntax instead.
	src := minimalTurnFile(`  action "a" {
    compute "p" {
      v1:number = 5
      v2:number = 3
      out:number := add(v1, v2)
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
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}
route "main" {
  to {
    s1.*.done -> s1,
    _ -> s1
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

	// First arm: s1.*.done -> s1
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

	// Second arm: _ -> s1
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
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}
route "r" {
  to {
    s1.start | s1.*.end -> s1
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
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}
route "r" { to { _ -> s } }`
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
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}
route "r1" { to { _ -> s } }
route "r2" { to { s.done -> s } }`
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
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}
route "r" { to { s.*.final -> s } }`
	tf := mustParse(t, src)
	pe := tf.Routes[0].Match.Arms[0].Branches[0]
	if len(pe.Segments) != 2 || pe.Segments[0] != "*" || pe.Segments[1] != "final" {
		t.Errorf("segments = %v, want [* final]", pe.Segments)
	}
}

func TestParseRecordStateField(t *testing.T) {
	tf := mustParse(t, `state {
  cache { counters:Record<str, number> = {} }
}
scene "s" {
  entry_action = a
  action "a" { compute "p" { ok:bool := true } }
}
`)
	block := tf.StateSource.(*ast.InlineStateBlock)
	field := block.Namespaces[0].Fields[0]
	if field.Type != ast.FieldTypeRecordStrNumber {
		t.Fatalf("type = %v", field.Type)
	}
	if _, ok := field.Default.(*ast.RecordLiteral); !ok {
		t.Fatalf("default = %T", field.Default)
	}
}

func TestExampleRecordState(t *testing.T) {
	tf := parseWithDummyState(t, "../../../../../spec/examples/06-record-state.tu")
	if len(tf.Scenes) != 1 {
		t.Fatalf("scenes = %d, want 1", len(tf.Scenes))
	}
	fields := tf.StateSource.(*ast.InlineStateBlock).Namespaces[0].Fields
	if fields[0].Type != ast.FieldTypeRecordStrNumber || fields[1].Type != ast.FieldTypeRecordNumberStr {
		t.Fatalf("record field types = %v, %v", fields[0].Type, fields[1].Type)
	}
}
