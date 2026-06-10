// Package fnmeta is the single source of truth for built-in function metadata:
// operator-only status, infix display symbols, return-type inference, and operand
// types. Both the lower and validate packages import this package; neither
// encodes function-level facts independently.
package fnmeta

import (
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"google.golang.org/protobuf/types/known/structpb"
)

// FnKind classifies special dispatch behaviour of a built-in function.
type FnKind int

const (
	FnKindStandard  FnKind = iota // regular typed binary function
	FnKindGeneric                 // eq/neq: both operands must share the same type
	FnKindArrGet                  // arr_get: returns element type of arg1
	FnKindArrInc                  // arr_includes: returns bool
	FnKindArrConcat               // arr_concat: returns same array type as arg1
)

// DefaultFnArity is the arity used for built-in functions when FnSpec.MaxArgs is 0.
// All current built-in functions are binary; a non-zero MaxArgs overrides this.
const DefaultFnArity = 2

// FnSpec holds the static type metadata for a built-in binary function.
type FnSpec struct {
	// Arg1Type and Arg2Type are valid only when Kind == FnKindStandard.
	// For polymorphic kinds (FnKindGeneric, FnKindArrGet, FnKindArrInc,
	// FnKindArrConcat) these fields are zero; operand type checking must
	// switch on Kind first (see validate.validateBinaryArgTypePair).
	Arg1Type, Arg2Type ast.FieldType
	ReturnType         ast.FieldType
	Kind               FnKind
	// MaxArgs overrides DefaultFnArity when non-zero. 0 means DefaultFnArity (2).
	MaxArgs int
}

// Arity returns the maximum number of arguments the function accepts.
// Defaults to DefaultFnArity unless MaxArgs is set explicitly.
func (s FnSpec) Arity() int {
	if s.MaxArgs != 0 {
		return s.MaxArgs
	}
	return DefaultFnArity
}

// BuiltinFn returns the spec for a built-in function alias.
// Returns (FnSpec{}, false) for unknown names.
func BuiltinFn(name string) (FnSpec, bool) {
	spec, ok := builtinFnTable[name]
	return spec, ok
}

// BuiltinFnNames returns all registered built-in function alias names.
func BuiltinFnNames() []string {
	names := make([]string, 0, len(builtinFnTable))
	for name := range builtinFnTable {
		names = append(names, name)
	}
	return names
}

