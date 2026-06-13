// Package ast defines the AST node types for the Turn DSL.
//
// Every node carries a Pos for source-location diagnostics. Interface types use
// unexported marker methods so the compiler enforces exhaustive type switches.
package ast

import (
	"fmt"

	"google.golang.org/protobuf/types/known/structpb"
)

// ────────────────────────────────────────────────────────────
// Pos — source location
// ────────────────────────────────────────────────────────────

// Pos records the source file, line, and column of an AST node's opening token.
// The zero value means "no position available".
type Pos struct {
	File string
	Line int
	Col  int
}

func (p Pos) String() string {
	if p.File == "" {
		return fmt.Sprintf("%d:%d", p.Line, p.Col)
	}
	return fmt.Sprintf("%s:%d:%d", p.File, p.Line, p.Col)
}

// ────────────────────────────────────────────────────────────
// FieldType — the six DSL value types
// ────────────────────────────────────────────────────────────

// FieldType enumerates the six DSL value types.
// FieldTypeInvalid (0) is the zero value, so any zero-initialized FieldType
// variable is safely invalid rather than silently treated as a valid type.
// The six valid types start at 1.
type FieldType int

const (
	FieldTypeInvalid   FieldType = iota //  0: zero value → invalid (safe default)
	FieldTypeNumber                     //  1: number
	FieldTypeStr                        //  2: str
	FieldTypeBool                       //  3: bool
	FieldTypeArrNumber                  //  4: arr<number>
	FieldTypeArrStr                     //  5: arr<str>
	FieldTypeArrBool                    //  6: arr<bool>
	fieldTypeSentinel                   // unexported — marks the end of the valid range; add new types above this line
)

// fieldTypeExhaustiveCheck is a compile-time guard: its size equals the number
// of valid FieldType values (fieldTypeSentinel - 1). Adding a new FieldType
// constant without updating this array causes a compile error, forcing every
// switch site to be audited before the build succeeds again.
// To add a new type: append a {} element here AND update every switch/map in:
//
//	ast.go (fieldTypeNames, fieldTypeByString, LiteralFieldType, IsArray, TryElemType)
//	state/state.go (literalMatchesType)
//	validate/validate.go (structpbMatchesFieldType)
//	lower/lower_rhs.go (identityFnFor)
var _ = [fieldTypeSentinel - 1]struct{}{
	{}, // FieldTypeNumber
	{}, // FieldTypeStr
	{}, // FieldTypeBool
	{}, // FieldTypeArrNumber
	{}, // FieldTypeArrStr
	{}, // FieldTypeArrBool
}

// Valid reports whether ft is a recognised (non-zero, in-range) FieldType.
// Callers that switch on FieldType exhaustively can use this to guard against
// future additions without recompiling this package.
func (ft FieldType) Valid() bool {
	return ft > FieldTypeInvalid && ft < fieldTypeSentinel
}

var fieldTypeNames = map[FieldType]string{
	FieldTypeNumber:    "number",
	FieldTypeStr:       "str",
	FieldTypeBool:      "bool",
	FieldTypeArrNumber: "arr<number>",
	FieldTypeArrStr:    "arr<str>",
	FieldTypeArrBool:   "arr<bool>",
}

func (ft FieldType) String() string {
	if ft == FieldTypeInvalid {
		return "FieldType(invalid)"
	}
	if name, ok := fieldTypeNames[ft]; ok {
		return name
	}
	return fmt.Sprintf("FieldType(%d)", int(ft))
}

// ProtoString returns the proto-level serialization key for this FieldType.
// This MUST match the schema-type strings expected by the TS runtime's
// state-manager.ts. Equal to String() for valid types; exists as an explicit
// contract so future DSL renames do not silently break cross-language serialization.
func (ft FieldType) ProtoString() string { return ft.String() }

var fieldTypeByString = map[string]FieldType{
	"number":     FieldTypeNumber,
	"str":        FieldTypeStr,
	"bool":       FieldTypeBool,
	"arr<number>": FieldTypeArrNumber,
	"arr<str>":   FieldTypeArrStr,
	"arr<bool>":  FieldTypeArrBool,
}

// FieldTypeFromString converts a DSL type string to a FieldType.
// Returns (FieldTypeInvalid, false) if the string is not a valid type.
func FieldTypeFromString(s string) (FieldType, bool) {
	ft, ok := fieldTypeByString[s]
	if !ok {
		return FieldTypeInvalid, false
	}
	return ft, ok
}

