package validate_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
	"google.golang.org/protobuf/types/known/structpb"
)

// assertClean fails the test if the pipeline reports any errors.
func assertClean(t *testing.T, src string) {
	t.Helper()
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

// TestValidateLocalInfixValid exercises validateProtoLocalInfix for the common
// arithmetic operators nested inside an #if expression. `n + 1` / `n - 1` are
// LocalInfixExpr operands of the then/else branches.
func TestValidateLocalInfixValid(t *testing.T) {
	src := min(`        flag:bool  = true
        n:number   = 5
        out:number = #if(flag, n + 1, n - 1)
`)
	assertClean(t, src)
}

// TestValidateLocalInfixStrConcat covers the InfixPlus → "str_concat" dispatch
// path in validateProtoLocalInfix where the LHS type is str.
func TestValidateLocalInfixStrConcat(t *testing.T) {
	src := min(`        flag:bool = true
        s:str     = "a"
        out:str   = #if(flag, s + "b", s)
`)
	assertClean(t, src)
}

// TestValidateLocalInfixArgTypeMismatch covers the arg-type-check branch of
// validateProtoLocalInfix: numeric `-` with a str right operand must error.
func TestValidateLocalInfixArgTypeMismatch(t *testing.T) {
	src := min(`        flag:bool  = true
        n:number   = 5
        out:number = #if(flag, n - "x", n)
`)
	if !hasCode(pipeline(src), diag.CodeArgTypeMismatch) {
		t.Error("want ArgTypeMismatch for `number - str` infix inside #if")
	}
}

// TestValidateLocalInfixComparison covers a comparison operator (`>`) used as the
// #if condition, which returns bool and must validate cleanly.
func TestValidateLocalInfixComparison(t *testing.T) {
	src := min(`        n:number   = 5
        out:number = #if(n > 0, n, 0)
`)
	assertClean(t, src)
}

// TestValidateLocalCaseVarBinder exercises validateProtoLocalCase together with
// protoPatternScopeBindings: the variable binder `x` must be in scope inside the
// arm expression and guard. The `m` reference in the binder arm also drives the
// scopeChain.get parent-lookup fallthrough (a name that is not the binder).
func TestValidateLocalCaseVarBinder(t *testing.T) {
	src := min(`        n:number   = 3
        m:number   = 7
        out:number = #case(n, 1 => 10, x if x > m => x, _ => m)
`)
	assertClean(t, src)
}

// TestValidateLocalCaseLiteralPatternTypeMismatch covers validateProtoPattern's
// literal-type check: a str pattern against a number subject must error.
func TestValidateLocalCaseLiteralPatternTypeMismatch(t *testing.T) {
	src := min(`        n:number   = 3
        out:number = #case(n, "oops" => 1, _ => 0)
`)
	if !hasCode(pipeline(src), diag.CodeArgTypeMismatch) {
		t.Error("want ArgTypeMismatch for str pattern against number subject")
	}
}

// TestValidateExtExprCycle drives detectCycles' cycle-path extraction (phase 2)
// and collectLocalExprBindingRefs: two ext_expr bindings reference each other.
func TestValidateExtExprCycle(t *testing.T) {
	src := min(`        flag:bool  = true
        a:number   = #if(flag, b, 0)
        b:number   = #if(flag, a, 0)
`)
	if !hasCode(pipeline(src), diag.CodeCyclicBinding) {
		t.Error("want CyclicBinding for mutually-referencing #if bindings")
	}
}

// TestExtExprOnlyCycle covers collectLocalExprBindingRefs, the dependency-edge
// collector for bindings that carry only ExtExpr (no flat Expr). The normal
// pipeline always emits both, so the model is built by hand. The two #if
// ext_exprs reference each other, forming a cycle.
func TestExtExprOnlyCycle(t *testing.T) {
	ref := func(n string) *turnoutpb.LocalExprModel {
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Ref{
			Ref: &turnoutpb.LocalRefExprModel{Name: n}}}
	}
	lit := func(v float64) *turnoutpb.LocalExprModel {
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Lit{
			Lit: &turnoutpb.LocalLitExprModel{Value: structpb.NewNumberValue(v)}}}
	}
	ifExpr := func(cond, then, els *turnoutpb.LocalExprModel) *turnoutpb.LocalExprModel {
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_IfExpr{
			IfExpr: &turnoutpb.LocalIfExprModel{Cond: cond, Then: then, ElseBranch: els}}}
	}

	model := minModel("p", []*turnoutpb.BindingModel{
		{Name: "flag", Type: "bool", Value: structpb.NewBoolValue(true)},
		{Name: "a", Type: "number", ExtExpr: ifExpr(ref("flag"), ref("b"), lit(0))},
		{Name: "b", Type: "number", ExtExpr: ifExpr(ref("flag"), ref("a"), lit(0))},
	})
	if !hasCode(validate.Validate(validate.ValidateInput{Model: model, Schema: state.Schema{}}), diag.CodeCyclicBinding) {
		t.Error("want CyclicBinding for mutually-referencing ext_expr-only bindings")
	}
}
