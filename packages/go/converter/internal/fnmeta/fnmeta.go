// Package fnmeta is the single source of truth for built-in function metadata:
// operator-only status, infix display symbols, return-type inference, and operand
// types. Both the lower and validate packages import this package; neither
// encodes function-level facts independently.
package fnmeta

import (
	"fmt"
	"sort"
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

// BinaryArity is the fixed arity of all built-in functions.
// Variadic functions are not currently supported.
const BinaryArity = 2

// FnSpec holds the static type metadata for a built-in binary function.
type FnSpec struct {
	// Arg1Type and Arg2Type are valid only when Kind == FnKindStandard.
	// For polymorphic kinds (FnKindGeneric, FnKindArrGet, FnKindArrInc,
	// FnKindArrConcat) these fields are zero; operand type checking must
	// switch on Kind first (see validate.validateBinaryArgTypePair).
	Arg1Type, Arg2Type ast.FieldType
	ReturnType         ast.FieldType
	Kind               FnKind
}

// StaticArgTypes returns (arg1Type, arg2Type, true) for FnKindStandard functions,
// where both operand types are fixed regardless of the call site.
// Returns (FieldTypeInvalid, FieldTypeInvalid, false) for polymorphic kinds
// (FnKindGeneric, FnKindArrGet, FnKindArrInc, FnKindArrConcat), where operand
// types depend on the arguments and callers must switch on Kind to validate them.
// Use this instead of direct Arg1Type/Arg2Type field access to make the
// polymorphic-kind contract explicit at call sites.
func (s FnSpec) StaticArgTypes() (arg1, arg2 ast.FieldType, ok bool) {
	if s.Kind != FnKindStandard {
		return ast.FieldTypeInvalid, ast.FieldTypeInvalid, false
	}
	return s.Arg1Type, s.Arg2Type, true
}

// BuiltinFn returns the spec for a built-in function alias.
// Returns (FnSpec{}, false) for unknown names.
func BuiltinFn(name string) (FnSpec, bool) {
	spec, ok := builtinFnTable[name]
	return spec, ok
}

// BuiltinFnNames returns all registered built-in function alias names in sorted order.
func BuiltinFnNames() []string {
	names := make([]string, 0, len(builtinFnTable))
	for name := range builtinFnTable {
		names = append(names, name)
	}
	sort.Strings(names)
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
	spec, ok := BuiltinFn(fn)
	if !ok {
		return fallback
	}
	switch spec.Kind {
	case FnKindGeneric, FnKindArrInc:
		return ast.FieldTypeBool
	case FnKindArrGet:
		if fallback.IsArray() {
			return fallback.ElemType()
		}
		return fallback
	case FnKindArrConcat:
		return fallback
	default:
		return spec.ReturnType
	}
}

// OperandTypes returns (arg1Type, arg2Type) for fn given the binding's declared
// type. Used by the lowerer to determine the expected types for infix operands
// inside local expressions.
//
// Panics for unknown function names or unhandled FnKind values so that gaps are
// caught at development time rather than silently returning wrong types.
func OperandTypes(fn string, declaredType ast.FieldType) (ast.FieldType, ast.FieldType) {
	spec, ok := BuiltinFn(fn)
	if !ok {
		panic("fnmeta.OperandTypes: unknown function " + fn)
	}
	switch spec.Kind {
	case FnKindStandard:
		// Derive directly from builtinFnTable — no separate encoding needed.
		return spec.Arg1Type, spec.Arg2Type
	case FnKindGeneric:
		// eq/neq: both operands must share the binding's declared type.
		return declaredType, declaredType
	case FnKindArrGet:
		// arg1 = array, arg2 = numeric index
		return declaredType, ast.FieldTypeNumber
	case FnKindArrInc:
		// arg1 = array, arg2 = element of that array's type
		if et, ok := declaredType.TryElemType(); ok {
			return declaredType, et
		}
		return declaredType, ast.FieldTypeInvalid
	case FnKindArrConcat:
		// both args must be the same array type
		return declaredType, declaredType
	default:
		panic(fmt.Sprintf("fnmeta.OperandTypes: unhandled FnKind %d — add a case when adding new FnKind values", spec.Kind))
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

// SplitQualifiedFn splits a qualified transform function name of the form
// "namespace::method" into its namespace and method components.
// Returns ("", "", false) when the separator "::" is absent, which indicates
// a malformed qualified name (internal compiler bug or tampered model).
func SplitQualifiedFn(fn string) (ns, method string, ok bool) {
	idx := strings.LastIndex(fn, "::")
	if idx < 0 {
		return "", "", false
	}
	return fn[:idx], fn[idx+2:], true
}

// TransformChainOutputType resolves the output FieldType produced by applying
// a transform chain to a receiver of receiverType. fns is the ordered slice of
// qualified function names stored in TransformArg.Fn.
// Returns (0, false) if any step cannot be resolved or a name is malformed.
func TransformChainOutputType(receiverType ast.FieldType, fns []string) (ast.FieldType, bool) {
	current := receiverType
	for _, fn := range fns {
		_, method, ok := SplitQualifiedFn(fn)
		if !ok {
			return 0, false
		}
		_, outType, found := LookupMethod(method, current)
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