// MustFieldTypeFromString converts a DSL type string that is guaranteed by the
// caller to be valid (e.g. a type string produced by the lowerer from a
// validated AST node). Panics on an unrecognised string so that internal
// compiler bugs surface immediately rather than silently using FieldTypeNumber.
func MustFieldTypeFromString(s string) FieldType {
	ft, ok := fieldTypeByString[s]
	if !ok {
		panic("MustFieldTypeFromString: unknown type string " + s)
	}
	return ft
}

// LiteralFieldType infers the FieldType of a Literal value.
// For an empty ArrayLiteral, ok is false (element type is unknown); the returned
// FieldType is FieldTypeInvalid as a placeholder. Callers MUST check ok before
// using the returned type when the literal may be an empty array.
// Returns (FieldTypeInvalid, false) for mixed-element arrays.
func LiteralFieldType(lit Literal) (FieldType, bool) {
	switch v := lit.(type) {
	case *NumberLiteral:
		return FieldTypeNumber, true
	case *StringLiteral:
		return FieldTypeStr, true
	case *BoolLiteral:
		return FieldTypeBool, true
	case *ArrayLiteral:
		if len(v.Elements) == 0 {
			return FieldTypeInvalid, false
		}
		elemType, ok := LiteralFieldType(v.Elements[0])
		if !ok {
			return 0, false
		}
		for _, elem := range v.Elements[1:] {
			t, ok := LiteralFieldType(elem)
			if !ok || t != elemType {
				return 0, false
			}
		}
		switch elemType {
		case FieldTypeNumber:
			return FieldTypeArrNumber, true
		case FieldTypeStr:
			return FieldTypeArrStr, true
		case FieldTypeBool:
			return FieldTypeArrBool, true
		}
	}
	return 0, false
}

// IsArray reports whether the type is an array type.
func (ft FieldType) IsArray() bool {
	return ft == FieldTypeArrNumber || ft == FieldTypeArrStr || ft == FieldTypeArrBool
}

// TryElemType returns the element type of an array FieldType.
// Returns (FieldTypeInvalid, false) for non-array types.
func (ft FieldType) TryElemType() (FieldType, bool) {
	switch ft {
	case FieldTypeArrNumber:
		return FieldTypeNumber, true
	case FieldTypeArrStr:
		return FieldTypeStr, true
	case FieldTypeArrBool:
		return FieldTypeBool, true
	}
	return FieldTypeInvalid, false
}

// ElemType returns the element type of an array FieldType.
// Panics if called on a non-array type; use TryElemType for a safe variant.
func (ft FieldType) ElemType() FieldType {
	et, ok := ft.TryElemType()
	if !ok {
		panic(fmt.Sprintf("ElemType called on non-array type %s", ft))
	}
	return et
}

// ────────────────────────────────────────────────────────────
// Sigil — binding direction
// ────────────────────────────────────────────────────────────

// Sigil marks the directional intent of a binding in a prog block.
type Sigil int

const (
	SigilNone    Sigil = iota // no sigil (plain compute binding)
	SigilIngress              // ~>  (STATE → binding, pre-action)
	SigilEgress               // <~  (binding → STATE, post-action)
	SigilBiDir                // <~> (both directions)
)

var sigilNames = [...]string{"", "~>", "<~", "<~>"}

func (s Sigil) String() string {
	if int(s) < len(sigilNames) {
		return sigilNames[s]
	}
	return fmt.Sprintf("Sigil(%d)", int(s))
}

// ToInt32 encodes a Sigil for storage in a proto Sigils map (map[string]int32).
func (s Sigil) ToInt32() int32 { return int32(s) }

// SigilFromInt32 decodes a Sigil read from a proto Sigils map.
func SigilFromInt32(v int32) Sigil { return Sigil(v) }

// ────────────────────────────────────────────────────────────
// Top-level
// ────────────────────────────────────────────────────────────

// TurnFile is the root AST node for a .turn source file.
type TurnFile struct {
	StateSource StateSource // nil only if both are absent (error case)
	Scenes      []*SceneBlock
	Routes      []*RouteBlock
}

// StateSource is implemented by *InlineStateBlock and *StateFileDirective.
type StateSource interface{ stateSource() }

// ────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────

// InlineStateBlock represents a literal `state { ... }` block in the source.
type InlineStateBlock struct {
	Pos        Pos
	Namespaces []*NamespaceDecl
}