var builtinFnTable = map[string]FnSpec{
	"add":          {Arg1Type: ast.FieldTypeNumber, Arg2Type: ast.FieldTypeNumber, ReturnType: ast.FieldTypeNumber},
	"sub":          {Arg1Type: ast.FieldTypeNumber, Arg2Type: ast.FieldTypeNumber, ReturnType: ast.FieldTypeNumber},
	"mul":          {Arg1Type: ast.FieldTypeNumber, Arg2Type: ast.FieldTypeNumber, ReturnType: ast.FieldTypeNumber},
	"div":          {Arg1Type: ast.FieldTypeNumber, Arg2Type: ast.FieldTypeNumber, ReturnType: ast.FieldTypeNumber},
	"mod":          {Arg1Type: ast.FieldTypeNumber, Arg2Type: ast.FieldTypeNumber, ReturnType: ast.FieldTypeNumber},
	"max":          {Arg1Type: ast.FieldTypeNumber, Arg2Type: ast.FieldTypeNumber, ReturnType: ast.FieldTypeNumber},
	"min":          {Arg1Type: ast.FieldTypeNumber, Arg2Type: ast.FieldTypeNumber, ReturnType: ast.FieldTypeNumber},
	"gt":           {Arg1Type: ast.FieldTypeNumber, Arg2Type: ast.FieldTypeNumber, ReturnType: ast.FieldTypeBool},
	"gte":          {Arg1Type: ast.FieldTypeNumber, Arg2Type: ast.FieldTypeNumber, ReturnType: ast.FieldTypeBool},
	"lt":           {Arg1Type: ast.FieldTypeNumber, Arg2Type: ast.FieldTypeNumber, ReturnType: ast.FieldTypeBool},
	"lte":          {Arg1Type: ast.FieldTypeNumber, Arg2Type: ast.FieldTypeNumber, ReturnType: ast.FieldTypeBool},
	"str_concat":   {Arg1Type: ast.FieldTypeStr, Arg2Type: ast.FieldTypeStr, ReturnType: ast.FieldTypeStr},
	"str_includes": {Arg1Type: ast.FieldTypeStr, Arg2Type: ast.FieldTypeStr, ReturnType: ast.FieldTypeBool},
	"str_starts":   {Arg1Type: ast.FieldTypeStr, Arg2Type: ast.FieldTypeStr, ReturnType: ast.FieldTypeBool},
	"str_ends":     {Arg1Type: ast.FieldTypeStr, Arg2Type: ast.FieldTypeStr, ReturnType: ast.FieldTypeBool},
	"bool_and":     {Arg1Type: ast.FieldTypeBool, Arg2Type: ast.FieldTypeBool, ReturnType: ast.FieldTypeBool},
	"bool_or":      {Arg1Type: ast.FieldTypeBool, Arg2Type: ast.FieldTypeBool, ReturnType: ast.FieldTypeBool},
	"bool_xor":     {Arg1Type: ast.FieldTypeBool, Arg2Type: ast.FieldTypeBool, ReturnType: ast.FieldTypeBool},
	"eq":           {ReturnType: ast.FieldTypeBool, Kind: FnKindGeneric},
	"neq":          {ReturnType: ast.FieldTypeBool, Kind: FnKindGeneric},
	"arr_includes": {Kind: FnKindArrInc},
	"arr_get":      {Kind: FnKindArrGet},
	"arr_concat":   {Kind: FnKindArrConcat},
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Transform-chain method resolution
// ─────────────────────────────────────────────────────────────────────────────

type methodEntry struct {
	qualName   string
	outputType ast.FieldType
}

var arrayMethods = map[string]methodEntry{
	"length":  {"transformFnArray::length", ast.FieldTypeNumber},
	"isEmpty": {"transformFnArray::isEmpty", ast.FieldTypeBool},
}

var methodMap = map[ast.FieldType]map[string]methodEntry{
	ast.FieldTypeNumber: {
		"toStr":  {"transformFnNumber::toStr", ast.FieldTypeStr},
		"abs":    {"transformFnNumber::abs", ast.FieldTypeNumber},
		"floor":  {"transformFnNumber::floor", ast.FieldTypeNumber},
		"ceil":   {"transformFnNumber::ceil", ast.FieldTypeNumber},
		"round":  {"transformFnNumber::round", ast.FieldTypeNumber},
		"negate": {"transformFnNumber::negate", ast.FieldTypeNumber},
	},
	ast.FieldTypeStr: {
		"toNumber":    {"transformFnString::toNumber", ast.FieldTypeNumber},
		"trim":        {"transformFnString::trim", ast.FieldTypeStr},
		"toLowerCase": {"transformFnString::toLowerCase", ast.FieldTypeStr},
		"toUpperCase": {"transformFnString::toUpperCase", ast.FieldTypeStr},
		"length":      {"transformFnString::length", ast.FieldTypeNumber},
	},
	ast.FieldTypeBool: {
		"not":   {"transformFnBoolean::not", ast.FieldTypeBool},
		"toStr": {"transformFnBoolean::toStr", ast.FieldTypeStr},
	},
	ast.FieldTypeArrNumber: arrayMethods,
	ast.FieldTypeArrStr:    arrayMethods,
	ast.FieldTypeArrBool:   arrayMethods,
}

// LookupMethod resolves a method name on an input type to its qualified runtime
// name and output type. Returns ("", 0, false) for unknown method/type combinations.
func LookupMethod(method string, inputType ast.FieldType) (qualName string, outputType ast.FieldType, ok bool) {
	if byMethod, found := methodMap[inputType]; found {
		if e, found := byMethod[method]; found {
			return e.qualName, e.outputType, true
		}
	}
	return "", 0, false
}

// TransformChainOutputType resolves the output FieldType produced by applying
// a transform chain to a receiver of receiverType. fns is the ordered slice of
// qualified function names stored in TransformArg.Fn.
// Returns (0, false) if any step cannot be resolved.
func TransformChainOutputType(receiverType ast.FieldType, fns []string) (ast.FieldType, bool) {
	current := receiverType
	for _, fn := range fns {
		idx := strings.LastIndex(fn, "::")
		if idx < 0 {
			return 0, false
		}
		_, outType, found := LookupMethod(fn[idx+2:], current)
		if !found {
			return 0, false
		}
		current = outType
	}
	return current, true
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
