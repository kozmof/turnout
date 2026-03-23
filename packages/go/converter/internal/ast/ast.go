// Package ast defines the AST node types for the Turn DSL.
//
// Every node carries a Pos for source-location diagnostics. Interface types use
// unexported marker methods so the compiler enforces exhaustive type switches.
package ast

import "fmt"

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
type FieldType int

const (
	FieldTypeNumber    FieldType = iota // number
	FieldTypeStr                        // str
	FieldTypeBool                       // bool
	FieldTypeArrNumber                  // arr<number>
	FieldTypeArrStr                     // arr<str>
	FieldTypeArrBool                    // arr<bool>
)

var fieldTypeNames = [...]string{
	"number", "str", "bool", "arr<number>", "arr<str>", "arr<bool>",
}

func (ft FieldType) String() string {
	if int(ft) < len(fieldTypeNames) {
		return fieldTypeNames[ft]
	}
	return fmt.Sprintf("FieldType(%d)", int(ft))
}

// FieldTypeFromString converts a DSL type string to a FieldType.
// Returns (0, false) if the string is not a valid type.
func FieldTypeFromString(s string) (FieldType, bool) {
	for i, name := range fieldTypeNames {
		if name == s {
			return FieldType(i), true
		}
	}
	return 0, false
}

// IsArray reports whether the type is an array type.
func (ft FieldType) IsArray() bool {
	return ft == FieldTypeArrNumber || ft == FieldTypeArrStr || ft == FieldTypeArrBool
}