func (*InlineStateBlock) stateSource() {}

// StateFileDirective represents a `state_file = "..."` directive.
type StateFileDirective struct {
	Pos  Pos
	Path string
}

func (*StateFileDirective) stateSource() {}

// NamespaceDecl is a named namespace block within a state block.
type NamespaceDecl struct {
	Pos    Pos
	Name   string
	Fields []*FieldDecl
}

// FieldDecl is a single `name:type = default` declaration within a namespace.
type FieldDecl struct {
	Pos     Pos
	Name    string
	Type    FieldType
	Default Literal
}

// ────────────────────────────────────────────────────────────
// Scene
// ────────────────────────────────────────────────────────────

// SceneBlock is the top-level `scene "<id>" { ... }` block.
type SceneBlock struct {
	Pos          Pos
	ID           string
	EntryActions []string
	NextPolicy   string
	View         *ViewBlock
	Actions      []*ActionBlock
}

// ViewBlock is the `view "<name>" { ... }` sub-block of a scene.
type ViewBlock struct {
	Pos     Pos
	Name    string
	Flow    string // heredoc body
	Enforce string
}

// ────────────────────────────────────────────────────────────
// Action
// ────────────────────────────────────────────────────────────

// ActionBlock is an `action "<id>" { ... }` block within a scene.
type ActionBlock struct {
	Pos     Pos
	ID      string
	Text    *string      // from triple-quoted docstring or explicit text = "..."
	Compute *ComputeBlock
	Prepare *PrepareBlock
	Merge   *MergeBlock
	Publish *PublishBlock
	Next    []*NextRule
}

// ComputeBlock is the `compute { root = <id> prog "<name>" { ... } }` block.
type ComputeBlock struct {
	Pos  Pos
	Root string
	Prog *ProgBlock
}

// ProgBlock is a `prog "<name>" { ... }` block containing binding declarations.
type ProgBlock struct {
	Pos      Pos
	Name     string
	Bindings []*BindingDecl
}

// BindingDecl is a single binding declaration within a prog block.
// Sigil is SigilNone for plain compute bindings.
type BindingDecl struct {
	Pos   Pos
	Sigil Sigil
	Name  string
	Type  FieldType
	RHS   BindingRHS
}

// ────────────────────────────────────────────────────────────
// BindingRHS — right-hand side of a binding declaration
// ────────────────────────────────────────────────────────────

// BindingRHSKind is a discriminant for the nine BindingRHS implementations.
// It allows switch exhaustiveness checks and tooling introspection without a
// full type-switch. Add a new constant here whenever a new BindingRHS type is
// introduced, and implement Kind() on the new type.
//
// When adding a new kind:
//  1. Add a constant above rhsKindSentinel (below).
//  2. Add a {} element to the rhsKindExhaustiveCheck array.
//  3. Update every switch on BindingRHSKind — at minimum:
//     - lower/lower.go  (lowerBinding)
//     - lower/lower_local.go (lowerTop)
type BindingRHSKind int

const (
	RHSKindLiteral    BindingRHSKind = iota // *LiteralRHS
	RHSKindSigilInput                       // *SigilInputRHS
	RHSKindSingleRef                        // *SingleRefRHS
	RHSKindFuncCall                         // *FuncCallRHS
	RHSKindInfix                            // *InfixRHS
	RHSKindIfCall                           // *IfCallRHS
	RHSKindCaseCall                         // *CaseCallRHS
	RHSKindPipeCall                         // *PipeCallRHS
	RHSKindError                            // *ErrorRHS
	rhsKindSentinel                         // unexported — marks end of valid range; add new kinds above this line
)

// rhsKindExhaustiveCheck is a compile-time guard: its size equals the number of
// valid BindingRHSKind values. Adding a new kind without updating this array
// causes a compile error, forcing every switch site to be audited.
// See the FieldType sentinel (fieldTypeSentinel / fieldTypeExhaustiveCheck) for
// the established pattern this mirrors.
var _ = [rhsKindSentinel]struct{}{
	{}, // RHSKindLiteral
	{}, // RHSKindSigilInput
	{}, // RHSKindSingleRef
	{}, // RHSKindFuncCall
	{}, // RHSKindInfix
	{}, // RHSKindIfCall
	{}, // RHSKindCaseCall
	{}, // RHSKindPipeCall
	{}, // RHSKindError
}

