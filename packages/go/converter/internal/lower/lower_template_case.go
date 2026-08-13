package lower

import (
	"encoding/json"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Template case destructuring lowering (literal-template-types-spec.md §12, §19)
//
// A template destructuring arm is lowered to the same ordered CondExpr chain as
// a scalar case, but each arm's condition and capture bindings are expressed
// with the `template_extract` runtime function (which reads a capture's raw text
// from a template value). A literal-constrained field becomes an equality check
// on the extracted text; a bound capture becomes an extract (converted to the
// capture's runtime type) referenced by the arm body under a fresh name.
// ─────────────────────────────────────────────────────────────────────────────

// lowerTemplateCaseInto lowers a case that destructures a template subject.
// Returns false when the subject's template type cannot be recovered, so the
// caller falls back to the inert stub (the validate stage has already reported
// the underlying error).
func (c *localLowerer) lowerTemplateCaseInto(name string, ft ast.FieldType, subject ast.LocalExpr, arms []ast.LocalCaseArm, pc pipeContext) bool {
	tmpl, ok := c.subjectTemplate(subject)
	if !ok {
		return false
	}
	segsJSON := templateSegsJSON(tmpl)

	subjectRef, _ := c.lowerExprTemp(subject, "subject", ast.FieldTypeStr, pc)

	// Partition arms into template-conditional arms and a single catch-all
	// fallback (wildcard or binder). Arms after a catch-all are unreachable and
	// were reported by the validate stage.
	var condArms []ast.LocalCaseArm
	fallbackFn := ""
	for _, arm := range arms {
		switch p := arm.Pattern.(type) {
		case *ast.TemplateCasePattern:
			if fallbackFn == "" {
				condArms = append(condArms, arm)
			}
		case *ast.WildcardCasePattern:
			if fallbackFn == "" {
				fallbackFn = c.lowerFuncTemp(arm.Expr, "case_default", ft, pc)
			}
		case *ast.VarBinderPattern:
			if fallbackFn == "" {
				c.emitIdentity(p.Name, ast.FieldTypeStr, subjectRef)
				fallbackFn = c.lowerFuncTemp(arm.Expr, "case_default", ft, pc)
			}
		}
	}
	if fallbackFn == "" {
		fallbackFn = c.lowerFuncTemp(&ast.LocalLitExpr{Value: zeroLiteralFor(ft)}, "case_default", ft, pc)
	}

	nextFn := fallbackFn
	for i := len(condArms) - 1; i >= 0; i-- {
		arm := condArms[i]
		tp := arm.Pattern.(*ast.TemplateCasePattern)
		rename := c.bindTemplateCaptureRefs(subjectRef, tmpl, segsJSON, tp)
		guard := substituteRefs(arm.Guard, rename)
		body := substituteRefs(arm.Expr, rename)
		condRef := c.templateArmCond(subjectRef, tmpl, segsJSON, tp, guard, pc)
		thenFn := c.lowerFuncTemp(body, "case_then", ft, pc)
		condName := c.temp("case_cond")
		if i == 0 {
			condName = name
		}
		c.appendBinding(&turnoutpb.BindingModel{
			Name: condName,
			Type: ft.ProtoString(),
			Expr: &turnoutpb.ExprModel{Cond: &turnoutpb.CondExpr{
				Condition:  &turnoutpb.ArgModel{Ref: proto.String(condRef)},
				Then:       &turnoutpb.ArgModel{FuncRef: proto.String(thenFn)},
				ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String(nextFn)},
			}},
		}, ft)
		nextFn = condName
	}
	if len(condArms) == 0 {
		c.emitIdentity(name, ft, nextFn)
	}
	return true
}

// subjectTemplate recovers the resolved template type of a case subject when it
// is a direct reference to a binding declared with a template type.
func (c *localLowerer) subjectTemplate(subject ast.LocalExpr) (*ast.TemplateType, bool) {
	ref, ok := subject.(*ast.LocalRefExpr)
	if !ok {
		return nil, false
	}
	dt, ok := c.declaredTypes[ref.Name]
	if !ok {
		return nil, false
	}
	tmpl, ok := ast.Resolve(dt).(*ast.TemplateType)
	return tmpl, ok
}