// ElemType returns the element type of an array FieldType.
// Panics if called on a non-array type.
func (ft FieldType) ElemType() FieldType {
	switch ft {
	case FieldTypeArrNumber:
		return FieldTypeNumber
	case FieldTypeArrStr:
		return FieldTypeStr
	case FieldTypeArrBool:
		return FieldTypeBool
	default:
		panic(fmt.Sprintf("ElemType called on non-array type %s", ft))
	}
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

// BindingRHS is implemented by all RHS node types.
type BindingRHS interface{ bindingRHS() }

// LiteralRHS is `name:type = <literal>`.
type LiteralRHS struct{ Value Literal }

func (*LiteralRHS) bindingRHS() {}

// PlaceholderRHS is `name:type = _` (ingress placeholder; delegates default to STATE).
type PlaceholderRHS struct{}

func (*PlaceholderRHS) bindingRHS() {}

// SingleRefRHS is `name:type = identifier` (bare single-reference form).
type SingleRefRHS struct{ RefName string }

func (*SingleRefRHS) bindingRHS() {}

// FuncCallRHS is `name:type = fn(a, b)` or `fn(a: x, b: y)`.
// Named-arg form is normalized to ordered Args during parsing.
type FuncCallRHS struct {
	FnAlias string
	Args    []Arg
}

func (*FuncCallRHS) bindingRHS() {}

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

// FnAlias returns the canonical function alias for this infix operator.
// For InfixPlus, the alias is type-dispatched (number → "add", str → "str_concat");
// this method returns "" and the lowerer resolves it from the binding's declared type.
func (op InfixOp) FnAlias() string {
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
		return "" // type-dispatched: "add" for number, "str_concat" for str
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

// InfixRHS is `name:type = lhs OP rhs`.
type InfixRHS struct {
	Op  InfixOp
	LHS Arg
	RHS Arg
}

func (*InfixRHS) bindingRHS() {}

// PipeParam is one `paramName:sourceIdent` pair in a `#pipe(...)` header.
type PipeParam struct {
	ParamName   string
	SourceIdent string
}

// PipeStep is one step in a `#pipe` step list.
type PipeStep struct {
	FnAlias string
	Args    []Arg
}

// PipeRHS is `name:type = #pipe(p1:v1, ...)[step1, step2, ...]`.
type PipeRHS struct {
	Params []PipeParam
	Steps  []PipeStep
}

func (*PipeRHS) bindingRHS() {}

// CondExpr is the condition inside a cond or #if form.
// Implemented by *CondExprRef (bare binding name) and *CondExprCall (inline call).
type CondExpr interface{ condExpr() }

// CondExprRef is a bare binding-name condition (the only form valid in CondRHS).
type CondExprRef struct{ BindingName string }

func (*CondExprRef) condExpr() {}

// CondExprCall is an inline `fn(args)` condition (only valid in IfRHS).
type CondExprCall struct {
	FnAlias string
	Args    []Arg
}

func (*CondExprCall) condExpr() {}

// CondRHS is `name:type = { cond = { condition = c then = t else = e } }`.
// Condition must be a *CondExprRef (enforced in validation).
type CondRHS struct {
	Pos       Pos
	Condition CondExpr
	Then      string
	Else      string
}

func (*CondRHS) bindingRHS() {}

// IfRHS is `name:type = #if { cond = <expr> then = t else = e }`.
// Cond may be *CondExprRef or *CondExprCall.
type IfRHS struct {
	Pos  Pos
	Cond CondExpr
	Then string
	Else string
}

func (*IfRHS) bindingRHS() {}

// ────────────────────────────────────────────────────────────
// Arg — argument in a function call, infix expression, or pipe step
// ────────────────────────────────────────────────────────────

// Arg is implemented by all argument node types.
type Arg interface{ arg() }

// RefArg is a bare identifier reference: `v` → `{ ref = "v" }` in canonical HCL.
type RefArg struct{ Name string }

func (*RefArg) arg() {}

// LitArg is a literal value: `42` → `{ lit = 42 }` in canonical HCL.
type LitArg struct{ Value Literal }

func (*LitArg) arg() {}

// FuncRefArg is `{ func_ref = "fn_name" }` — reference to a function binding's output.
type FuncRefArg struct{ FnName string }

func (*FuncRefArg) arg() {}

// StepRefArg is `{ step_ref = N }` — reference to step N's output inside a pipe.
type StepRefArg struct{ Index int }

func (*StepRefArg) arg() {}

// TransformArg is `{ transform = { ref = "v", fn = "transformFn..." } }`.
type TransformArg struct {
	Ref string
	Fn  string
}

func (*TransformArg) arg() {}

// ────────────────────────────────────────────────────────────
// Prepare / Merge / Publish
// ────────────────────────────────────────────────────────────

// PrepareBlock is the `prepare { ... }` block of an action.
type PrepareBlock struct {
	Pos     Pos
	Entries []*PrepareEntry
}

// PrepareSource is implemented by *FromState, *FromHook, and *FromLiteral.
// The validator rejects *FromLiteral at the action level (only valid in transitions).
type PrepareSource interface{ prepareSource() }

// PrepareEntry binds a prog binding name to a concrete ingress source.
type PrepareEntry struct {
	Pos         Pos
	BindingName string
	Source      PrepareSource
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
type NextPrepareSource interface{ nextPrepareSource() }

// NextPrepareEntry binds a binding name to a transition ingress source.
type NextPrepareEntry struct {
	Pos         Pos
	BindingName string
	Source      NextPrepareSource
}

// ────────────────────────────────────────────────────────────
// Shared ingress/egress source types
//
// FromState and FromLiteral implement BOTH PrepareSource and NextPrepareSource
// so they can be used in both action-level and transition-level prepare blocks.
// FromHook implements only PrepareSource (forbidden in transitions).
// FromAction implements only NextPrepareSource (transitions only).
// ────────────────────────────────────────────────────────────

// FromState is `from_state = <dotted.path>` — reads a value from STATE.
// Valid in both action-level and transition prepare blocks.
type FromState struct {
	Pos  Pos
	Path string
}

func (*FromState) prepareSource()     {}
func (*FromState) nextPrepareSource() {}

// FromHook is `from_hook = "<hookName>"` — reads from a hook result.
// Valid only in action-level prepare (not in transitions).
type FromHook struct {
	Pos      Pos
	HookName string
}

func (*FromHook) prepareSource() {}

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

func (*FromAction) nextPrepareSource() {}

// ────────────────────────────────────────────────────────────
// Literals
// ────────────────────────────────────────────────────────────

// Literal is implemented by all literal value node types.
type Literal interface{ literal() }

// NumberLiteral is an integer or decimal numeric literal.
type NumberLiteral struct {
	Pos   Pos
	Value float64
}

func (*NumberLiteral) literal() {}

// StringLiteral is a quoted string literal.
type StringLiteral struct {
	Pos   Pos
	Value string
}

func (*StringLiteral) literal() {}

// BoolLiteral is a boolean literal (`true` or `false`).
type BoolLiteral struct {
	Pos   Pos
	Value bool
}

func (*BoolLiteral) literal() {}

// ArrayLiteral is an array literal `[e1, e2, ...]`.
type ArrayLiteral struct {
	Pos      Pos
	Elements []Literal
}

func (*ArrayLiteral) literal() {}

// ────────────────────────────────────────────────────────────
// Route / Match
// ────────────────────────────────────────────────────────────

// RouteBlock is the `route "<id>" { match { ... } }` top-level block.
type RouteBlock struct {
	Pos   Pos
	ID    string
	Match *MatchBlock
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