// BindingRHS is implemented by all RHS node types.
// Kind() returns a typed discriminant so callers can build exhaustive switches
// without importing reflect or performing interface-comparison gymnastics.
type BindingRHS interface {
	bindingRHS()
	Kind() BindingRHSKind
}

// SyntaxRHS marks binding RHS types produced by the parser.
// The lowerer converts these to flat BindingModel entries; encountering
// a SyntaxRHS in post-lowering code paths is always a compiler bug.
//
// syntaxRHSCount is the number of SyntaxRHS implementors. The compile-time
// array below enforces exhaustiveness: add a {} element whenever a new
// SyntaxRHS type is introduced, then audit every switch on SyntaxRHS.
// Current implementors: *ErrorRHS, *IfCallRHS, *CaseCallRHS, *PipeCallRHS.
const syntaxRHSCount = 4

var _ = [syntaxRHSCount]struct{}{
	{}, // *ErrorRHS
	{}, // *IfCallRHS
	{}, // *CaseCallRHS
	{}, // *PipeCallRHS
}

type SyntaxRHS interface {
	BindingRHS
	syntaxRHS()
}

// LiteralRHS is `name:type = <literal>`.
type LiteralRHS struct{ Value Literal }

func (*LiteralRHS) bindingRHS()          {}
func (*LiteralRHS) Kind() BindingRHSKind { return RHSKindLiteral }

// SingleRefRHS is `name:type = identifier` (bare single-reference form).
type SingleRefRHS struct{ RefName string }

func (*SingleRefRHS) bindingRHS()          {}
func (*SingleRefRHS) Kind() BindingRHSKind { return RHSKindSingleRef }

// FuncCallRHS is `name:type = fn(a, b)` or `fn(a: x, b: y)`.
// Named-arg form is normalized to ordered Args during parsing.
// Args holds pre-lowering argument forms; *MethodCallArg may appear here and
// is resolved to *TransformArg by the lowerer.
type FuncCallRHS struct {
	FnAlias string
	Args    []SyntaxArg
}

func (*FuncCallRHS) bindingRHS()          {}
func (*FuncCallRHS) Kind() BindingRHSKind { return RHSKindFuncCall }

// InfixOp enumerates the four DSL infix operators.
type InfixOp int

const (
	InfixAnd    InfixOp = iota // & → bool_and
	InfixGTE                   // >= → gte
	InfixLTE                   // <= → lte
	InfixGT                    // > → gt
	InfixLT                    // < → lt
	InfixBoolOr                // | → bool_or
	InfixEq                    // == → eq
	InfixNeq                   // != → neq
	// InfixPlus is type-dispatched: name:number → add; name:str → str_concat.
	// FnAlias returns "" — the lowerer resolves the alias from the binding's declared type.
	InfixPlus                  // + → add (number) / str_concat (str)
	InfixSub                   // - → sub
	InfixMul                   // * → mul
	InfixDiv                   // / → div
	InfixMod                   // % → mod
)

var infixOpNames = [...]string{"&", ">=", "<=", ">", "<", "|", "==", "!=", "+", "-", "*", "/", "%"}

func (op InfixOp) String() string {
	if int(op) < len(infixOpNames) {
		return infixOpNames[op]
	}
	return fmt.Sprintf("InfixOp(%d)", int(op))
}

// fnAliasRaw returns the function alias for operators with a fixed mapping.
// Returns "" for InfixPlus (type-dispatched) and unknown operators.
// The "" return for InfixPlus is intentional — it is a sentinel meaning "resolve
// by type." Callers must never use fnAliasRaw for type-dispatched operators;
// use FnAliasForType instead.
// Unexported — only FnAliasForType should be used outside this package.
func (op InfixOp) fnAliasRaw() string {
	switch op {
	case InfixAnd:
		return "bool_and"
	case InfixGTE:
		return "gte"
	case InfixLTE:
		return "lte"
	case InfixGT:
		return "gt"
	case InfixLT:
		return "lt"
	case InfixBoolOr:
		return "bool_or"
	case InfixEq:
		return "eq"
	case InfixNeq:
		return "neq"
	case InfixPlus:
		return "" // type-dispatched: resolved by FnAliasForType
	case InfixSub:
		return "sub"
	case InfixMul:
		return "mul"
	case InfixDiv:
		return "div"
	case InfixMod:
		return "mod"
	default:
		return ""
	}
}