// templateArmCond emits the boolean match condition for a template arm: the AND
// of an equality check per literal-constrained field, combined with the arm's
// guard. An arm with no constraints and no guard is unconditionally true (the
// subject is already a valid template value).
func (c *localLowerer) templateArmCond(subjectRef string, tmpl *ast.TemplateType, segsJSON string, tp *ast.TemplateCasePattern, guard ast.LocalExpr, pc pipeContext) string {
	var condRef string
	for _, f := range tp.Fields {
		lit, ok := f.Sub.(*ast.LiteralCasePattern)
		if !ok {
			continue
		}
		exRef := c.emitExtract(subjectRef, templateSpecJSON(segsJSON, f.Name))
		cmp := c.temp("case_cmp")
		c.appendBinding(&turnoutpb.BindingModel{
			Name: cmp,
			Type: ast.FieldTypeBool.ProtoString(),
			Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
				Fn: "eq",
				Args: []*turnoutpb.ArgModel{
					{Ref: proto.String(exRef)},
					{Lit: structpb.NewStringValue(renderConstant(lit.Value))},
				},
			}},
		}, ast.FieldTypeBool)
		condRef = c.andBool(condRef, cmp)
	}
	if condRef == "" {
		condRef = c.temp("case_true")
		c.emitValue(condRef, ast.FieldTypeBool, &ast.BoolLiteral{Value: true})
	}
	if guard != nil {
		guardRef, _ := c.lowerExprTemp(guard, "case_guard", ast.FieldTypeBool, pc)
		condRef = c.andBool(condRef, guardRef)
	}
	return condRef
}

// andBool returns a bool binding equal to `acc AND next`, or `next` when acc is
// empty.
func (c *localLowerer) andBool(acc, next string) string {
	if acc == "" {
		return next
	}
	out := c.temp("case_and")
	c.appendBinding(&turnoutpb.BindingModel{
		Name: out,
		Type: ast.FieldTypeBool.ProtoString(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   "bool_and",
			Args: []*turnoutpb.ArgModel{{Ref: proto.String(acc)}, {Ref: proto.String(next)}},
		}},
	}, ast.FieldTypeBool)
	return out
}

// bindTemplateCaptureRefs emits a capture read (as the capture's runtime type)
// for each var-binder field and returns the alpha-renaming used by both the arm
// guard and result expression. Multiple arms may therefore bind the same source
// name without collision.
func (c *localLowerer) bindTemplateCaptureRefs(subjectRef string, tmpl *ast.TemplateType, segsJSON string, tp *ast.TemplateCasePattern) map[string]string {
	captureType := templateCaptureTypeMap(tmpl)
	rename := make(map[string]string)
	for _, f := range tp.Fields {
		binder, ok := f.Sub.(*ast.VarBinderPattern)
		if !ok {
			continue
		}
		spec := templateSpecJSON(segsJSON, f.Name)
		rename[binder.Name] = c.emitCaptureBinder(subjectRef, spec, captureType[f.Name])
	}
	return rename
}

// emitExtract emits a `template_extract(subject, spec)` combine (returning the
// raw captured text) and returns its binding name.
func (c *localLowerer) emitExtract(subjectRef, specJSON string) string {
	return c.emitExtractFn("template_extract", ast.FieldTypeStr, subjectRef, specJSON, "cap_ex")
}

func (c *localLowerer) emitExtractFn(fn string, ft ast.FieldType, subjectRef, specJSON, prefix string) string {
	name := c.temp(prefix)
	c.appendBinding(&turnoutpb.BindingModel{
		Name: name,
		Type: ft.ProtoString(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn: fn,
			Args: []*turnoutpb.ArgModel{
				{Ref: proto.String(subjectRef)},
				{Lit: structpb.NewStringValue(specJSON)},
			},
		}},
	}, ft)
	return name
}

// emitCaptureBinder reads a capture as the capture's runtime type and returns the
// binding name to reference. str captures use template_extract directly; numeric
// captures use template_extract_num; bool captures compare the extracted text to
// "true".
func (c *localLowerer) emitCaptureBinder(subjectRef, specJSON string, captureType ast.Type) string {
	base, _ := ast.BaseFieldType(captureType)
	switch base {
	case ast.FieldTypeNumber:
		return c.emitExtractFn("template_extract_num", ast.FieldTypeNumber, subjectRef, specJSON, "cap_num")
	case ast.FieldTypeBool:
		exRef := c.emitExtract(subjectRef, specJSON)
		name := c.temp("cap_bool")
		c.appendBinding(&turnoutpb.BindingModel{
			Name: name,
			Type: ast.FieldTypeBool.ProtoString(),
			Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
				Fn: "eq",
				Args: []*turnoutpb.ArgModel{
					{Ref: proto.String(exRef)},
					{Lit: structpb.NewStringValue("true")},
				},
			}},
		}, ast.FieldTypeBool)
		return name
	default:
		return c.emitExtract(subjectRef, specJSON) // str capture
	}
}

