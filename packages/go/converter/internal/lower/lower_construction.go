package lower

import (
	"strconv"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/fnmeta"
	"google.golang.org/protobuf/proto"
)

// foldConstruction validates a typed template construction (literal-template-types-spec.md §11) and,
// when every field value is a compile-time constant, serialises it to the
// canonical template string. It reports (§11.4–§11.6):
//   - UnknownType         — the constructed name is not a declared type
//   - UnsupportedConstruct— the name is not a template, or a value is non-constant
//   - MissingCapture      — a required capture was not provided
//   - UnknownCapture      — a provided field is not a capture of the template
//   - NotAssignable       — a field value is not assignable to its capture type
//   - InvalidTemplateValue— the serialised value is (unexpectedly) not a member
//
// It returns (folded, constant, ok). When ok && constant, folded is the
// serialized string. When ok && !constant, the construction is valid but has
// non-constant field values; tc.Resolved is set so the lowerer builds it at
// runtime. When !ok, a diagnostic was emitted and the construction is invalid.
func foldConstruction(tc *ast.TemplateConstructionRHS, lookup, refType func(string) (ast.Type, bool), ds *diag.DiagSink) (folded string, constant bool, ok bool) {
	pos := tc.Pos
	named, found := lookup(tc.TypeName)
	if !found {
		ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeUnknownType,
			"cannot construct %q: unknown type", tc.TypeName))
		return "", false, false
	}
	ast.ResolveNamedRefs(named, lookup)
	tmpl, isTemplate := ast.Resolve(named).(*ast.TemplateType)
	if !isTemplate {
		ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeUnsupportedConstruct,
			"cannot construct %q: only template literal types support construction", tc.TypeName))
		return "", false, false
	}

	captures := tmpl.Captures()
	captureByName := make(map[string]*ast.CaptureSegment, len(captures))
	for _, c := range captures {
		captureByName[c.Name] = c
	}

	// Index provided fields; report duplicates and unknown captures (§11.6). A
	// field naming a known capture is recorded in `seen` even when its value is
	// invalid, so it is not also reported as a missing capture. constants holds
	// the value of each constant field; a construction with a non-constant
	// (reference) field is built at runtime.
	constants := make(map[string]ast.Literal, len(tc.Fields))
	seen := make(map[string]bool, len(tc.Fields))
	hadError := false
	allConstant := true
	for _, f := range tc.Fields {
		capture, known := captureByName[f.Name]
		if !known {
			ds.Append(diag.ErrorAt(f.Pos.File, f.Pos.Line, f.Pos.Col, diag.CodeUnknownCapture,
				"unknown capture %q for %s", f.Name, tc.TypeName))
			hadError = true
			continue
		}
		seen[f.Name] = true
		switch v := f.Value.(type) {
		case *ast.LitArg:
			if !ast.LiteralInType(v.Value, capture.CaptureType) {
				ds.Append(diag.ErrorAt(f.Pos.File, f.Pos.Line, f.Pos.Col, diag.CodeNotAssignable,
					"cannot construct %s: capture %q requires %s, received %s",
					tc.TypeName, f.Name, capture.CaptureType.String(),
					ast.NewLiteralType(ast.Pos{}, v.Value).String()))
				hadError = true
				continue
			}
			constants[f.Name] = v.Value
		case *ast.RefArg:
			allConstant = false
			if rt, ok := refType(v.Name); ok && !ast.Assignable(rt, capture.CaptureType) {
				ds.Append(diag.ErrorAt(f.Pos.File, f.Pos.Line, f.Pos.Col, diag.CodeNotAssignable,
					"cannot construct %s: capture %q requires %s, received %s",
					tc.TypeName, f.Name, capture.CaptureType.String(), rt.String()))
				hadError = true
			}
		default:
			ds.Append(diag.ErrorAt(f.Pos.File, f.Pos.Line, f.Pos.Col, diag.CodeUnsupportedConstruct,
				"cannot construct %s: capture %q must be a constant or a variable reference", tc.TypeName, f.Name))
			hadError = true
		}
	}

	// Report captures that were never provided (§11.5).
	for _, c := range captures {
		if !seen[c.Name] {
			ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeMissingCapture,
				"missing required capture %q for %s", c.Name, tc.TypeName))
			hadError = true
		}
	}
	if hadError {
		return "", false, false
	}
	if !allConstant {
		// Valid, but built at runtime from variable references.
		tc.Resolved = tmpl
		return "", false, true
	}

	// Serialise constants: concatenate static text and rendered capture values (§20.2).
	var b []byte
	for _, seg := range tmpl.Segments {
		switch s := seg.(type) {
		case *ast.TextSegment:
			b = append(b, s.Value...)
		case *ast.CaptureSegment:
			b = append(b, renderConstant(constants[s.Name])...)
		}
	}
	result := string(b)

	// Sanity check: the serialised value must be a member of the template.
	if !ast.TemplateContains(tmpl, result) {
		ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeInvalidTemplateValue,
			"constructed value %q is not a valid %s", result, tc.TypeName))
		return "", false, false
	}
	return result, true, true
}