// FnAliasForType returns the resolved function alias for this operator given the
// binding's declared field type. Always returns a non-empty string.
// InfixPlus dispatches to "str_concat" for FieldTypeStr and "add" otherwise.
// All other operators return their fixed alias directly.
// Use this instead of any raw alias lookup — it is the only safe call site.
func (op InfixOp) FnAliasForType(ft FieldType) string {
	if op != InfixPlus {
		return op.fnAliasRaw()
	}
	if ft == FieldTypeStr {
		return "str_concat"
	}
	return "add"
}

// InfixRHS is `name:type = lhs OP rhs`.
// LHS and RHS are pre-lowering argument forms.
type InfixRHS struct {
	Op  InfixOp
	LHS SyntaxArg
	RHS SyntaxArg
}

func (*InfixRHS) bindingRHS()          {}
func (*InfixRHS) Kind() BindingRHSKind { return RHSKindInfix }

// ────────────────────────────────────────────────────────────
// v1 local expression tree
// ────────────────────────────────────────────────────────────

// LocalExpr is the pre-lowering expression tree used inside #if, #case, and
// #pipe blocks. It is parsed and walked by the lowerer and validator, then
// discarded after lowering produces flat BindingModel / ExprModel proto nodes.
//
// Arg (below) is the post-lowering, proto-level argument type used inside
// CombineExpr / PipeExpr. Although both hierarchies have literal, reference,
// and call variants, they serve different abstraction levels and must not be
// conflated: LocalExpr nodes carry source positions and richer structure;
// Arg nodes map 1-to-1 onto proto ArgModel fields.
//
// LocalExpr is a recursive expression node used inside #if, #case, and #pipe.
type LocalExpr interface{ localExpr() }

// LocalRefExpr is a bare identifier reference: `v` → `{ ref = "v" }`.
type LocalRefExpr struct {
	Pos  Pos
	Name string
}

func (*LocalRefExpr) localExpr() {}

// LocalLitExpr is a literal value: `42` → `{ lit = 42 }`.
type LocalLitExpr struct {
	Pos   Pos
	Value Literal
}

func (*LocalLitExpr) localExpr() {}

// LocalItExpr is `#it` — the current pipeline value; valid only inside #pipe steps.
type LocalItExpr struct{ Pos Pos }

func (*LocalItExpr) localExpr() {}

// LocalCallExpr is a function call: `fn(arg1, arg2)`.
type LocalCallExpr struct {
	Pos     Pos
	FnAlias string
	Args    []LocalExpr
}

func (*LocalCallExpr) localExpr() {}

// LocalInfixExpr is a binary infix expression: `lhs OP rhs`.
type LocalInfixExpr struct {
	Pos      Pos
	Op       InfixOp
	LHS, RHS LocalExpr
}

func (*LocalInfixExpr) localExpr() {}

// LocalIfExpr is a nested `#if(cond, then, else)` expression.
type LocalIfExpr struct {
	Pos            Pos
	Cond, Then, Else LocalExpr
}

func (*LocalIfExpr) localExpr() {}

// LocalCaseExpr is a nested `#case(subject, arms...)` expression.
type LocalCaseExpr struct {
	Pos     Pos
	Subject LocalExpr
	Arms    []LocalCaseArm
}

func (*LocalCaseExpr) localExpr() {}

// LocalPipeExpr is a nested `#pipe(initial, steps...)` expression.
type LocalPipeExpr struct {
	Pos     Pos
	Initial LocalExpr
	Steps   []LocalExpr
}

func (*LocalPipeExpr) localExpr() {}

// ────────────────────────────────────────────────────────────
// #case arm and pattern types
// ────────────────────────────────────────────────────────────

// LocalCaseArm is one arm of a #case expression.
type LocalCaseArm struct {
	Pos     Pos
	Pattern LocalCasePattern
	Guard   LocalExpr // nil if no guard
	Expr    LocalExpr
}

// LocalCasePattern is a pattern in a #case arm.
type LocalCasePattern interface{ localCasePattern() }

// WildcardCasePattern matches any value without binding: `_`.
type WildcardCasePattern struct{ Pos Pos }

func (*WildcardCasePattern) localCasePattern() {}

// LiteralCasePattern matches by value equality: `42`, `"run"`, `true`.
type LiteralCasePattern struct {
	Pos   Pos
	Value Literal
}

func (*LiteralCasePattern) localCasePattern() {}

// VarBinderPattern matches any value and binds it to a name: `x`.
type VarBinderPattern struct {
	Pos  Pos
	Name string
}

func (*VarBinderPattern) localCasePattern() {}