func templateCaptureTypeMap(tmpl *ast.TemplateType) map[string]ast.Type {
	out := make(map[string]ast.Type)
	for _, cap := range tmpl.Captures() {
		out[cap.Name] = cap.CaptureType
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract-spec JSON (consumed by the runtime binaryFnString::extract)
// ─────────────────────────────────────────────────────────────────────────────

type specSegment struct {
	Text string   `json:"text,omitempty"`
	Cap  string   `json:"cap,omitempty"`
	T    string   `json:"t,omitempty"`
	Vals []string `json:"vals,omitempty"`
}

// templateSegsJSON marshals the resolved template's segments once; templateSpecJSON
// wraps them with the target capture name for a single extract.
func templateSegsJSON(tmpl *ast.TemplateType) string {
	segs := make([]specSegment, 0, len(tmpl.Segments))
	for _, seg := range tmpl.Segments {
		switch s := seg.(type) {
		case *ast.TextSegment:
			segs = append(segs, specSegment{Text: s.Value})
		case *ast.CaptureSegment:
			t, vals := templateSegType(s.CaptureType)
			segs = append(segs, specSegment{Cap: s.Name, T: t, Vals: vals})
		}
	}
	b, _ := json.Marshal(segs)
	return string(b)
}

// templateSpecJSON produces the final `{"want":..,"segs":..}` spec string.
func templateSpecJSON(segsJSON, want string) string {
	b, _ := json.Marshal(want)
	return `{"want":` + string(b) + `,"segs":` + segsJSON + `}`
}

// templateSegType maps a resolved capture type to the runtime matcher's type tag
// and, for finite literal sets, the accepted raw values.
func templateSegType(captureType ast.Type) (string, []string) {
	switch v := ast.Resolve(captureType).(type) {
	case *ast.PrimitiveType:
		return v.Kind.String(), nil
	default:
		if lits, ok := ast.FlattenUnionLiterals(captureType); ok {
			vals := make([]string, 0, len(lits))
			seen := make(map[string]bool)
			for _, l := range lits {
				raw := renderConstant(l.Value)
				if !seen[raw] {
					seen[raw] = true
					vals = append(vals, raw)
				}
			}
			return "enum", vals
		}
	}
	return "str", nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference substitution (alpha-rename bound captures in an arm body)
// ─────────────────────────────────────────────────────────────────────────────

// substituteRefs returns a copy of e with every LocalRefExpr whose name is a key
// of rename replaced by a reference to the renamed binding. The original tree is
// left unchanged so ext_expr re-emission keeps the source names.
func substituteRefs(e ast.LocalExpr, rename map[string]string) ast.LocalExpr {
	if e == nil || len(rename) == 0 {
		return e
	}
	switch x := e.(type) {
	case *ast.LocalRefExpr:
		if to, ok := rename[x.Name]; ok {
			return &ast.LocalRefExpr{Name: to}
		}
		return x
	case *ast.LocalCallExpr:
		args := make([]ast.LocalExpr, len(x.Args))
		for i, a := range x.Args {
			args[i] = substituteRefs(a, rename)
		}
		return &ast.LocalCallExpr{FnAlias: x.FnAlias, Args: args}
	case *ast.LocalInfixExpr:
		return &ast.LocalInfixExpr{Op: x.Op, LHS: substituteRefs(x.LHS, rename), RHS: substituteRefs(x.RHS, rename)}
	case *ast.LocalIfExpr:
		return &ast.LocalIfExpr{
			Cond: substituteRefs(x.Cond, rename),
			Then: substituteRefs(x.Then, rename),
			Else: substituteRefs(x.Else, rename),
		}
	case *ast.LocalPipeExpr:
		steps := make([]ast.LocalExpr, len(x.Steps))
		for i, s := range x.Steps {
			steps[i] = substituteRefs(s, rename)
		}
		return &ast.LocalPipeExpr{Initial: substituteRefs(x.Initial, rename), Steps: steps}
	case *ast.LocalCaseExpr:
		arms := make([]ast.LocalCaseArm, len(x.Arms))
		for i, a := range x.Arms {
			arm := ast.LocalCaseArm{Pos: a.Pos, Pattern: a.Pattern, Expr: substituteRefs(a.Expr, rename)}
			if a.Guard != nil {
				arm.Guard = substituteRefs(a.Guard, rename)
			}
			arms[i] = arm
		}
		return &ast.LocalCaseExpr{Subject: substituteRefs(x.Subject, rename), Arms: arms}
	default:
		// LocalLitExpr, LocalItExpr: no references to rewrite.
		return e
	}
}
