package validate

import (
	"sort"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// #case coverage analysis (literal-template-types-spec.md §14, §16, §17)
//
// Ordered, value-set based analysis over the arms of a #case:
//   - reachability: an arm fully shadowed by earlier arms is unreachable
//     (duplicate literal, or any arm after an unguarded catch-all) — §17.1-§17.3
//   - exhaustiveness: when the subject has a finite literal type, every member
//     value must be covered by some arm (or a catch-all) — §14.1-§14.3
//
// Guards are treated as opaque: a guarded arm never fully covers its pattern,
// so it neither shadows later arms nor contributes to exhaustiveness (§15.2,
// §20.5, §29.5). Exhaustiveness is only checked when the subject type is a known
// finite literal set; infinite types (str, number, bare bool) are left
// unchecked to avoid false positives.
// ─────────────────────────────────────────────────────────────────────────────

// analyzeCaseCoverage runs reachability and exhaustiveness checks over the arms.
func analyzeCaseCoverage(bindingName string, subject *turnoutpb.LocalExprModel, arms []*turnoutpb.LocalCaseArmModel, scope scopeLookup, ds *diag.DiagSink) {
	if caseHasTemplateArm(arms) {
		analyzeTemplateCoverage(bindingName, subject, arms, scope, ds)
		return
	}
	universe, finite := caseSubjectValueSet(subject, scope)

	covered := make(map[string]bool)
	catchAll := false

	for _, arm := range arms {
		guard := arm.GetGuard() != nil
		p := arm.GetPattern()
		if p == nil {
			continue
		}
		switch x := p.Pattern.(type) {
		case *turnoutpb.LocalCasePatternModel_Wildcard, *turnoutpb.LocalCasePatternModel_VarBinder:
			if catchAll {
				ds.Append(diag.Errorf(diag.CodeUnreachableArm,
					"binding %q: unreachable #case arm; a previous arm already matches every value", bindingName))
				continue
			}
			if !guard {
				catchAll = true
			}
		case *turnoutpb.LocalCasePatternModel_Lit:
			val := ast.NewLiteralType(ast.Pos{}, structpbToLiteral(x.Lit.GetValue())).String()
			if catchAll {
				ds.Append(diag.Errorf(diag.CodeUnreachableArm,
					"binding %q: unreachable #case arm for %s; a previous arm already matches every value",
					bindingName, val))
				continue
			}
			if covered[val] {
				ds.Append(diag.Errorf(diag.CodeDuplicateCasePattern,
					"binding %q: unreachable #case arm; pattern %s is fully covered by a previous arm",
					bindingName, val))
				continue
			}
			if !guard {
				covered[val] = true
			}
		}
	}

	if catchAll || !finite {
		return
	}
	var missing []string
	for _, v := range universe {
		if !covered[v] {
			missing = append(missing, v)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		ds.Append(diag.Errorf(diag.CodeNonExhaustiveMatch,
			"binding %q: non-exhaustive #case\n\nmissing:\n- %s",
			bindingName, strings.Join(missing, "\n- ")))
	}
}

func caseHasTemplateArm(arms []*turnoutpb.LocalCaseArmModel) bool {
	for _, arm := range arms {
		if _, ok := arm.GetPattern().GetPattern().(*turnoutpb.LocalCasePatternModel_Template); ok {
			return true
		}
	}
	return false
}

// analyzeTemplateCoverage performs reachability and exhaustiveness analysis for
// a #case that destructures a template subject (literal-template-types-spec.md
// §14.4-14.6, §17.4). It works over the product of the subject's finite capture
// domains (literal unions); infinite captures (str/integer/number) do not
// prevent exhaustiveness when left unconstrained (§14.6).
func analyzeTemplateCoverage(bindingName string, subject *turnoutpb.LocalExprModel, arms []*turnoutpb.LocalCaseArmModel, scope scopeLookup, ds *diag.DiagSink) {
	tmpl, ok := templateOfSubject(subjectDeclaredType(subject, scope))
	if !ok {
		return // pattern well-formedness (non-template subject) reported elsewhere
	}

	finite := finiteCaptureDomains(tmpl)
	full := cartesian(finite)
	covered := make(map[string]bool)
	catchAll := false

	for _, arm := range arms {
		guard := arm.GetGuard() != nil
		p := arm.GetPattern()
		switch x := p.GetPattern().(type) {
		case *turnoutpb.LocalCasePatternModel_Wildcard, *turnoutpb.LocalCasePatternModel_VarBinder:
			if catchAll {
				ds.Append(diag.Errorf(diag.CodeUnreachableArm,
					"binding %q: unreachable #case arm; a previous arm already matches every value", bindingName))
				continue
			}
			if !guard {
				catchAll = true
			}
		case *turnoutpb.LocalCasePatternModel_Template:
			combos, fully := armFiniteCombos(x.Template, finite)
			if catchAll {
				ds.Append(diag.Errorf(diag.CodeUnreachableArm,
					"binding %q: unreachable #case arm; a previous arm already matches every value", bindingName))
				continue
			}
			if guard || !fully {
				// A guarded arm, or one that constrains an infinite capture, does
				// not fully cover its region: it neither shadows nor completes
				// coverage (§15.2, §17.5).
				continue
			}
			if allCovered(combos, covered) {
				ds.Append(diag.Errorf(diag.CodeUnreachableArm,
					"binding %q: unreachable #case arm; pattern is fully covered by earlier arms", bindingName))
				continue
			}
			for _, k := range combos {
				covered[k] = true
			}
		}
	}

	if catchAll {
		return
	}
	var missing []string
	for _, combo := range full {
		if !covered[combo] {
			missing = append(missing, combo)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		ds.Append(diag.Errorf(diag.CodeNonExhaustiveMatch,
			"binding %q: non-exhaustive #case for template subject\n\nuncovered:\n- %s",
			bindingName, strings.Join(missing, "\n- ")))
	}
}

// finiteCapture pairs a capture name with the ordered canonical value strings of
// its finite literal domain.
type finiteCapture struct {
	name   string
	values []string
}

// finiteCaptureDomains returns the subject's captures that have a finite literal
// domain (a literal or literal union), in declaration order.
func finiteCaptureDomains(tmpl *ast.TemplateType) []finiteCapture {
	var out []finiteCapture
	for _, c := range tmpl.Captures() {
		if lits, ok := ast.FlattenUnionLiterals(c.CaptureType); ok {
			seen := make(map[string]bool)
			var vals []string
			for _, l := range lits {
				s := l.String()
				if !seen[s] {
					seen[s] = true
					vals = append(vals, s)
				}
			}
			out = append(out, finiteCapture{name: c.Name, values: vals})
		}
	}
	return out
}

// cartesian returns every combination of finite-capture values as a canonical
// key string. An empty finite set yields a single empty combo.
func cartesian(caps []finiteCapture) []string {
	combos := []string{""}
	for _, c := range caps {
		var next []string
		for _, prefix := range combos {
			for _, v := range c.values {
				next = append(next, prefix+"|"+c.name+"="+v)
			}
		}
		combos = next
	}
	return combos
}

// armFiniteCombos returns the finite-capture combinations an arm covers and
// whether it fully covers them (no infinite-capture constraint). A finite
// capture constrained by a literal contributes that single value; an
// unconstrained / bound / wildcard field contributes the full domain.
func armFiniteCombos(tp *turnoutpb.LocalTemplatePatternModel, finite []finiteCapture) (combos []string, fully bool) {
	constraints := make(map[string]string)
	for _, f := range tp.GetFields() {
		if lit, ok := f.GetPattern().GetPattern().(*turnoutpb.LocalCasePatternModel_Lit); ok {
			constraints[f.GetName()] = ast.NewLiteralType(ast.Pos{}, structpbToLiteral(lit.Lit.GetValue())).String()
		}
	}
	finiteNames := make(map[string]bool, len(finite))
	for _, c := range finite {
		finiteNames[c.name] = true
	}
	// If any field constrains a non-finite (infinite) capture with a literal, the
	// arm does not fully cover its finite region.
	fully = true
	for name := range constraints {
		if !finiteNames[name] {
			fully = false
		}
	}
	selected := make([]finiteCapture, len(finite))
	for i, c := range finite {
		if v, ok := constraints[c.name]; ok {
			selected[i] = finiteCapture{name: c.name, values: []string{v}}
		} else {
			selected[i] = c
		}
	}
	return cartesian(selected), fully
}

func allCovered(combos []string, covered map[string]bool) bool {
	for _, k := range combos {
		if !covered[k] {
			return false
		}
	}
	return true
}

// caseSubjectValueSet returns the finite set of canonical value strings the
// subject can take, and finite=true, when the subject's declared type is a
// finite literal set. Otherwise finite=false.
func caseSubjectValueSet(subject *turnoutpb.LocalExprModel, scope scopeLookup) (values []string, finite bool) {
	declared := subjectDeclaredType(subject, scope)
	if declared == nil {
		return nil, false
	}
	lits, ok := ast.FlattenUnionLiterals(declared)
	if !ok {
		return nil, false
	}
	seen := make(map[string]bool, len(lits))
	for _, l := range lits {
		s := l.String()
		if !seen[s] {
			seen[s] = true
			values = append(values, s)
		}
	}
	return values, true
}

// subjectDeclaredType returns the resolved declared type of a #case subject when
// the subject is a direct reference to a binding carrying a declared type.
func subjectDeclaredType(subject *turnoutpb.LocalExprModel, scope scopeLookup) ast.Type {
	if subject == nil {
		return nil
	}
	ref, ok := subject.Expr.(*turnoutpb.LocalExprModel_Ref)
	if !ok {
		return nil
	}
	info, ok := scope.get(ref.Ref.GetName())
	if !ok {
		return nil
	}
	return info.declaredType
}