// ────────────────────────────────────────────────────────────
// v1 binding RHS types
// ────────────────────────────────────────────────────────────

// ErrorRHS is a sentinel produced by the parser when a binding's right-hand side
// could not be parsed. It satisfies BindingRHS so that downstream stages (lower,
// validate) can handle it explicitly instead of a nil check.
type ErrorRHS struct {
	ErrPos  Pos
	Message string
}

func (*ErrorRHS) bindingRHS()          {}
func (*ErrorRHS) syntaxRHS()           {}
func (*ErrorRHS) Kind() BindingRHSKind { return RHSKindError }

// SigilInputRHS marks a sigil-only input declaration (~>name:type or <~>name:type)
// with no right-hand side expression. The value is populated at runtime via prepare.
type SigilInputRHS struct{}

func (*SigilInputRHS) bindingRHS()          {}
func (*SigilInputRHS) Kind() BindingRHSKind { return RHSKindSigilInput }

// IfCallRHS is the v1 `#if(cond, then_expr, else_expr)` function-call form.
type IfCallRHS struct {
	Pos            Pos
	Cond, Then, Else LocalExpr
}

func (*IfCallRHS) bindingRHS()          {}
func (*IfCallRHS) syntaxRHS()           {}
func (*IfCallRHS) Kind() BindingRHSKind { return RHSKindIfCall }

// CaseCallRHS is the v1 `#case(subject, pattern => expr, ..., _ => default)` form.
type CaseCallRHS struct {
	Pos     Pos
	Subject LocalExpr
	Arms    []LocalCaseArm
}

func (*CaseCallRHS) bindingRHS()          {}
func (*CaseCallRHS) syntaxRHS()           {}
func (*CaseCallRHS) Kind() BindingRHSKind { return RHSKindCaseCall }

// PipeCallRHS is the v1 `#pipe(initial, step1, step2, ...)` form.
type PipeCallRHS struct {
	Pos     Pos
	Initial LocalExpr
	Steps   []LocalExpr
}

func (*PipeCallRHS) bindingRHS()          {}
func (*PipeCallRHS) syntaxRHS()           {}
func (*PipeCallRHS) Kind() BindingRHSKind { return RHSKindPipeCall }

// ────────────────────────────────────────────────────────────
// Arg — argument in a function call, infix expression, or pipe step
// ────────────────────────────────────────────────────────────

// Arg is the post-lowering, proto-level argument type used inside CombineExpr
// and PipeExpr steps. See LocalExpr for its pre-lowering counterpart.
type Arg interface{ arg() }

// PostLoweringArg is a structural sub-type of Arg that identifies argument types
// valid after lowering. *RefArg, *LitArg, *FuncRefArg, *StepRefArg, and
// *TransformArg implement it; *MethodCallArg intentionally does not, making it
// structurally impossible to pass a pre-lowering MethodCallArg where a
// post-lowering arg is required.
type PostLoweringArg interface {
	Arg
	postLoweringArg()
}

// SyntaxArg is a source-syntax argument resolved during lowering to a
// proto-level Arg. Implementors appear in parser output but are not valid
// in the lowered proto model. Use concrete type switches (e.g. *MethodCallArg)
// or this interface to identify and handle pre-lowering forms.
type SyntaxArg interface{ syntaxArg() }

// RefArg is a bare identifier reference: `v` → `{ ref = "v" }` in canonical HCL.
type RefArg struct{ Name string }

func (*RefArg) arg()             {}
func (*RefArg) postLoweringArg() {}
func (*RefArg) syntaxArg()       {}

// LitArg is a literal value: `42` → `{ lit = 42 }` in canonical HCL.
type LitArg struct{ Value Literal }

func (*LitArg) arg()             {}
func (*LitArg) postLoweringArg() {}
func (*LitArg) syntaxArg()       {}

// FuncRefArg is `{ func_ref = "fn_name" }` — reference to a function binding's output.
type FuncRefArg struct{ FnName string }

func (*FuncRefArg) arg()             {}
func (*FuncRefArg) postLoweringArg() {}
func (*FuncRefArg) syntaxArg()       {}

// StepRefArg is `{ step_ref = N }` — reference to step N's output inside a pipe.
type StepRefArg struct{ Index int }

func (*StepRefArg) arg()             {}
func (*StepRefArg) postLoweringArg() {}
func (*StepRefArg) syntaxArg()       {}

