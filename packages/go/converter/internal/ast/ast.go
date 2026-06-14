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
	"number":      FieldTypeNumber,
	"str":         FieldTypeStr,
	"bool":        FieldTypeBool,
	"arr<number>": FieldTypeArrNumber,
	"arr<str>":    FieldTypeArrStr,
	"arr<bool>":   FieldTypeArrBool,
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
