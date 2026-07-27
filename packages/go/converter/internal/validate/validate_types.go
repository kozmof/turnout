package validate

import (
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Type declaration validation (literal-template-types-spec.md §5, §21, §23)
//
// Validates the program's named type declarations: duplicate names, references
// to undeclared types, cyclic aliases, and literal-union consistency (duplicate
// members, mixed base types). Returns a registry of resolved AST types keyed by
// name for use by later type-checking passes.
// ─────────────────────────────────────────────────────────────────────────────

// typeRegistry holds the resolved AST types of a program, keyed by declaration
// name, along with the source position of each declaration for diagnostics.
type typeRegistry struct {
	types map[string]ast.Type
	pos   map[string]ast.Pos
}

func (r *typeRegistry) get(name string) (ast.Type, bool) {
	t, ok := r.types[name]
	return t, ok
}

// resolveProto converts a proto TypeExpr to a resolved AST type using the
// registry. Returns nil for a nil input.
func (r *typeRegistry) resolveProto(te *turnoutpb.TypeExpr) ast.Type {
	if te == nil {
		return nil
	}
	t := protoTypeToAST(te)
	ast.ResolveNamedRefs(t, r.get)
	return t
}

// validateTypeDecls validates all type declarations and returns a registry of
// resolved types. Declarations that fail validation are still recorded (with
// unresolved references) so downstream passes degrade gracefully.
func validateTypeDecls(decls []*turnoutpb.TypeDeclModel, ds *diag.DiagSink) *typeRegistry {
	reg := &typeRegistry{
		types: make(map[string]ast.Type, len(decls)),
		pos:   make(map[string]ast.Pos, len(decls)),
	}
	if len(decls) == 0 {
		return reg
	}

	// Pass 1: build the registry and detect duplicate names.
	for _, d := range decls {
		p := protoPos(d.SourcePos)
		if _, dup := reg.types[d.Name]; dup {
			ds.Append(diag.ErrorAt(p.File, p.Line, p.Col, diag.CodeDuplicateTypeDecl,
				"duplicate type declaration %q", d.Name))
			continue
		}
		reg.types[d.Name] = protoTypeToAST(d.Type)
		reg.pos[d.Name] = p
	}

	// Pass 2: report references to undeclared types.
	for _, d := range decls {
		t, ok := reg.types[d.Name]
		if !ok {
			continue
		}
		p := reg.pos[d.Name]
		ast.WalkNamed(t, func(nt *ast.NamedType) {
			if _, known := reg.types[nt.Name]; !known {
				ds.Append(diag.ErrorAt(p.File, p.Line, p.Col, diag.CodeUnknownType,
					"unknown type %q referenced in declaration %q", nt.Name, d.Name))
			}
		})
	}

	// Pass 3: detect cyclic aliases before resolving (resolution would loop).
	cyclic := detectTypeCycles(reg, ds)

	// Pass 4: resolve named references for acyclic declarations.
	for name, t := range reg.types {
		if cyclic[name] {
			continue
		}
		ast.ResolveNamedRefs(t, reg.get)
	}

	// Pass 5: validate literal-union consistency (§5.2, §5.3) and template
	// determinism / capture rules (§6, §7).
	for _, d := range decls {
		t, ok := reg.types[d.Name]
		if !ok || cyclic[d.Name] {
			continue
		}
		validateUnions(t, d.Name, reg.pos[d.Name], ds)
		validateTemplates(t, d.Name, reg.pos[d.Name], ds)
	}

	return reg
}

// detectTypeCycles finds cyclic alias chains and returns the set of declaration
// names participating in a cycle. Only direct type-name references form edges;
// a cycle through a template capture is also a (rejected) recursive template.
func detectTypeCycles(reg *typeRegistry, ds *diag.DiagSink) map[string]bool {
	// Build the reference graph: decl name → names it references.
	edges := make(map[string][]string, len(reg.types))
	for name, t := range reg.types {
		var refs []string
		ast.WalkNamed(t, func(nt *ast.NamedType) {
			if _, known := reg.types[nt.Name]; known {
				refs = append(refs, nt.Name)
			}
		})
		edges[name] = refs
	}

	const (
		white = 0
		gray  = 1
		black = 2
	)
	color := make(map[string]int, len(edges))
	cyclic := make(map[string]bool)
	var stack []string

	var dfs func(name string)
	dfs = func(name string) {
		color[name] = gray
		stack = append(stack, name)
		for _, next := range edges[name] {
			switch color[next] {
			case white:
				dfs(next)
			case gray:
				// Found a back-edge: report the cycle path next → ... → name → next.
				cycle := extractCycle(stack, next)
				for _, n := range cycle {
					cyclic[n] = true
				}
				p := reg.pos[next]
				ds.Append(diag.ErrorAt(p.File, p.Line, p.Col, diag.CodeCyclicTypeAlias,
					"cyclic type alias:\n%s", strings.Join(append(cycle, next), " -> ")))
			}
		}
		stack = stack[:len(stack)-1]
		color[name] = black
	}

	for name := range edges {
		if color[name] == white {
			dfs(name)
		}
	}
	return cyclic
}

// extractCycle returns the suffix of stack beginning at start.
func extractCycle(stack []string, start string) []string {
	for i, n := range stack {
		if n == start {
			out := make([]string, len(stack)-i)
			copy(out, stack[i:])
			return out
		}
	}
	return []string{start}
}

// validateUnions walks t and validates each union it contains for duplicate
// members and mixed base types (§5.2, §5.3).
func validateUnions(t ast.Type, declName string, p ast.Pos, ds *diag.DiagSink) {
	switch v := t.(type) {
	case *ast.UnionType:
		lits, ok := ast.FlattenUnionLiterals(v)
		if !ok {
			ds.Append(diag.ErrorAt(p.File, p.Line, p.Col, diag.CodeMixedUnionBase,
				"type %q: union members must be literal types", declName))
			return
		}
		members := make([]ast.Type, len(lits))
		for i, l := range lits {
			members[i] = l
		}
		res := ast.CheckUnionMembers(members)
		for _, dup := range res.Duplicates {
			ds.Append(diag.ErrorAt(p.File, p.Line, p.Col, diag.CodeDuplicateUnionMember,
				"duplicate union member %s", dup))
		}
		if res.MixedBase {
			ds.Append(diag.ErrorAt(p.File, p.Line, p.Col, diag.CodeMixedUnionBase,
				"literal union members must share a compatible base type\nfound %s and %s",
				res.BaseA, res.BaseB))
		}
	case *ast.TemplateType:
		for _, seg := range v.Segments {
			if c, ok := seg.(*ast.CaptureSegment); ok {
				validateUnions(c.CaptureType, declName, p, ds)
			}
		}
	}
}

// validateTemplates walks t and validates each template it contains: unique
// capture names (§6.4), supported capture types (§6.3), and deterministic
// decoding (§7).
func validateTemplates(t ast.Type, declName string, p ast.Pos, ds *diag.DiagSink) {
	tmpl, ok := ast.Resolve(t).(*ast.TemplateType)
	if !ok {
		return
	}
	seen := make(map[string]bool)
	captures := tmpl.Captures()
	for _, c := range captures {
		if seen[c.Name] {
			ds.Append(diag.ErrorAt(p.File, p.Line, p.Col, diag.CodeDuplicateCaptureName,
				"duplicate template capture name %q", c.Name))
		}
		seen[c.Name] = true
		if !supportedCaptureType(c.CaptureType) {
			ds.Append(diag.ErrorAt(p.File, p.Line, p.Col, diag.CodeInvalidCaptureType,
				"capture %q: unsupported capture type %s", c.Name, c.CaptureType.String()))
		}
	}
	validateTemplateDeterminism(tmpl, declName, p, ds)
}

// supportedCaptureType reports whether a capture's type is one of the forms
// permitted in a template (§6.3): a primitive, a scalar literal, or a literal
// union. A capture whose type resolves to a template is not supported (recursive
// templates are a non-goal).
func supportedCaptureType(t ast.Type) bool {
	switch ast.Resolve(t).(type) {
	case *ast.PrimitiveType, *ast.LiteralType:
		return true
	case *ast.UnionType:
		_, ok := ast.FlattenUnionLiterals(t)
		return ok
	}
	return false
}

// validateTemplateDeterminism enforces the initial-version unique-decoding rules
// (§7): no two captures may be adjacent (§7.2), and an unconstrained `str`
// capture must be the template's final segment so its extent is unambiguous
// (§7.1, §7.3). Numeric ambiguity is deferred to value-validation time (§7.4).
func validateTemplateDeterminism(tmpl *ast.TemplateType, declName string, p ast.Pos, ds *diag.DiagSink) {
	segs := tmpl.Segments
	for i, seg := range segs {
		cap, ok := seg.(*ast.CaptureSegment)
		if !ok {
			continue
		}
		// Adjacent captures: previous segment is also a capture.
		if i > 0 {
			if _, prevCap := segs[i-1].(*ast.CaptureSegment); prevCap {
				ds.Append(diag.ErrorAt(p.File, p.Line, p.Col, diag.CodeAmbiguousTemplate,
					"ambiguous template literal type %s\n\ncaptures %q and %q are adjacent with no separator between them",
					declName, segs[i-1].(*ast.CaptureSegment).Name, cap.Name))
				continue
			}
		}
		// Unconstrained str capture must be the last segment.
		if isUnconstrainedStr(cap.CaptureType) && i != len(segs)-1 {
			ds.Append(diag.ErrorAt(p.File, p.Line, p.Col, diag.CodeAmbiguousTemplate,
				"ambiguous template literal type %s\n\ncapture %q is an unconstrained str and is not the final segment, so its extent cannot be uniquely determined",
				declName, cap.Name))
		}
	}
}

// isUnconstrainedStr reports whether a capture type resolves to the `str`
// primitive (matches any text, including separators).
func isUnconstrainedStr(t ast.Type) bool {
	pt, ok := ast.Resolve(t).(*ast.PrimitiveType)
	return ok && pt.Kind == ast.PrimStr
}

// ─────────────────────────────────────────────────────────────────────────────
// proto → AST type conversion
// ─────────────────────────────────────────────────────────────────────────────

// protoTypeToAST converts a canonical proto TypeExpr back into the AST type IR
// so the shared semantic engine (subtyping, union checks, membership) can be
// reused during validation.
func protoTypeToAST(t *turnoutpb.TypeExpr) ast.Type {
	if t == nil {
		return nil
	}
	switch x := t.Type.(type) {
	case *turnoutpb.TypeExpr_Primitive:
		kind, _ := ast.PrimitiveKindFromString(x.Primitive.GetName())
		return ast.NewPrimitiveType(ast.Pos{}, kind)
	case *turnoutpb.TypeExpr_Literal:
		return ast.NewLiteralType(ast.Pos{}, structpbToLiteral(x.Literal.GetValue()))
	case *turnoutpb.TypeExpr_Union:
		members := make([]ast.Type, 0, len(x.Union.GetMembers()))
		for _, m := range x.Union.GetMembers() {
			members = append(members, protoTypeToAST(m))
		}
		return ast.NewUnionType(ast.Pos{}, members)
	case *turnoutpb.TypeExpr_Template:
		segs := make([]ast.TemplateSegment, 0, len(x.Template.GetSegments()))
		for _, seg := range x.Template.GetSegments() {
			segs = append(segs, protoSegmentToAST(seg))
		}
		return ast.NewTemplateType(ast.Pos{}, segs)
	case *turnoutpb.TypeExpr_Named:
		return ast.NewNamedType(ast.Pos{}, x.Named.GetName())
	}
	return nil
}

func protoSegmentToAST(seg *turnoutpb.TemplateSegmentModel) ast.TemplateSegment {
	switch s := seg.Segment.(type) {
	case *turnoutpb.TemplateSegmentModel_Text:
		return &ast.TextSegment{Value: s.Text.GetValue()}
	case *turnoutpb.TemplateSegmentModel_Capture:
		return &ast.CaptureSegment{
			Name:        s.Capture.GetName(),
			CaptureType: protoTypeToAST(s.Capture.GetType()),
		}
	}
	return nil
}

// structpbToLiteral converts a structpb scalar value into an ast.Literal.
func structpbToLiteral(v *structpb.Value) ast.Literal {
	switch k := v.GetKind().(type) {
	case *structpb.Value_StringValue:
		return ast.NewStringLiteral(ast.Pos{}, k.StringValue)
	case *structpb.Value_NumberValue:
		return ast.NewNumberLiteral(ast.Pos{}, k.NumberValue)
	case *structpb.Value_BoolValue:
		return ast.NewBoolLiteral(ast.Pos{}, k.BoolValue)
	}
	return ast.NewStringLiteral(ast.Pos{}, "")
}

// ─────────────────────────────────────────────────────────────────────────────
// Assignability of literal-value bindings to a declared literal type (§10)
// ─────────────────────────────────────────────────────────────────────────────

// checkLiteralAssignable reports a NotAssignable diagnostic when a binding's
// literal value is not a member of its declared scalar literal/union type.
// Template membership requires the runtime matcher (Phase 2) and is skipped.
func checkLiteralAssignable(b *turnoutpb.BindingModel, declared ast.Type, pos ast.Pos, ds *diag.DiagSink) {
	resolved := ast.Resolve(declared)
	lit := structpbToLiteral(b.GetValue())
	if tmpl, isTemplate := resolved.(*ast.TemplateType); isTemplate {
		// A template value must be a string literal that the template accepts.
		sv, isStr := lit.(*ast.StringLiteral)
		if isStr && ast.TemplateContains(tmpl, sv.Value) {
			return
		}
		val := ast.NewLiteralType(ast.Pos{}, lit).String()
		msg := "value " + val + " is not a valid " + declaredTypeName(b, resolved)
		if pos.File != "" {
			ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeInvalidTemplateValue,
				"binding %q: %s", b.Name, msg))
		} else {
			ds.Append(diag.Errorf(diag.CodeInvalidTemplateValue, "binding %q: %s", b.Name, msg))
		}
		return
	}
	if ast.LiteralInType(lit, resolved) {
		return
	}
	msg := "value " + ast.NewLiteralType(ast.Pos{}, lit).String() +
		" is not assignable to " + declaredTypeName(b, resolved)
	if accepts := acceptedValues(resolved); accepts != "" {
		msg += "\n\naccepts:\n" + accepts
	}
	if pos.File != "" {
		ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeNotAssignable,
			"binding %q: %s", b.Name, msg))
	} else {
		ds.Append(diag.Errorf(diag.CodeNotAssignable, "binding %q: %s", b.Name, msg))
	}
}