// TransformArg is `{ transform = { ref = "v", fn = ["transformFn..."] } }`.
type TransformArg struct {
	Ref string
	Fn  []string
}

func (*TransformArg) arg()             {}
func (*TransformArg) postLoweringArg() {}
func (*TransformArg) syntaxArg()       {}

// MethodCallArg is the DSL method-call form `receiver.method1().method2()`.
// Methods holds unqualified method names; the lowerer resolves them to fully
// qualified transformFn names using the binding type context.
//
// This is a pre-lowering-only form (implements SyntaxArg but NOT Arg): it
// appears in parser output inside []SyntaxArg slices and is resolved to
// TransformArg by lowerMethodCallArg. It must not appear in post-lowering code.
type MethodCallArg struct {
	Receiver string
	Methods  []string
}

func (*MethodCallArg) syntaxArg() {}

// ────────────────────────────────────────────────────────────
// Prepare / Merge / Publish
// ────────────────────────────────────────────────────────────

// PrepareBlock is the `prepare { ... }` block of an action.
type PrepareBlock struct {
	Pos     Pos
	Entries []*PrepareEntry
}

// PrepareSource is the common parent of ActionPrepareSource and NextPrepareSource.
// It marks a value as a concrete ingress source of some kind.
// The unexported marker prevents external implementations.
type PrepareSource interface{ prepareSource() }

// ActionPrepareSource is implemented by *FromState and *FromHook.
// *FromLiteral is excluded by design: it is only valid in transition prepare blocks.
// This makes the constraint a compile-time guarantee rather than a runtime check.
type ActionPrepareSource interface {
	PrepareSource
	actionPrepareSource()
}

// PrepareEntry binds a prog binding name to a concrete ingress source.
type PrepareEntry struct {
	Pos         Pos
	BindingName string
	Source      ActionPrepareSource
}

// MergeBlock is the `merge { ... }` block of an action.
type MergeBlock struct {
	Pos     Pos
	Entries []*MergeEntry
}

// MergeEntry maps a prog binding name to a STATE write-back path.
type MergeEntry struct {
	Pos         Pos
	BindingName string
	ToState     string
}

// PublishBlock is the `publish { hook = "<name>" ... }` block of an action.
type PublishBlock struct {
	Pos   Pos
	Hooks []string
}

// ────────────────────────────────────────────────────────────
// Next rules (transitions)
// ────────────────────────────────────────────────────────────

// NextRule is one `next { ... }` block within an action.
type NextRule struct {
	Pos      Pos
	Compute  *NextComputeBlock
	Prepare  *NextPrepareBlock
	ActionID string
}

// NextComputeBlock is the `compute { condition = <id> prog "<name>" { ... } }` inside a next block.
type NextComputeBlock struct {
	Pos       Pos
	Condition string
	Prog      *ProgBlock
}

// NextPrepareBlock is the `prepare { ... }` inside a next block.
type NextPrepareBlock struct {
	Pos     Pos
	Entries []*NextPrepareEntry
}

// NextPrepareSource is implemented by *FromAction, *FromState, and *FromLiteral.
type NextPrepareSource interface {
	PrepareSource
	nextPrepareSource()
}

// NextPrepareEntry binds a binding name to a transition ingress source.
type NextPrepareEntry struct {
	Pos         Pos
	BindingName string
	Source      NextPrepareSource
}

// ────────────────────────────────────────────────────────────
// Shared ingress/egress source types
//
// ActionPrepareSource: *FromState, *FromHook — valid in action-level prepare.
// NextPrepareSource: *FromAction, *FromState, *FromLiteral — valid in transitions.
// FromHook is forbidden in transitions; FromAction and FromLiteral are forbidden
// at action level. These exclusions are enforced by the type system.
// ────────────────────────────────────────────────────────────

// FromState is `from_state = <dotted.path>` — reads a value from STATE.
// Valid in both action-level and transition prepare blocks.
type FromState struct {
	Pos  Pos
	Path string
}

func (*FromState) prepareSource()       {}
func (*FromState) actionPrepareSource() {}
func (*FromState) nextPrepareSource()   {}

// FromHook is `from_hook = "<hookName>"` — reads from a hook result.
// Valid only in action-level prepare (not in transitions).
type FromHook struct {
	Pos      Pos
	HookName string
}

func (*FromHook) prepareSource()       {}
func (*FromHook) actionPrepareSource() {}

// FromLiteral is `from_literal = <value>` — injects a literal value.
// Valid only in transition prepare (not in action-level prepare).
type FromLiteral struct {
	Pos   Pos
	Value Literal
}

