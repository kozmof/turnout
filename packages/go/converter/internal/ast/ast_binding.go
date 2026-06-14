package ast

import "fmt"

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

// ────────────────────────────────────────────────────────────
// InfixOp
// ────────────────────────────────────────────────────────────

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
	InfixPlus // + → add (number) / str_concat (str)
	InfixSub  // - → sub
	InfixMul  // * → mul
	InfixDiv  // / → div
	InfixMod  // % → mod
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
	Pos              Pos
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
	Pos              Pos
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
