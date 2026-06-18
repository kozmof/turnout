package parser_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
)

// progBindings returns the bindings of the first action's compute prog, which is
// where every local-expression form below is exercised.
func progBindings(t *testing.T, src string) []*ast.BindingDecl {
	t.Helper()
	tf := mustParse(t, src)
	return tf.Scenes[0].Actions[0].Compute.Prog.Bindings
}

// TestRHSCaseArms exercises parseCaseCallRHS arm parsing, parseCaseArm (with and
// without a guard), and all three concrete parseCasePattern variants: literal,
// variable binder, and wildcard.
func TestRHSCaseArms(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = result
      prog "p" {
        score:number = 1
        result:str = #case(score, 1 => "one", x if gt(x, 5) => "big", _ => "other")
      }
    }
  }`)
	bindings := progBindings(t, src)
	cc, ok := bindings[1].RHS.(*ast.CaseCallRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *CaseCallRHS", bindings[1].RHS)
	}

	subj, ok := cc.Subject.(*ast.LocalRefExpr)
	if !ok || subj.Name != "score" {
		t.Errorf("subject: got %T, want ref to score", cc.Subject)
	}
	if len(cc.Arms) != 3 {
		t.Fatalf("arm count = %d, want 3", len(cc.Arms))
	}

	// Arm 0: literal pattern `1`, no guard.
	lit, ok := cc.Arms[0].Pattern.(*ast.LiteralCasePattern)
	if !ok {
		t.Errorf("arm[0] pattern: got %T, want *LiteralCasePattern", cc.Arms[0].Pattern)
	} else if num, ok := lit.Value.(*ast.NumberLiteral); !ok || num.Value != 1 {
		t.Errorf("arm[0] literal: got %v, want 1", lit.Value)
	}
	if cc.Arms[0].Guard != nil {
		t.Errorf("arm[0] guard: got %T, want nil", cc.Arms[0].Guard)
	}

	// Arm 1: variable binder `x` with a guard `if gt(x, 5)`.
	vb, ok := cc.Arms[1].Pattern.(*ast.VarBinderPattern)
	if !ok || vb.Name != "x" {
		t.Errorf("arm[1] pattern: got %T, want *VarBinderPattern{x}", cc.Arms[1].Pattern)
	}
	guard, ok := cc.Arms[1].Guard.(*ast.LocalCallExpr)
	if !ok || guard.FnAlias != "gt" {
		t.Errorf("arm[1] guard: got %T, want *LocalCallExpr{gt}", cc.Arms[1].Guard)
	}

	// Arm 2: wildcard pattern `_`.
	if _, ok := cc.Arms[2].Pattern.(*ast.WildcardCasePattern); !ok {
		t.Errorf("arm[2] pattern: got %T, want *WildcardCasePattern", cc.Arms[2].Pattern)
	}
}

// TestCasePatternTupleError covers the parseCasePattern error branch for tuple
// patterns, which are not supported.
func TestCasePatternTupleError(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = result
      prog "p" {
        score:number = 1
        result:str = #case(score, (1, 2) => "tuple", _ => "other")
      }
    }
  }`)
	mustParseFail(t, src)
}