func (*FromLiteral) prepareSource()     {}
func (*FromLiteral) nextPrepareSource() {}

// FromAction is `from_action = <binding>` — reads from the action result's binding.
// Valid only in transition prepare.
type FromAction struct {
	Pos         Pos
	BindingName string
}

func (*FromAction) prepareSource()     {}
func (*FromAction) nextPrepareSource() {}

// ────────────────────────────────────────────────────────────
// Literals
// ────────────────────────────────────────────────────────────

// Literal is implemented by all literal value node types.
type Literal interface {
	literal()
	Pos() Pos
}

// NumberLiteral is an integer or decimal numeric literal.
type NumberLiteral struct {
	litPos Pos
	Value  float64
}

func (*NumberLiteral) literal()   {}
func (n *NumberLiteral) Pos() Pos { return n.litPos }

// NewNumberLiteral constructs a NumberLiteral with the given source position.
func NewNumberLiteral(pos Pos, value float64) *NumberLiteral {
	return &NumberLiteral{litPos: pos, Value: value}
}

// StringLiteral is a quoted string literal.
type StringLiteral struct {
	litPos Pos
	Value  string
}

func (*StringLiteral) literal()   {}
func (s *StringLiteral) Pos() Pos { return s.litPos }

// NewStringLiteral constructs a StringLiteral with the given source position.
func NewStringLiteral(pos Pos, value string) *StringLiteral {
	return &StringLiteral{litPos: pos, Value: value}
}

// BoolLiteral is a boolean literal (`true` or `false`).
type BoolLiteral struct {
	litPos Pos
	Value  bool
}

func (*BoolLiteral) literal()   {}
func (b *BoolLiteral) Pos() Pos { return b.litPos }

// NewBoolLiteral constructs a BoolLiteral with the given source position.
func NewBoolLiteral(pos Pos, value bool) *BoolLiteral {
	return &BoolLiteral{litPos: pos, Value: value}
}

// ArrayLiteral is an array literal `[e1, e2, ...]`.
type ArrayLiteral struct {
	litPos   Pos
	Elements []Literal
}

func (*ArrayLiteral) literal()   {}
func (a *ArrayLiteral) Pos() Pos { return a.litPos }

// NewArrayLiteral constructs an ArrayLiteral with the given source position.
func NewArrayLiteral(pos Pos, elements []Literal) *ArrayLiteral {
	return &ArrayLiteral{litPos: pos, Elements: elements}
}

// LiteralToStructpb converts an ast.Literal to a *structpb.Value.
// A nil literal becomes a null value.
func LiteralToStructpb(lit Literal) *structpb.Value {
	if lit == nil {
		return structpb.NewNullValue()
	}
	switch v := lit.(type) {
	case *NumberLiteral:
		return structpb.NewNumberValue(v.Value)
	case *StringLiteral:
		return structpb.NewStringValue(v.Value)
	case *BoolLiteral:
		return structpb.NewBoolValue(v.Value)
	case *ArrayLiteral:
		vals := make([]*structpb.Value, len(v.Elements))
		for i, e := range v.Elements {
			vals[i] = LiteralToStructpb(e)
		}
		return structpb.NewListValue(&structpb.ListValue{Values: vals})
	}
	panic(fmt.Sprintf("LiteralToStructpb: unhandled Literal type %T", lit))
}

// ────────────────────────────────────────────────────────────
// Route / Match
// ────────────────────────────────────────────────────────────

// RouteBlock is the `route "<id>" { entry "<scene_id>" match { ... } }` top-level block.
type RouteBlock struct {
	Pos          Pos
	ID           string
	EntrySceneID string
	Match        *MatchBlock
}

// MatchBlock is the `match { <arms...> }` inside a route block.
type MatchBlock struct {
	Pos  Pos
	Arms []*MatchArm
}

// MatchArm is one `<path-expr> => <scene_id>` arm (possibly OR-joined branches).
type MatchArm struct {
	Pos      Pos
	Branches []*PathExpr // one or more branches joined with |
	Target   string      // scene_id target
}

// PathExpr is one path-form in a match arm.
// Fallback == true means the _ pattern.
// Otherwise SceneID + Segments describe the path (Segments may contain "*").
type PathExpr struct {
	Pos      Pos
	Fallback bool
	SceneID  string
	Segments []string // e.g. ["*", "final_action"] for scene_id.*.final_action
}
