package emit

import (
	"strconv"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
)

// writeTypeDecls emits the program's named type declarations as HCL blocks. The
// canonical type expression is rendered into `def` for inspection. This output
// is not re-parsed; it exists so the emitted HCL faithfully shows authored types.
func writeTypeDecls(iw *iWriter, decls []*turnoutpb.TypeDeclModel) {
	for _, d := range decls {
		iw.wl("type %q {", d.GetName())
		iw.depth++
		iw.wl("def = %q", typeExprString(d.GetType()))
		iw.depth--
		iw.wl("}")
	}
}

// bindingTypeString returns the display type for a binding: its declared named
// type when present (so `k: Kind` re-emits as "Kind", not "str"), otherwise the
// flat runtime type string.
func bindingTypeString(b *turnoutpb.BindingModel) string {
	if dt := b.GetDeclaredType(); dt != nil {
		return typeExprString(dt)
	}
	return b.GetType()
}

// typeExprString renders a proto TypeExpr in canonical DSL form (mirrors
// ast.Type.String()).
func typeExprString(te *turnoutpb.TypeExpr) string {
	if te == nil {
		return ""
	}
	switch x := te.GetType().(type) {
	case *turnoutpb.TypeExpr_Primitive:
		return x.Primitive.GetName()
	case *turnoutpb.TypeExpr_Literal:
		return literalExprString(x.Literal)
	case *turnoutpb.TypeExpr_Union:
		parts := make([]string, 0, len(x.Union.GetMembers()))
		for _, m := range x.Union.GetMembers() {
			parts = append(parts, typeExprString(m))
		}
		return strings.Join(parts, " | ")
	case *turnoutpb.TypeExpr_Template:
		var b strings.Builder
		b.WriteByte('"')
		for _, seg := range x.Template.GetSegments() {
			switch s := seg.GetSegment().(type) {
			case *turnoutpb.TemplateSegmentModel_Text:
				b.WriteString(s.Text.GetValue())
			case *turnoutpb.TemplateSegmentModel_Capture:
				b.WriteByte('{')
				b.WriteString(s.Capture.GetName())
				b.WriteString(": ")
				b.WriteString(typeExprString(s.Capture.GetType()))
				b.WriteByte('}')
			}
		}
		b.WriteByte('"')
		return b.String()
	case *turnoutpb.TypeExpr_Named:
		return x.Named.GetName()
	}
	return ""
}

// literalExprString renders a scalar literal type using its declared base:
// strings quoted, booleans as true/false, numbers canonically.
func literalExprString(lit *turnoutpb.LiteralTypeExpr) string {
	v := lit.GetValue()
	switch lit.GetBase() {
	case "str":
		return strconv.Quote(v.GetStringValue())
	case "bool":
		return strconv.FormatBool(v.GetBoolValue())
	default: // integer / number
		f := v.GetNumberValue()
		if f == float64(int64(f)) {
			return strconv.FormatInt(int64(f), 10)
		}
		return strconv.FormatFloat(f, 'g', -1, 64)
	}
}
