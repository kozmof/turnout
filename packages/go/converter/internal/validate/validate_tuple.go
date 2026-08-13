package validate

import (
	"fmt"
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"sort"
	"strings"
)

type tupleValueInfo struct {
	ft       ast.FieldType
	known    bool
	decl     ast.Type
	declName string
	elems    []tupleValueInfo
}

func tupleInfo(e *turnoutpb.LocalExprModel, scope scopeLookup, bindingName string, ds *diag.DiagSink) tupleValueInfo {
	if tuple, ok := e.GetExpr().(*turnoutpb.LocalExprModel_TupleExpr); ok {
		out := tupleValueInfo{elems: make([]tupleValueInfo, len(tuple.TupleExpr.GetElems()))}
		for i, elem := range tuple.TupleExpr.GetElems() {
			out.elems[i] = tupleInfo(elem, scope, bindingName, ds)
		}
		return out
	}
	ft, known := validateProtoLocalExpr(bindingName, e, scope, 0, false, ds)
	return tupleValueInfo{ft: ft, known: known, decl: subjectDeclaredType(e, scope), declName: subjectDeclaredTypeName(e, scope)}
}

func validateProtoTupleCase(bindingName string, subject *turnoutpb.LocalTupleExprModel, arms []*turnoutpb.LocalCaseArmModel, scope scopeLookup, itType ast.FieldType, itAllowed bool, ds *diag.DiagSink) (ast.FieldType, bool) {
	root := tupleValueInfo{elems: make([]tupleValueInfo, len(subject.GetElems()))}
	for i, elem := range subject.GetElems() {
		root.elems[i] = tupleInfo(elem, scope, bindingName, ds)
	}
	analyzeTupleCoverage(bindingName, root, arms, ds)
	var ret ast.FieldType = ast.FieldTypeInvalid
	retOK := false
	for _, arm := range arms {
		armScope := validateTuplePattern(bindingName, arm.GetPattern(), root, scope, ds)
		if arm.GetGuard() != nil {
			gt, ok := validateProtoLocalExpr(bindingName, arm.GetGuard(), armScope, itType, itAllowed, ds)
			if ok && gt != ast.FieldTypeBool {
				ds.Append(diag.Errorf(diag.CodeCondNotBool, "binding %q: case guard has type %s; bool required", bindingName, gt))
			}
		}
		at, ok := validateProtoLocalExpr(bindingName, arm.GetExpr(), armScope, itType, itAllowed, ds)
		if !ok {
			continue
		}
		if retOK && at != ret {
			ds.Append(diag.Errorf(diag.CodeBranchTypeMismatch, "binding %q: case arms return %s and %s", bindingName, ret, at))
			continue
		}
		ret, retOK = at, true
	}
	return ret, retOK
}

func validateTuplePattern(bindingName string, p *turnoutpb.LocalCasePatternModel, value tupleValueInfo, scope scopeLookup, ds *diag.DiagSink) scopeLookup {
	if p == nil {
		return scope
	}
	switch x := p.GetPattern().(type) {
	case *turnoutpb.LocalCasePatternModel_Wildcard:
		return scope
	case *turnoutpb.LocalCasePatternModel_VarBinder:
		if len(value.elems) != 0 {
			ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct, "binding %q: binding an entire tuple is not supported; destructure its elements", bindingName))
			return scope
		}
		if value.known {
			return &scopeChain{name: x.VarBinder.GetName(), info: bindingInfo{fieldType: value.ft, declaredType: value.decl}, parent: scope}
		}
	case *turnoutpb.LocalCasePatternModel_Lit:
		if len(value.elems) != 0 {
			ds.Append(diag.Errorf(diag.CodeArgTypeMismatch, "binding %q: scalar pattern cannot match a tuple value", bindingName))
			return scope
		}
		validateProtoPattern(bindingName, p, value.ft, value.known, value.decl, value.declName, ds)
	case *turnoutpb.LocalCasePatternModel_Template:
		if len(value.elems) != 0 {
			ds.Append(diag.Errorf(diag.CodeArgTypeMismatch, "binding %q: template pattern cannot match a tuple value", bindingName))
			return scope
		}
		validateTemplatePattern(bindingName, x.Template, value.decl, value.declName, ds)
		return templatePatternScope(scope, x.Template, value.decl)
	case *turnoutpb.LocalCasePatternModel_Tuple:
		if len(value.elems) == 0 {
			ds.Append(diag.Errorf(diag.CodeArgTypeMismatch, "binding %q: tuple pattern requires a tuple value", bindingName))
			return scope
		}
		if len(x.Tuple.GetElems()) != len(value.elems) {
			ds.Append(diag.Errorf(diag.CodeArgTypeMismatch, "binding %q: tuple pattern has %d elements but subject has %d", bindingName, len(x.Tuple.GetElems()), len(value.elems)))
			return scope
		}
		result := scope
		for i, sub := range x.Tuple.GetElems() {
			result = validateTuplePattern(bindingName, sub, value.elems[i], result, ds)
		}
		return result
	}
	return scope
}

