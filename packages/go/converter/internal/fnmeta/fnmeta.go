// Package fnmeta is the single source of truth for built-in function metadata:
// operator-only status, infix display symbols, return-type inference, and operand
// types. Both the lower and validate packages import this package; neither
// encodes function-level facts independently.
package fnmeta

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"google.golang.org/protobuf/types/known/structpb"
)

// IsOperatorOnly reports whether fn must be used via infix syntax only.
// Calling an operator-only function by name directly (e.g. add(a, b)) is a
// compile error detected during lowering.
func IsOperatorOnly(fn string) bool {
	_, ok := operatorOnlySymbols[fn]
	return ok
}

// OperatorSymbol returns the DSL infix symbol for fn (e.g. "add" → "+").
// Returns fn itself for unknown names so callers can use it safely in error messages.
func OperatorSymbol(fn string) string {
	if sym, ok := operatorOnlySymbols[fn]; ok {
		return sym
	}
	return fn
}

// ReturnType returns the inferred return FieldType for fn given the binding's
// declared type (fallback). Used by the lowerer when inferring types for local
// expressions (#if/#case/#pipe). Returns fallback for unknown function names.
func ReturnType(fn string, fallback ast.FieldType) ast.FieldType {
	switch fn {
	case "gt", "gte", "lt", "lte", "eq", "neq",
		"bool_and", "bool_or", "bool_xor",
		"str_includes", "str_starts", "str_ends",
		"arr_includes":
		return ast.FieldTypeBool
	case "str_concat":
		return ast.FieldTypeStr
	case "arr_concat":
		return fallback
	case "arr_get":
		if fallback.IsArray() {
			return fallback.ElemType()
		}
		return fallback
	case "add", "sub", "mul", "div", "mod", "max", "min":
		return ast.FieldTypeNumber
	default:
		return fallback
	}
}

// OperandTypes returns (arg1Type, arg2Type) for fn given the binding's declared
// type. Used by the lowerer to determine the expected types for infix operands
// inside local expressions.
func OperandTypes(fn string, declaredType ast.FieldType) (ast.FieldType, ast.FieldType) {
	switch fn {
	case "str_concat", "str_includes", "str_starts", "str_ends":
		return ast.FieldTypeStr, ast.FieldTypeStr
	case "bool_and", "bool_or", "bool_xor":
		return ast.FieldTypeBool, ast.FieldTypeBool
	case "eq", "neq":
		return declaredType, declaredType
	default:
		return ast.FieldTypeNumber, ast.FieldTypeNumber
	}
}

// IdentityValue returns the algebraic neutral element for fn as a *structpb.Value.
// Returns (nil, false) for functions that are not identity-binary.
// The four identity-binary functions are: bool_and (true), add (0), str_concat (""), arr_concat ([]).
func IdentityValue(fn string) (*structpb.Value, bool) {
	switch fn {
	case "bool_and":
		return structpb.NewBoolValue(true), true
	case "add":
		return structpb.NewNumberValue(0), true
	case "str_concat":
		return structpb.NewStringValue(""), true
	case "arr_concat":
		return structpb.NewListValue(&structpb.ListValue{}), true
	}
	return nil, false
}

// IsIdentityValue reports whether v equals the algebraic identity element for fn.
// Returns false for functions that are not identity-binary or when v is nil.
func IsIdentityValue(fn string, v *structpb.Value) bool {
	if v == nil {
		return false
	}
	switch fn {
	case "bool_and":
		bv, ok := v.Kind.(*structpb.Value_BoolValue)
		return ok && bv.BoolValue
	case "add":
		nv, ok := v.Kind.(*structpb.Value_NumberValue)
		return ok && nv.NumberValue == 0
	case "str_concat":
		sv, ok := v.Kind.(*structpb.Value_StringValue)
		return ok && sv.StringValue == ""
	case "arr_concat":
		lv, ok := v.Kind.(*structpb.Value_ListValue)
		return ok && (lv.ListValue == nil || len(lv.ListValue.Values) == 0)
	}
	return false
}

// operatorOnlySymbols maps each operator-only function alias to its DSL infix
// symbol. The map doubles as an O(1) IsOperatorOnly predicate.
var operatorOnlySymbols = map[string]string{
	"add":        "+",
	"sub":        "-",
	"mul":        "*",
	"div":        "/",
	"mod":        "%",
	"gt":         ">",
	"gte":        ">=",
	"lt":         "<",
	"lte":        "<=",
	"str_concat": "+",
	"bool_and":   "&",
	"bool_or":    "|",
	"eq":         "==",
	"neq":        "!=",
}