// lowerConstructionInto builds the runtime str-concatenation for a validated
// non-constant template construction, emitting synthetic bindings via the local
// lowerer. Each capture value is serialised to a string (str captures directly;
// numeric/bool captures via a toStr transform) and concatenated in template
// order. The final binding is named `name`.
func (c *localLowerer) lowerConstructionInto(name string, ft ast.FieldType, tc *ast.TemplateConstructionRHS) {
	fieldValue := make(map[string]ast.SyntaxArg, len(tc.Fields))
	for _, f := range tc.Fields {
		fieldValue[f.Name] = f.Value
	}
	parts := make([]*turnoutpb.ArgModel, 0, len(tc.Resolved.Segments))
	for _, seg := range tc.Resolved.Segments {
		switch s := seg.(type) {
		case *ast.TextSegment:
			parts = append(parts, &turnoutpb.ArgModel{Lit: ast.LiteralToStructpb(ast.NewStringLiteral(ast.Pos{}, s.Value))})
		case *ast.CaptureSegment:
			parts = append(parts, capturePartArg(fieldValue[s.Name], s.CaptureType))
		}
	}
	// Seed with an empty string so the left fold is uniform for any part count.
	acc := c.temp("build_seed")
	c.emitValue(acc, ast.FieldTypeStr, ast.NewStringLiteral(ast.Pos{}, ""))
	if len(parts) == 0 {
		c.emitIdentity(name, ft, acc)
		return
	}
	for i, part := range parts {
		out := name
		if i < len(parts)-1 {
			out = c.temp("build_concat")
		}
		c.appendBinding(&turnoutpb.BindingModel{
			Name: out,
			Type: ast.FieldTypeStr.ProtoString(),
			Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
				Fn:   "str_concat",
				Args: []*turnoutpb.ArgModel{{Ref: proto.String(acc)}, part},
			}},
		}, ast.FieldTypeStr)
		acc = out
	}
}

// capturePartArg renders one capture value as a string-typed combine argument: a
// str value is used directly; a numeric or bool value is wrapped in a toStr
// transform; a constant literal is rendered inline.
func capturePartArg(arg ast.SyntaxArg, captureType ast.Type) *turnoutpb.ArgModel {
	if lit, ok := arg.(*ast.LitArg); ok {
		return &turnoutpb.ArgModel{Lit: ast.LiteralToStructpb(ast.NewStringLiteral(ast.Pos{}, renderConstant(lit.Value)))}
	}
	ref, ok := arg.(*ast.RefArg)
	if !ok {
		return &turnoutpb.ArgModel{Lit: ast.LiteralToStructpb(ast.NewStringLiteral(ast.Pos{}, ""))}
	}
	base, _ := ast.BaseFieldType(captureType)
	switch base {
	case ast.FieldTypeNumber:
		if fn, _, ok := fnmeta.LookupMethod("toStr", ast.FieldTypeNumber); ok {
			return &turnoutpb.ArgModel{Transform: &turnoutpb.TransformArg{Ref: ref.Name, Fn: []string{fn}}}
		}
	case ast.FieldTypeBool:
		if fn, _, ok := fnmeta.LookupMethod("toStr", ast.FieldTypeBool); ok {
			return &turnoutpb.ArgModel{Transform: &turnoutpb.TransformArg{Ref: ref.Name, Fn: []string{fn}}}
		}
	}
	// str (and string-literal / union) captures are already strings.
	return &turnoutpb.ArgModel{Ref: proto.String(ref.Name)}
}

// renderConstant renders a scalar literal as its template-serialised text (raw,
// unquoted): strings verbatim, numbers canonically, booleans as true/false.
func renderConstant(lit ast.Literal) string {
	switch v := lit.(type) {
	case *ast.StringLiteral:
		return v.Value
	case *ast.NumberLiteral:
		if v.Value == float64(int64(v.Value)) {
			return strconv.FormatInt(int64(v.Value), 10)
		}
		return strconv.FormatFloat(v.Value, 'g', -1, 64)
	case *ast.BoolLiteral:
		return strconv.FormatBool(v.Value)
	}
	return ""
}