func tupleDomain(v tupleValueInfo) ([]string, bool) {
	if len(v.elems) != 0 {
		parts := make([][]string, len(v.elems))
		for i, elem := range v.elems {
			var ok bool
			parts[i], ok = tupleDomain(elem)
			if !ok {
				return nil, false
			}
		}
		return tupleProduct(parts), true
	}
	if tmpl, ok := templateOfSubject(v.decl); ok {
		return prefixValues("template", cartesian(finiteCaptureDomains(tmpl))), true
	}
	if v.decl != nil {
		if lits, ok := ast.FlattenUnionLiterals(v.decl); ok {
			vals := make([]string, len(lits))
			for i, lit := range lits {
				vals[i] = "lit:" + lit.String()
			}
			return vals, true
		}
	}
	if v.known && v.ft == ast.FieldTypeBool {
		return []string{"lit:true", "lit:false"}, true
	}
	return []string{"*"}, true
}

func tuplePatternDomain(p *turnoutpb.LocalCasePatternModel, v tupleValueInfo) ([]string, bool) {
	if p == nil {
		return tupleDomain(v)
	}
	switch x := p.GetPattern().(type) {
	case *turnoutpb.LocalCasePatternModel_Wildcard, *turnoutpb.LocalCasePatternModel_VarBinder:
		return tupleDomain(v)
	case *turnoutpb.LocalCasePatternModel_Lit:
		if len(v.elems) != 0 {
			return nil, false
		}
		return []string{"lit:" + ast.NewLiteralType(ast.Pos{}, structpbToLiteral(x.Lit.GetValue())).String()}, v.decl != nil || (v.known && v.ft == ast.FieldTypeBool)
	case *turnoutpb.LocalCasePatternModel_Template:
		tmpl, ok := templateOfSubject(v.decl)
		if !ok {
			return nil, false
		}
		vals, fully := armFiniteCombos(x.Template, finiteCaptureDomains(tmpl))
		return prefixValues("template", vals), fully
	case *turnoutpb.LocalCasePatternModel_Tuple:
		if len(x.Tuple.GetElems()) != len(v.elems) {
			return nil, false
		}
		parts := make([][]string, len(v.elems))
		fully := true
		for i, sub := range x.Tuple.GetElems() {
			var ok bool
			parts[i], ok = tuplePatternDomain(sub, v.elems[i])
			fully = fully && ok
		}
		return tupleProduct(parts), fully
	}
	return nil, false
}

func prefixValues(prefix string, vals []string) []string {
	out := make([]string, len(vals))
	for i, v := range vals {
		out[i] = prefix + v
	}
	return out
}
func tupleProduct(parts [][]string) []string {
	out := []string{""}
	for i, part := range parts {
		var next []string
		for _, pre := range out {
			for _, v := range part {
				next = append(next, pre+fmt.Sprintf("|%d=%s", i, v))
			}
		}
		out = next
	}
	return out
}

func analyzeTupleCoverage(bindingName string, root tupleValueInfo, arms []*turnoutpb.LocalCaseArmModel, ds *diag.DiagSink) {
	full, ok := tupleDomain(root)
	if !ok {
		return
	}
	covered := map[string]bool{}
	for _, arm := range arms {
		vals, fully := tuplePatternDomain(arm.GetPattern(), root)
		if arm.GetGuard() != nil || !fully {
			continue
		}
		if len(vals) != 0 && allCovered(vals, covered) {
			ds.Append(diag.Errorf(diag.CodeUnreachableArm, "binding %q: unreachable case arm; tuple pattern is fully covered by earlier arms", bindingName))
			continue
		}
		for _, v := range vals {
			covered[v] = true
		}
	}
	var missing []string
	for _, v := range full {
		if !covered[v] {
			missing = append(missing, v)
		}
	}
	if len(missing) != 0 {
		sort.Strings(missing)
		ds.Append(diag.Errorf(diag.CodeNonExhaustiveMatch, "binding %q: non-exhaustive case for tuple subject\n\nuncovered:\n- %s", bindingName, strings.Join(missing, "\n- ")))
	}
}
