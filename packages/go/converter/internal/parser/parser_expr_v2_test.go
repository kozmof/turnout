package parser_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
)

// rhsOf parses a one-binding prog and returns the last binding's RHS.
func rhsOf(t *testing.T, ty, expr string) ast.BindingRHS {
	t.Helper()
	src := minimalTurnFile(`  action "a" {
    compute {
      prog "p" {
        a:number = 1
        b:number = 2
        c:number = 3
        f:bool = true
        result:` + ty + ` := ` + expr + `
      }
    }
  }`)
	bindings := progBindings(t, src)
	return bindings[len(bindings)-1].RHS
}

// TestMethodChainAsInfixOperand covers NEW_SYNTAX.md Phase 0: a transform chain
// is valid as either operand. The left operand used to be hardcoded to a bare
// reference, which made `rate.floor() + 0` — the workaround the spec itself
// documented — fail to parse.
func TestMethodChainAsInfixOperand(t *testing.T) {
	for _, expr := range []string{`a.floor() + 0`, `a.abs().floor() + b`, `b + a.floor()`} {
		if rhs := rhsOf(t, "number", expr); rhs.Kind() != ast.RHSKindInfix {
			t.Errorf("%s: got kind %v, want RHSKindInfix", expr, rhs.Kind())
		}
	}
}

// TestStandaloneTransformRHS covers 1.3: a transform chain is a valid binding
// value on its own, retiring the `+ 0` idiom.
func TestStandaloneTransformRHS(t *testing.T) {
	tr, ok := rhsOf(t, "number", `a.floor()`).(*ast.TransformRHS)
	if !ok {
		t.Fatalf("got %T, want *TransformRHS", rhsOf(t, "number", `a.floor()`))
	}
	mc, ok := tr.Arg.(*ast.MethodCallArg)
	if !ok || mc.Receiver != "a" || len(mc.Methods) != 1 || mc.Methods[0] != "floor" {
		t.Errorf("chain = %v, want a.floor()", tr.Arg)
	}
}

// TestSingleInfixNormalizesToInfixRHS is the backward-compatibility contract for
// nested infix (1.1): anything the pre-nesting grammar could express must still
// produce an *InfixRHS, so it takes the original lowering path.
func TestSingleInfixNormalizesToInfixRHS(t *testing.T) {
	for _, tc := range []struct{ ty, expr string }{
		{"number", `a + b`}, {"number", `a + 1`}, {"number", `a.floor() + 1`}, {"bool", `a >= b`},
	} {
		if rhs := rhsOf(t, tc.ty, tc.expr); rhs.Kind() != ast.RHSKindInfix {
			t.Errorf("%s: got kind %v, want RHSKindInfix", tc.expr, rhs.Kind())
		}
	}
}

// TestNestedInfixProducesTree covers expressions with more than one operator,
// which the pre-nesting grammar rejected outright.
func TestNestedInfixProducesTree(t *testing.T) {
	for _, tc := range []struct{ ty, expr string }{
		{"number", `a + b + c`}, {"number", `100 - a - b`},
		{"number", `a * b + c`}, {"bool", `f & a >= b`},
	} {
		if rhs := rhsOf(t, tc.ty, tc.expr); rhs.Kind() != ast.RHSKindNestedInfix {
			t.Errorf("%s: got kind %v, want RHSKindNestedInfix", tc.expr, rhs.Kind())
		}
	}
}

// TestLiteralOnLeftOfInfix covers 1.2.
func TestLiteralOnLeftOfInfix(t *testing.T) {
	ir, ok := rhsOf(t, "number", `100 - a`).(*ast.InfixRHS)
	if !ok {
		t.Fatalf("got %T, want *InfixRHS", rhsOf(t, "number", `100 - a`))
	}
	if _, ok := ir.LHS.(*ast.LitArg); !ok {
		t.Errorf("LHS = %T, want *LitArg", ir.LHS)
	}
	if rhs := rhsOf(t, "number", `100`); rhs.Kind() != ast.RHSKindLiteral {
		t.Errorf("bare literal: got kind %v, want RHSKindLiteral", rhs.Kind())
	}
}