// declaredTypeName returns the best display name for a binding's declared type:
// the named reference if the annotation was a name, else the structural form.
func declaredTypeName(b *turnoutpb.BindingModel, resolved ast.Type) string {
	if named, ok := b.GetDeclaredType().GetType().(*turnoutpb.TypeExpr_Named); ok {
		return named.Named.GetName()
	}
	return resolved.String()
}

// acceptedValues renders the finite value set of a literal/union type as a
// bullet list, or "" when the type is not a finite literal set.
func acceptedValues(t ast.Type) string {
	lits, ok := ast.FlattenUnionLiterals(t)
	if !ok {
		return ""
	}
	var b strings.Builder
	for _, l := range lits {
		b.WriteString("- ")
		b.WriteString(l.String())
		b.WriteByte('\n')
	}
	return strings.TrimRight(b.String(), "\n")
}

// effectiveType returns a binding's structured type for assignability: its
// declared literal/template type if present, otherwise the primitive
// corresponding to its runtime FieldType. Returns nil for array/invalid types.
func effectiveType(info bindingInfo) ast.Type {
	if info.declaredType != nil {
		return info.declaredType
	}
	if pk, ok := ast.PrimitiveKindFromFieldType(info.fieldType); ok {
		return ast.NewPrimitiveType(ast.Pos{}, pk)
	}
	return nil
}

// protoPos converts a proto SourcePos to an ast.Pos (zero value when nil).
func protoPos(p *turnoutpb.SourcePos) ast.Pos {
	if p == nil {
		return ast.Pos{}
	}
	return ast.Pos{File: p.GetFile(), Line: int(p.GetLine()), Col: int(p.GetCol())}
}
