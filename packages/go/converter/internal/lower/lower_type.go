package lower

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
)

// resolveBindingTypes builds the program's type registry and resolves every
// binding whose annotation is a named literal/template type, writing the
// binding's runtime base FieldType into decl.Type. A reference that cannot be
// resolved (unknown or cyclic type) is left with FieldTypeStr as a safe runtime
// default; the validate stage reports the underlying error. Mutates the AST in
// place before the rest of lowering reads decl.Type.
func resolveBindingTypes(file *ast.TurnFile, ds *diag.DiagSink) {
	registry := make(map[string]ast.Type, len(file.TypeDecls))
	for _, d := range file.TypeDecls {
		if _, dup := registry[d.Name]; !dup {
			registry[d.Name] = d.Type
		}
	}
	lookup := func(name string) (ast.Type, bool) {
		t, ok := registry[name]
		return t, ok
	}
	for _, d := range file.TypeDecls {
		ast.ResolveNamedRefs(d.Type, lookup)
	}
	for _, prog := range allProgs(file) {
		// Pass A: resolve declared binding types so every binding's structured
		// type is known before construction references are checked.
		for _, b := range prog.Bindings {
			if b.DeclaredType == nil {
				continue
			}
			ast.ResolveNamedRefs(b.DeclaredType, lookup)
			if ft, ok := ast.BaseFieldType(b.DeclaredType); ok {
				b.Type = ft
			} else if b.Type == ast.FieldTypeInvalid {
				b.Type = ast.FieldTypeStr
			}
		}
		refType := progRefTypeLookup(prog)
		// Pass B: validate and fold template constructions.
		for _, b := range prog.Bindings {
			tc, ok := b.RHS.(*ast.TemplateConstructionRHS)
			if !ok {
				continue
			}
			folded, constant, ok := foldConstruction(tc, lookup, refType, ds)
			if ok && constant {
				b.RHS = &ast.LiteralRHS{Value: ast.NewStringLiteral(tc.Pos, folded)}
			}
			if b.Type == ast.FieldTypeInvalid {
				b.Type = ast.FieldTypeStr // a constructed value is a string
			}
		}
	}
}

// progRefTypeLookup returns the structured type of a binding by name: its
// resolved declared type when present, otherwise the primitive of its runtime
// FieldType. Used to type-check construction reference arguments.
func progRefTypeLookup(prog *ast.ProgBlock) func(string) (ast.Type, bool) {
	types := make(map[string]ast.Type, len(prog.Bindings))
	for _, b := range prog.Bindings {
		if b.DeclaredType != nil {
			types[b.Name] = ast.Resolve(b.DeclaredType)
		} else if pk, ok := ast.PrimitiveKindFromFieldType(b.Type); ok {
			types[b.Name] = ast.NewPrimitiveType(ast.Pos{}, pk)
		}
	}
	return func(name string) (ast.Type, bool) {
		t, ok := types[name]
		return t, ok
	}
}

// allProgs returns every prog block in the file (action compute + transition
// compute) so type resolution can visit all bindings.
func allProgs(file *ast.TurnFile) []*ast.ProgBlock {
	var progs []*ast.ProgBlock
	for _, scene := range file.Scenes {
		for _, action := range scene.Actions {
			if action.Compute != nil && action.Compute.Prog != nil {
				progs = append(progs, action.Compute.Prog)
			}
			for _, nr := range action.Next {
				if nr.Compute != nil && nr.Compute.Prog != nil {
					progs = append(progs, nr.Compute.Prog)
				}
			}
		}
	}
	return progs
}

// lowerTypeDecls converts the AST type declarations to their canonical proto
// representation. Structural validation (unknown references, cycles, union
// consistency, template determinism, exhaustiveness) happens in the validate
// stage against this structured model.
func lowerTypeDecls(decls []*ast.TypeDecl, ds *diag.DiagSink) []*turnoutpb.TypeDeclModel {
	if len(decls) == 0 {
		return nil
	}
	out := make([]*turnoutpb.TypeDeclModel, 0, len(decls))
	for _, d := range decls {
		out = append(out, &turnoutpb.TypeDeclModel{
			Name:      d.Name,
			Type:      lowerTypeExpr(d.Type, ds),
			SourcePos: astPosToProto(d.Pos),
		})
	}
	return out
}

// lowerTypeExpr converts an ast.Type into a proto TypeExpr.
func lowerTypeExpr(t ast.Type, ds *diag.DiagSink) *turnoutpb.TypeExpr {
	switch v := t.(type) {
	case *ast.PrimitiveType:
		return &turnoutpb.TypeExpr{Type: &turnoutpb.TypeExpr_Primitive{
			Primitive: &turnoutpb.PrimitiveTypeExpr{Name: v.Kind.String()},
		}}
	case *ast.LiteralType:
		return &turnoutpb.TypeExpr{Type: &turnoutpb.TypeExpr_Literal{
			Literal: &turnoutpb.LiteralTypeExpr{
				Value: ast.LiteralToStructpb(v.Value),
				Base:  v.BaseKind().String(),
			},
		}}
	case *ast.UnionType:
		members := make([]*turnoutpb.TypeExpr, 0, len(v.Members))
		for _, m := range v.Members {
			members = append(members, lowerTypeExpr(m, ds))
		}
		return &turnoutpb.TypeExpr{Type: &turnoutpb.TypeExpr_Union{
			Union: &turnoutpb.UnionTypeExpr{Members: members},
		}}
	case *ast.TemplateType:
		segs := make([]*turnoutpb.TemplateSegmentModel, 0, len(v.Segments))
		for _, seg := range v.Segments {
			segs = append(segs, lowerTemplateSegment(seg, ds))
		}
		return &turnoutpb.TypeExpr{Type: &turnoutpb.TypeExpr_Template{
			Template: &turnoutpb.TemplateTypeExpr{Segments: segs},
		}}
	case *ast.NamedType:
		return &turnoutpb.TypeExpr{Type: &turnoutpb.TypeExpr_Named{
			Named: &turnoutpb.NamedTypeExpr{Name: v.Name},
		}}
	case nil:
		return nil
	default:
		ds.Append(diag.Errorf(diag.CodeInternalError,
			"lowerTypeExpr: unhandled type %T — compiler bug", t))
		return nil
	}
}

func lowerTemplateSegment(seg ast.TemplateSegment, ds *diag.DiagSink) *turnoutpb.TemplateSegmentModel {
	switch s := seg.(type) {
	case *ast.TextSegment:
		return &turnoutpb.TemplateSegmentModel{Segment: &turnoutpb.TemplateSegmentModel_Text{
			Text: &turnoutpb.TextSegmentModel{Value: s.Value},
		}}
	case *ast.CaptureSegment:
		return &turnoutpb.TemplateSegmentModel{Segment: &turnoutpb.TemplateSegmentModel_Capture{
			Capture: &turnoutpb.CaptureSegmentModel{
				Name: s.Name,
				Type: lowerTypeExpr(s.CaptureType, ds),
			},
		}}
	default:
		ds.Append(diag.Errorf(diag.CodeInternalError,
			"lowerTemplateSegment: unhandled segment %T — compiler bug", seg))
		return nil
	}
}