// TestInfixPrecedenceGrouping pins the tree shape, not just the kind.
func TestInfixPrecedenceGrouping(t *testing.T) {
	t.Run("mul binds tighter than add", func(t *testing.T) {
		ni := rhsOf(t, "number", `a + b * c`).(*ast.NestedInfixRHS)
		if ni.Root.Op != ast.InfixPlus {
			t.Errorf("root op = %v, want +", ni.Root.Op)
		}
		if _, ok := ni.Root.LHS.(*ast.InfixLeaf); !ok {
			t.Errorf("root LHS = %T, want leaf", ni.Root.LHS)
		}
		right, ok := ni.Root.RHS.(*ast.InfixBranch)
		if !ok || right.Op != ast.InfixMul {
			t.Errorf("root RHS = %v, want a * branch", ni.Root.RHS)
		}
	})
	t.Run("same precedence associates left", func(t *testing.T) {
		ni := rhsOf(t, "number", `a + b + c`).(*ast.NestedInfixRHS)
		if _, ok := ni.Root.LHS.(*ast.InfixBranch); !ok {
			t.Errorf("root LHS = %T, want a branch", ni.Root.LHS)
		}
		if _, ok := ni.Root.RHS.(*ast.InfixLeaf); !ok {
			t.Errorf("root RHS = %T, want a leaf", ni.Root.RHS)
		}
	})
}

// nextRulesOf parses a scene whose first action carries the given next clauses.
func nextRulesOf(t *testing.T, nextClauses string) []*ast.NextRule {
	t.Helper()
	tf := mustParse(t, minimalTurnFile(`  action "a" {
    compute {
      prog "p" {
        ready:bool := true
      }
    }
`+nextClauses+`
  }`))
	return tf.Scenes[0].Actions[0].Next
}

// TestNextSugarConditional covers 1.4: `next X if cond` expands to the block
// form — a synthesized prog with the ingress binding and the `:=` condition,
// plus the from_action prepare entry feeding it.
func TestNextSugarConditional(t *testing.T) {
	rules := nextRulesOf(t, `    next b if ready`)
	if len(rules) != 1 {
		t.Fatalf("rule count = %d, want 1", len(rules))
	}
	r := rules[0]
	if r.ActionID != "b" {
		t.Errorf("ActionID = %q, want b", r.ActionID)
	}
	bs := r.Compute.Prog.Bindings
	if len(bs) != 2 {
		t.Fatalf("synthesized bindings = %d, want 2", len(bs))
	}
	if bs[0].Sigil != ast.SigilIngress || bs[0].Name != "ready" {
		t.Errorf("binding[0] = %v %q, want an ingress `ready`", bs[0].Sigil, bs[0].Name)
	}
	if bs[1].Marker != ast.MarkerCond || r.Compute.Condition != bs[1].Name {
		t.Errorf("condition = %q, marker = %v", r.Compute.Condition, bs[1].Marker)
	}
	if r.Prepare == nil || len(r.Prepare.Entries) != 1 {
		t.Fatalf("prepare = %v, want one entry", r.Prepare)
	}
	fa, ok := r.Prepare.Entries[0].Source.(*ast.FromAction)
	if !ok || fa.BindingName != "ready" {
		t.Errorf("prepare source = %v, want from_action(ready)", r.Prepare.Entries[0].Source)
	}
}

// TestNextSugarUnconditional covers `next X`, which carries no compute at all.
func TestNextSugarUnconditional(t *testing.T) {
	rules := nextRulesOf(t, "    next b\n    next c")
	if len(rules) != 2 {
		t.Fatalf("rule count = %d, want 2", len(rules))
	}
	for i, want := range []string{"b", "c"} {
		if rules[i].ActionID != want || rules[i].Compute != nil || rules[i].Prepare != nil {
			t.Errorf("rule[%d] = %+v, want a bare transition to %q", i, rules[i], want)
		}
	}
}

// TestNextSugarQuotedAction accepts a quoted action id, matching the block form.
func TestNextSugarQuotedAction(t *testing.T) {
	if rules := nextRulesOf(t, `    next "b"`); len(rules) != 1 || rules[0].ActionID != "b" {
		t.Fatalf("rules = %v, want one rule targeting b", rules)
	}
}

// TestNextSugarMissingCondition covers the error branch where `if` is not
// followed by an identifier.
func TestNextSugarMissingCondition(t *testing.T) {
	mustParseFail(t, minimalTurnFile(`  action "a" {
    compute { prog "p" { ready:bool := true } }
    next b if 42
  }`))
}

// TestNextBlockFormStillParses guards the sugar's lookahead: a `next` followed
// by a brace must still take the block path.
func TestNextBlockFormStillParses(t *testing.T) {
	rules := nextRulesOf(t, "    next {\n      action = b\n    }")
	if len(rules) != 1 || rules[0].ActionID != "b" {
		t.Fatalf("rules = %v, want one rule targeting b", rules)
	}
}
