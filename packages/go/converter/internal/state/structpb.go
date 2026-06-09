package state

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"google.golang.org/protobuf/types/known/structpb"
)

// StructpbFieldType infers the FieldType of a structpb.Value.
// Returns (FieldTypeInvalid, false) for nil values, empty arrays, or values
// whose type cannot be inferred (e.g. null, struct).
// For arrays the element type is inferred from the first element.
// See also state.literalMatchesType, which performs the equivalent check at
// the AST level.
func StructpbFieldType(v *structpb.Value) (ast.FieldType, bool) {
	if v == nil {
		return ast.FieldTypeInvalid, false
	}
	switch v.Kind.(type) {
	case *structpb.Value_NumberValue:
		return ast.FieldTypeNumber, true
	case *structpb.Value_StringValue:
		return ast.FieldTypeStr, true
	case *structpb.Value_BoolValue:
		return ast.FieldTypeBool, true
	case *structpb.Value_ListValue:
		k := v.Kind.(*structpb.Value_ListValue)
		if k.ListValue == nil || len(k.ListValue.Values) == 0 {
			return ast.FieldTypeInvalid, false
		}
		elemFT, ok := StructpbFieldType(k.ListValue.Values[0])
		if !ok {
			return ast.FieldTypeInvalid, false
		}
		switch elemFT {
		case ast.FieldTypeNumber:
			return ast.FieldTypeArrNumber, true
		case ast.FieldTypeStr:
			return ast.FieldTypeArrStr, true
		case ast.FieldTypeBool:
			return ast.FieldTypeArrBool, true
		}
	}
	return ast.FieldTypeInvalid, false
}