// TestRHSLocalNestedExprs exercises the nested local-expression primaries:
// parseLocalIfExpr, parseLocalCaseExpr, and parseLocalPipeExpr. Each appears as
// an operand of an outer #if, which is the only context that drives these.
func TestRHSLocalNestedExprs(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = result
      prog "p" {
        flag:bool   = true
        flag2:bool  = false
        v1:number   = 1
        v2:number   = 2
        result:number = #if(flag, #if(flag2, v1, v2), #pipe(v1, add(#it, v2)))
        result2:number = #if(flag, #case(v1, 1 => v1, _ => v2), v2)
      }
    }
  }`)
	bindings := progBindings(t, src)

	outer, ok := bindings[4].RHS.(*ast.IfCallRHS)
	if !ok {
		t.Fatalf("result RHS: got %T, want *IfCallRHS", bindings[4].RHS)
	}
	if _, ok := outer.Then.(*ast.LocalIfExpr); !ok {
		t.Errorf("then: got %T, want *LocalIfExpr", outer.Then)
	}
	pipe, ok := outer.Else.(*ast.LocalPipeExpr)
	if !ok {
		t.Fatalf("else: got %T, want *LocalPipeExpr", outer.Else)
	}
	if len(pipe.Steps) != 1 {
		t.Errorf("pipe steps = %d, want 1", len(pipe.Steps))
	}

	outer2, ok := bindings[5].RHS.(*ast.IfCallRHS)
	if !ok {
		t.Fatalf("result2 RHS: got %T, want *IfCallRHS", bindings[5].RHS)
	}
	caseExpr, ok := outer2.Then.(*ast.LocalCaseExpr)
	if !ok {
		t.Fatalf("result2 then: got %T, want *LocalCaseExpr", outer2.Then)
	}
	if len(caseExpr.Arms) != 2 {
		t.Errorf("nested case arms = %d, want 2", len(caseExpr.Arms))
	}
}

// TestRHSLocalInfix exercises parseLocalPrec's infix loop, localInfixOpFromTok,
// and infixPrec's precedence climbing: `v1 + v2 * v3` must parse as
// `v1 + (v2 * v3)` because `*` binds tighter than `+`.
func TestRHSLocalInfix(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = result
      prog "p" {
        v1:number = 1
        v2:number = 2
        v3:number = 3
        addFn:number = add(v1, v2)
        subFn:number = add(v1, v2)
        result:number = #if(v1 + v2 * v3, addFn, subFn)
      }
    }
  }`)
	bindings := progBindings(t, src)
	ir, ok := bindings[5].RHS.(*ast.IfCallRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *IfCallRHS", bindings[5].RHS)
	}
	add, ok := ir.Cond.(*ast.LocalInfixExpr)
	if !ok || add.Op != ast.InfixPlus {
		t.Fatalf("cond: got %T, want *LocalInfixExpr{+}", ir.Cond)
	}
	// The left operand is the bare ref v1; the right operand is the tighter `v2 * v3`.
	if lhs, ok := add.LHS.(*ast.LocalRefExpr); !ok || lhs.Name != "v1" {
		t.Errorf("infix LHS: got %T, want ref v1", add.LHS)
	}
	mul, ok := add.RHS.(*ast.LocalInfixExpr)
	if !ok || mul.Op != ast.InfixMul {
		t.Errorf("infix RHS: got %T, want *LocalInfixExpr{*}", add.RHS)
	}
}

// TestArgMethodChain exercises parseMethodChain via the DSL method-call argument
// form `receiver.method1().method2()` inside a function call.
func TestArgMethodChain(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = result
      prog "p" {
        name:str = "hi"
        result:str = id(name.upper().trim())
      }
    }
  }`)
	bindings := progBindings(t, src)
	fc, ok := bindings[1].RHS.(*ast.FuncCallRHS)
	if !ok {
		t.Fatalf("RHS: got %T, want *FuncCallRHS", bindings[1].RHS)
	}
	if len(fc.Args) != 1 {
		t.Fatalf("arg count = %d, want 1", len(fc.Args))
	}
	mc, ok := fc.Args[0].(*ast.MethodCallArg)
	if !ok {
		t.Fatalf("arg[0]: got %T, want *MethodCallArg", fc.Args[0])
	}
	if mc.Receiver != "name" {
		t.Errorf("receiver = %q, want name", mc.Receiver)
	}
	if len(mc.Methods) != 2 || mc.Methods[0] != "upper" || mc.Methods[1] != "trim" {
		t.Errorf("methods = %v, want [upper trim]", mc.Methods)
	}
}

// TestMethodChainMissingMethodName covers the parseMethodChain error branch where
// `.` is not followed by an identifier.
func TestMethodChainMissingMethodName(t *testing.T) {
	src := minimalTurnFile(`  action "a" {
    compute {
      root = result
      prog "p" {
        name:str = "hi"
        result:str = id(name.())
      }
    }
  }`)
	mustParseFail(t, src)
}
