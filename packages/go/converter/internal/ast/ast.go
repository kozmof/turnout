// Package ast defines the AST node types for the Turn DSL.
//
// Every node carries a Pos for source-location diagnostics. Interface types use
// unexported marker methods so the compiler enforces exhaustive type switches.
package ast

import (
	"fmt"
	"strings"
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
// FieldType — recursively composable DSL value types
// ────────────────────────────────────────────────────────────

// FieldType is a DSL value type, and it is its own canonical spelling: the
// value of a FieldType is the text that names it. Two field types are equal
// when they are spelled the same, which is what the type system means by equal,
// and nothing has to be interned to make that work — a composed type like
// `arr<arr<number>>` is a value, not a handle into a table that has to outlive
// every holder of it.
//
// Build one with FieldTypeFromString, which canonicalises the spelling.
// Converting a string directly — FieldType("rec<str,number>") — produces a
// value that may not be canonical and so may not compare equal to the same type
// written properly; `pnpm run check:fieldtype` rejects that conversion outside
// this package.
//
// The zero value is FieldTypeInvalid, which names no type.
type FieldType string

// The twelve base types are the vocabulary both languages pre-declare, in the
// order spec/field-types.json lists them. They are not the whole of what the
// type grammar accepts: `arr<` and `rec<` compose to any depth MaxTypeNodes
// allows, and a composed type is as ordinary a FieldType as these are.
const (
	FieldTypeInvalid            FieldType = ""
	FieldTypeNumber             FieldType = "number"
	FieldTypeStr                FieldType = "str"
	FieldTypeBool               FieldType = "bool"
	FieldTypeArrNumber          FieldType = "arr<number>"
	FieldTypeArrStr             FieldType = "arr<str>"
	FieldTypeArrBool            FieldType = "arr<bool>"
	FieldTypeRecordStrNumber    FieldType = "rec<str, number>"
	FieldTypeRecordStrStr       FieldType = "rec<str, str>"
	FieldTypeRecordStrBool      FieldType = "rec<str, bool>"
	FieldTypeRecordNumberNumber FieldType = "rec<number, number>"
	FieldTypeRecordNumberStr    FieldType = "rec<number, str>"
	FieldTypeRecordNumberBool   FieldType = "rec<number, bool>"
)

// baseFieldTypes is the constant vocabulary above in declaration order. It is
// written out rather than derived, because a FieldType is a name rather than a
// position in a range and there is nothing to iterate over.
var baseFieldTypes = []FieldType{
	FieldTypeNumber, FieldTypeStr, FieldTypeBool,
	FieldTypeArrNumber, FieldTypeArrStr, FieldTypeArrBool,
	FieldTypeRecordStrNumber, FieldTypeRecordStrStr, FieldTypeRecordStrBool,
	FieldTypeRecordNumberNumber, FieldTypeRecordNumberStr, FieldTypeRecordNumberBool,
}

// BaseFieldTypes returns the field types declared as constants, in declaration
// order. These are the vocabulary the two languages pre-declare and that
// spec/field-types.json enumerates.
//
// They are not the whole of what the type grammar accepts. `arr<` and `rec<`
// compose to any depth the runtime can hold, and only this list can be checked
// against the spec.
func BaseFieldTypes() []FieldType {
	return append([]FieldType(nil), baseFieldTypes...)
}

// Valid reports whether ft names a type. It re-parses, because a FieldType
// carries its spelling and nothing else; call it where a value's provenance is
// in doubt, not in a loop.
func (ft FieldType) Valid() bool {
	name, ok := parseFieldTypeString(string(ft))
	return ok && name == string(ft)
}

// String returns the type's spelling for display. It does not validate: a
// canonical FieldType is already its own name, and String is on the lowering
// path, where re-parsing a deep type on every call would cost more than the
// whole of what it is called for.
//
// The invalid type has no spelling, so String names it instead. That rendering
// is for a human reading a diagnostic; ProtoString is what crosses the wire.
func (ft FieldType) String() string {
	if ft == FieldTypeInvalid {
		return "FieldType(invalid)"
	}
	return string(ft)
}

// ProtoString returns the spelling to write into the model, which for every
// type that has one is the FieldType itself.
//
// It is deliberately not String(). String is a fmt.Stringer and answers to a
// human: it renders the invalid type as `FieldType(invalid)`, and it is free to
// render it differently tomorrow. Delegating to it put a display decision in
// the wire format, where changing how a diagnostic reads would have changed
// what a model says — and where an invalid type reaching lowering (a compiler
// bug) wrote that display string into the model as if it were a type name, for
// the validator to report back as `unknown type string "FieldType(invalid)"`.
//
// Here the invalid type writes the empty string, which names no type in the
// grammar and so is rejected by the same check, reported as the absence it is.
func (ft FieldType) ProtoString() string { return string(ft) }

func splitRecordParams(s string) (string, string, bool) {
	depth := 0
	for i, r := range s {
		switch r {
		case '<':
			depth++
		case '>':
			depth--
		case ',':
			if depth == 0 {
				return strings.TrimSpace(s[:i]), strings.TrimSpace(s[i+1:]), true
			}
		}
	}
	return "", "", false
}

// MaxTypeNodes bounds how many nodes a field type may be built from: one per
// `arr<`, one per `rec<`, and one for the primitive at the bottom. It is the
// size of the runtime's schema node pool (packages/zig/scene-runner/src/
// state.zig), pinned to it through spec/limits.json.
//
// The compiler needs the same bound the engine has. Without it the compiler
// accepted a type the engine could not represent and emitted a model that
// failed to load — a type error surfacing at run time, with no source position,
// which spec/runtime-hosts.md puts squarely on the compiler's side of the line.
const MaxTypeNodes = 128

// typeNodeCount returns the number of nodes a well-formed field type spelling
// needs. A record's key is a flag rather than a node, matching how the engine
// counts, so the leaf primitive at the bottom of the value spine is the `+ 1`.
//
// It counts rather than parses so that rejecting an over-deep type costs one
// linear scan. Parsing it to find out how deep it is is the cost the bound
// exists to avoid: the recursive form re-scans and re-concatenates at every
// level, which is quadratic in the nesting depth.
func typeNodeCount(s string) int {
	return strings.Count(s, "arr<") + strings.Count(s, "rec<") + 1
}

// FieldTypeRejection says why FieldTypeFromString returned false. The two are
// one `false` to a caller that only wants the type, and two different mistakes
// to a caller that has to explain it: a spelling that is not a type, and a type
// too deep for the runtime to represent.
type FieldTypeRejection int

const (
	// FieldTypeRejectedSpelling means s does not name a type at all.
	FieldTypeRejectedSpelling FieldTypeRejection = iota
	// FieldTypeRejectedTooDeep means s names a well-formed type with more than
	// MaxTypeNodes nodes.
	FieldTypeRejectedTooDeep
)

// WhyFieldTypeRejected classifies a spelling FieldTypeFromString rejected, and
// returns the node count that goes with FieldTypeRejectedTooDeep. Call it only
// on the failure path: it re-does the parse the failure came from.
func WhyFieldTypeRejected(s string) (FieldTypeRejection, int) {
	nodes := typeNodeCount(s)
	if nodes > MaxTypeNodes {
		return FieldTypeRejectedTooDeep, nodes
	}
	// Depth is the only thing besides the spelling that can refuse a type.
	return FieldTypeRejectedSpelling, nodes
}

// parseFieldTypeString parses a field type spelling and returns its canonical
// form, rejecting anything past MaxTypeNodes before recursing. The check is
// here rather than in the recursive core so it runs once per type rather than
// once per level.
func parseFieldTypeString(s string) (string, bool) {
	if typeNodeCount(s) > MaxTypeNodes {
		return "", false
	}
	return parseFieldTypeCore(s)
}

// parseFieldTypeCore is parseFieldTypeString's recursive body. Its depth is
// bounded by its caller: every level strips an `arr<` or `rec<` prefix, so it
// descends at most typeNodeCount(s) times.
func parseFieldTypeCore(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if s == "number" || s == "str" || s == "bool" {
		return s, true
	}
	if strings.HasPrefix(s, "arr<") && strings.HasSuffix(s, ">") {
		inner, ok := parseFieldTypeCore(s[4 : len(s)-1])
		if !ok {
			return "", false
		}
		return "arr<" + inner + ">", true
	}
	if strings.HasPrefix(s, "rec<") && strings.HasSuffix(s, ">") {
		key, value, ok := splitRecordParams(s[4 : len(s)-1])
		if !ok {
			return "", false
		}
		keyName, keyOK := parseFieldTypeCore(key)
		if !keyOK || (keyName != "str" && keyName != "number") {
			return "", false
		}
		valueName, valueOK := parseFieldTypeCore(value)
		if !valueOK {
			return "", false
		}
		return "rec<" + keyName + ", " + valueName + ">", true
	}
	return "", false
}

// FieldTypeFromString returns the FieldType a spelling names, canonicalised:
// `rec<str,number>` and `rec< str , number >` both produce
// FieldTypeRecordStrNumber. It reports false for a spelling that is not a type
// and for one deeper than MaxTypeNodes; WhyFieldTypeRejected says which.
//
// Nothing is registered, cached, or retained. Two compiles in one process see
// the same types for the same spellings and nothing of each other's, and a
// FieldType stays meaningful for as long as its holder does — which is what the
// cached-schema API needs of one.
func FieldTypeFromString(s string) (FieldType, bool) {
	name, ok := parseFieldTypeString(s)
	if !ok {
		return FieldTypeInvalid, false
	}
	return FieldType(name), true
}

// The shape tests below read the canonical spelling rather than a stored
// descriptor. A canonical `arr<T>` is `arr<` + T + `>` and a canonical
// `rec<K, V>` is `rec<` + K + `, ` + V + `>`, so the element, key and value
// types are substrings of the type that contains them, already canonical
// themselves.

func (ft FieldType) IsRecord() bool { return ft.hasShape("rec<") }
func (ft FieldType) RecordKeyType() (FieldType, bool) {
	key, _, ok := ft.recordParams()
	return key, ok
}
func (ft FieldType) RecordValueType() (FieldType, bool) {
	_, value, ok := ft.recordParams()
	return value, ok
}
func (ft FieldType) IsArray() bool { return ft.hasShape("arr<") }
func (ft FieldType) TryElemType() (FieldType, bool) {
	if !ft.IsArray() {
		return FieldTypeInvalid, false
	}
	return ft.inner(), true
}

// hasShape reports whether ft is spelled as the given constructor applied to
// something. The something is not re-parsed: a FieldType built through
// FieldTypeFromString is canonical all the way down.
func (ft FieldType) hasShape(prefix string) bool {
	return len(ft) > len(prefix)+1 && strings.HasPrefix(string(ft), prefix) && strings.HasSuffix(string(ft), ">")
}

// inner returns what a constructor was applied to: the `T` of `arr<T>`, or the
// `K, V` of `rec<K, V>`.
func (ft FieldType) inner() FieldType { return ft[4 : len(ft)-1] }

func (ft FieldType) recordParams() (FieldType, FieldType, bool) {
	if !ft.IsRecord() {
		return FieldTypeInvalid, FieldTypeInvalid, false
	}
	key, value, ok := splitRecordParams(string(ft.inner()))
	if !ok {
		return FieldTypeInvalid, FieldTypeInvalid, false
	}
	return FieldType(key), FieldType(value), true
}

// ────────────────────────────────────────────────────────────
// Sigil — binding direction
// ────────────────────────────────────────────────────────────

// Sigil marks the directional intent of a binding in a compute block.
type Sigil int

// The names say which way the value moves relative to STATE, because that is
// what the arrows say: `<~` reads "comes from state" and `~>` reads "goes to
// state". They were Ingress and Egress, which is the same distinction named
// from an unstated frame — ingress into STATE is egress from the compute block
// — and read as inverted to anyone who picked the other frame.
//
// The ordinal is not a wire format. Sigils are stored in the proto as the
// int32 from ToInt32, which reads as one — but spec/runtime-projection.json
// lists ProgModel.sigils as compiler-only, and the emitter clears it before
// JSON (internal/emit/json.go) while the HCL writer never writes it at all.
// Nothing outside this compile ever sees the number: it is written by the
// lowerer and read back by the validator, in one process, from a model neither
// of them persists. Reorder these freely; just keep sigilNames alongside.
const (
	SigilNone      Sigil = iota // no sigil (plain compute binding)
	SigilToState                // `~>` — the binding writes to STATE
	SigilFromState              // `<~` — the binding reads from STATE
	SigilBiDir                  // `<~>` — bidirectional IO, which writes both arrows
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
// BindingMarker — compute root / transition condition designation
// ────────────────────────────────────────────────────────────

// BindingMarker records the contextual role designated by `:=`. It is
// parser-only metadata: the parser derives ComputeBlock.Root or
// NextComputeBlock.Condition from the result binding, and the marker is not
// carried into the lowered proto model.
type BindingMarker int

const (
	MarkerNone BindingMarker = iota // no marker (ordinary binding)
	MarkerRoot                      // := in an action compute
	MarkerCond                      // := in a transition compute
)

var markerNames = [...]string{"", ":=", ":="}

func (m BindingMarker) String() string {
	if int(m) < len(markerNames) {
		return markerNames[m]
	}
	return fmt.Sprintf("BindingMarker(%d)", int(m))
}

// ────────────────────────────────────────────────────────────
// Top-level
// ────────────────────────────────────────────────────────────

// TurnFile is the root AST node for a .tu source file.
type TurnFile struct {
	StateSource StateSource // nil only if both are absent (error case)
	TypeDecls   []*TypeDecl
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
	Pos         Pos
	ID          string
	EntryAction string
	View        *ViewBlock
	Actions     []*ActionBlock
}

// ViewBlock is the `overview <mode> { a |-> b }` sub-block of a scene.
//
// It replaced `view "overview" { flow = <<-EOT ... EOT enforce = "..." }` in v2
// (NEW_SYNTAX.md 2.2). Name is retained because the lowered proto still carries
// it, but it is always "overview" now that the label is gone — which is what
// retired SCN_OVERVIEW_UNKNOWN_VIEW.
type ViewBlock struct {
	Pos  Pos
	Name string
	// Edges are the parsed flow edges, each carrying the source position of its
	// `|->`. Positions are the reason the flow moved out of the heredoc: as an
	// opaque string it produced diagnostics with no file:line:col at all.
	Edges []FlowEdge
	// Nodes lists every action named in the flow, in first-appearance order,
	// each carrying the source position of the name token. Positions are what
	// let `OverviewUnknownNode` point at the offending line instead of naming
	// the scene and leaving the author to find it.
	Nodes   []FlowNode
	Enforce string
}

// FlowEdge is a single `from |-> to` edge in an overview block.
// Pos is the position of the `|->` token.
type FlowEdge struct {
	Pos      Pos
	From, To string
}

// FlowNode is a single action name declared in an overview block.
type FlowNode struct {
	Pos  Pos
	Name string
}
