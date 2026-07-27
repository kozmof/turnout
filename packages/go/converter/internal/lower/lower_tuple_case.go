package lower

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/proto"
)

type tupleLowerValue struct {
	expr  ast.LocalExpr
	ref   string
	type_ ast.FieldType
	elems []tupleLowerValue
}

func caseHasTuplePattern(arms []ast.LocalCaseArm) bool {
	for _, arm := range arms {
		if _, ok := arm.Pattern.(*ast.TupleCasePattern); ok {
			return true
		}
	}
	return false
}

func (c *localLowerer) lowerTupleValue(e ast.LocalExpr, ft ast.FieldType, pc pipeContext) tupleLowerValue {
	if tuple, ok := e.(*ast.LocalTupleExpr); ok {
		v := tupleLowerValue{expr: e, elems: make([]tupleLowerValue, len(tuple.Elems))}
		for i, elem := range tuple.Elems {
			et, ok := c.inferLocalType(elem, ft, pc)
			if !ok {
				et = ft
			}
			v.elems[i] = c.lowerTupleValue(elem, et, pc)
		}
		return v
	}
	ref, typ := c.lowerExprTemp(e, "tuple_elem", ft, pc)
	return tupleLowerValue{expr: e, ref: ref, type_: typ}
}

func (c *localLowerer) lowerTupleCaseInto(name string, ft ast.FieldType, subject ast.LocalExpr, arms []ast.LocalCaseArm, pc pipeContext) bool {
	tuple, ok := subject.(*ast.LocalTupleExpr)
	if !ok {
		c.ds.Append(diag.Errorf(diag.CodeArgTypeMismatch, "binding %q: tuple pattern requires a tuple subject", c.target))
		return false
	}
	root := c.lowerTupleValue(tuple, ft, pc)
	fallback := c.lowerFuncTemp(&ast.LocalLitExpr{Value: zeroLiteralFor(ft)}, "case_default", ft, pc)
	next := fallback
	for i := len(arms) - 1; i >= 0; i-- {
		arm := arms[i]
		rename := map[string]string{}
		cond, matched := c.lowerTuplePattern(root, arm.Pattern, rename, pc)
		if !matched {
			continue
		}
		if guard := substituteRefs(arm.Guard, rename); guard != nil {
			guardRef, _ := c.lowerExprTemp(guard, "case_guard", ast.FieldTypeBool, pc)
			cond = c.andBool(cond, guardRef)
		}
		thenFn := c.lowerFuncTemp(substituteRefs(arm.Expr, rename), "case_then", ft, pc)
		condName := c.temp("case_cond")
		if i == 0 {
			condName = name
		}
		c.appendBinding(&turnoutpb.BindingModel{Name: condName, Type: ft.ProtoString(), Expr: &turnoutpb.ExprModel{Cond: &turnoutpb.CondExpr{Condition: &turnoutpb.ArgModel{Ref: proto.String(cond)}, Then: &turnoutpb.ArgModel{FuncRef: proto.String(thenFn)}, ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String(next)}}}}, ft)
		next = condName
	}
	if next == fallback {
		c.emitIdentity(name, ft, fallback)
	}
	return true
}

func (c *localLowerer) lowerTuplePattern(value tupleLowerValue, pattern ast.LocalCasePattern, rename map[string]string, pc pipeContext) (string, bool) {
	trueRef := func() string {
		n := c.temp("tuple_true")
		c.emitValue(n, ast.FieldTypeBool, &ast.BoolLiteral{Value: true})
		return n
	}
	switch p := pattern.(type) {
	case *ast.WildcardCasePattern:
		return trueRef(), true
	case *ast.VarBinderPattern:
		if value.ref == "" {
			return "", false
		}
		rename[p.Name] = value.ref
		return trueRef(), true
	case *ast.LiteralCasePattern:
		if value.ref == "" {
			return "", false
		}
		lit := c.temp("tuple_lit")
		c.emitValue(lit, value.type_, p.Value)
		cmp := c.temp("tuple_cmp")
		c.appendBinding(&turnoutpb.BindingModel{Name: cmp, Type: ast.FieldTypeBool.ProtoString(), Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{Fn: "eq", Args: []*turnoutpb.ArgModel{{Ref: proto.String(value.ref)}, {Ref: proto.String(lit)}}}}}, ast.FieldTypeBool)
		return cmp, true
	case *ast.TupleCasePattern:
		if len(value.elems) != len(p.Elems) {
			return "", false
		}
		var cond string
		for i, sub := range p.Elems {
			part, ok := c.lowerTuplePattern(value.elems[i], sub, rename, pc)
			if !ok {
				return "", false
			}
			cond = c.andBool(cond, part)
		}
		return cond, true
	case *ast.TemplateCasePattern:
		if value.ref == "" {
			return "", false
		}
		tmpl, ok := c.subjectTemplate(value.expr)
		if !ok {
			return "", false
		}
		segs := templateSegsJSON(tmpl)
		for from, to := range c.bindTemplateCaptureRefs(value.ref, tmpl, segs, p) {
			rename[from] = to
		}
		return c.templateArmCond(value.ref, tmpl, segs, p, nil, pc), true
	default:
		return "", false
	}
}
