// Package ast defines the AST node types for the Turn DSL.
//
// Every node carries a Pos for source-location diagnostics. Interface types use
// unexported marker methods so the compiler enforces exhaustive type switches.
package ast

import (
	"fmt"
	"strings"
	"sync"
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

type FieldType int

const (
	FieldTypeInvalid FieldType = iota
	FieldTypeNumber
	FieldTypeStr
	FieldTypeBool
	FieldTypeArrNumber
	FieldTypeArrStr
	FieldTypeArrBool
	FieldTypeRecordStrNumber
	FieldTypeRecordStrStr
	FieldTypeRecordStrBool
	FieldTypeRecordNumberNumber
	FieldTypeRecordNumberStr
	FieldTypeRecordNumberBool
	fieldTypeSentinel
)

type fieldTypeKind uint8

const (
	fieldTypePrimitive fieldTypeKind = iota
	fieldTypeArray
	fieldTypeRecord
)

type fieldTypeDesc struct {
	name             string
	kind             fieldTypeKind
	elem, key, value FieldType
}

var (
	fieldTypesMu sync.RWMutex
	fieldTypes   = map[FieldType]fieldTypeDesc{
		FieldTypeNumber: {name: "number", kind: fieldTypePrimitive}, FieldTypeStr: {name: "str", kind: fieldTypePrimitive}, FieldTypeBool: {name: "bool", kind: fieldTypePrimitive},
		FieldTypeArrNumber: {name: "arr<number>", kind: fieldTypeArray, elem: FieldTypeNumber}, FieldTypeArrStr: {name: "arr<str>", kind: fieldTypeArray, elem: FieldTypeStr}, FieldTypeArrBool: {name: "arr<bool>", kind: fieldTypeArray, elem: FieldTypeBool},
		FieldTypeRecordStrNumber: {name: "rec<str, number>", kind: fieldTypeRecord, key: FieldTypeStr, value: FieldTypeNumber}, FieldTypeRecordStrStr: {name: "rec<str, str>", kind: fieldTypeRecord, key: FieldTypeStr, value: FieldTypeStr}, FieldTypeRecordStrBool: {name: "rec<str, bool>", kind: fieldTypeRecord, key: FieldTypeStr, value: FieldTypeBool},
		FieldTypeRecordNumberNumber: {name: "rec<number, number>", kind: fieldTypeRecord, key: FieldTypeNumber, value: FieldTypeNumber}, FieldTypeRecordNumberStr: {name: "rec<number, str>", kind: fieldTypeRecord, key: FieldTypeNumber, value: FieldTypeStr}, FieldTypeRecordNumberBool: {name: "rec<number, bool>", kind: fieldTypeRecord, key: FieldTypeNumber, value: FieldTypeBool},
	}
	fieldTypesByName = map[string]FieldType{
		"number": FieldTypeNumber, "str": FieldTypeStr, "bool": FieldTypeBool, "arr<number>": FieldTypeArrNumber, "arr<str>": FieldTypeArrStr, "arr<bool>": FieldTypeArrBool,
		"rec<str, number>": FieldTypeRecordStrNumber, "rec<str, str>": FieldTypeRecordStrStr, "rec<str, bool>": FieldTypeRecordStrBool, "rec<number, number>": FieldTypeRecordNumberNumber, "rec<number, str>": FieldTypeRecordNumberStr, "rec<number, bool>": FieldTypeRecordNumberBool,
	}
	nextFieldType = fieldTypeSentinel
)

// BaseFieldTypes returns the field types declared as constants, in declaration
// order. These are the vocabulary the two languages pre-declare and that
// spec/field-types.json enumerates.
//
// They are not the whole of what the type grammar accepts. `arr<` and `rec<`
// compose to any depth the runtime can hold, and anything past this list is
// interned on first sight — so the registry is open where this list is closed,
// and only this list can be checked against the spec.
func BaseFieldTypes() []FieldType {
	types := make([]FieldType, 0, int(fieldTypeSentinel)-1)
	for ft := FieldTypeInvalid + 1; ft < fieldTypeSentinel; ft++ {
		types = append(types, ft)
	}
	return types
}

func fieldTypeDescriptor(ft FieldType) (fieldTypeDesc, bool) {
	fieldTypesMu.RLock()
	d, ok := fieldTypes[ft]
	fieldTypesMu.RUnlock()
	return d, ok
}
func (ft FieldType) Valid() bool { _, ok := fieldTypeDescriptor(ft); return ok }
func (ft FieldType) String() string {
	if ft == FieldTypeInvalid {
		return "FieldType(invalid)"
	}
	if d, ok := fieldTypeDescriptor(ft); ok {
		return d.name
	}
	return fmt.Sprintf("FieldType(%d)", int(ft))
}
func (ft FieldType) ProtoString() string { return ft.String() }

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

// FieldTypeRejection says why FieldTypeFromString returned false. The three
// are one `false` to a caller that only wants the type, and three different
// mistakes to a caller that has to explain it: a spelling that is not a type, a
// type too deep for the runtime to represent, and a type this process has no
// room left to intern.
type FieldTypeRejection int

const (
	// FieldTypeRejectedSpelling means s does not name a type at all.
	FieldTypeRejectedSpelling FieldTypeRejection = iota
	// FieldTypeRejectedTooDeep means s names a well-formed type with more than
	// MaxTypeNodes nodes.
	FieldTypeRejectedTooDeep
	// FieldTypeRejectedRegistryFull means s names a type that would have been
	// accepted, in a process that has already interned
	// MaxRegisteredFieldTypes of them.
	FieldTypeRejectedRegistryFull
)

// WhyFieldTypeRejected classifies a spelling FieldTypeFromString rejected, and
// returns the node count that goes with FieldTypeRejectedTooDeep. Call it only
// on the failure path: it re-does the parse the failure came from.
func WhyFieldTypeRejected(s string) (FieldTypeRejection, int) {
	nodes := typeNodeCount(s)
	if nodes > MaxTypeNodes {
		return FieldTypeRejectedTooDeep, nodes
	}
	if _, _, ok := parseFieldTypeCore(s); !ok {
		return FieldTypeRejectedSpelling, nodes
	}
	// It parses, so the only thing that can have refused it is the registry.
	return FieldTypeRejectedRegistryFull, nodes
}

// parseFieldTypeString parses a field type spelling, rejecting anything past
// MaxTypeNodes before recursing. The check is here rather than in the recursive
// core so it runs once per type rather than once per level.
func parseFieldTypeString(s string) (string, fieldTypeDesc, bool) {
	if typeNodeCount(s) > MaxTypeNodes {
		return "", fieldTypeDesc{}, false
	}
	return parseFieldTypeCore(s)
}

// parseFieldTypeCore is parseFieldTypeString's recursive body. Its depth is
// bounded by its caller: every level strips an `arr<` or `rec<` prefix, so it
// descends at most typeNodeCount(s) times.
func parseFieldTypeCore(s string) (string, fieldTypeDesc, bool) {
	s = strings.TrimSpace(s)
	if s == "number" || s == "str" || s == "bool" {
		return s, fieldTypeDesc{name: s, kind: fieldTypePrimitive}, true
	}
	if strings.HasPrefix(s, "arr<") && strings.HasSuffix(s, ">") {
		inner, _, ok := parseFieldTypeCore(s[4 : len(s)-1])
		if !ok {
			return "", fieldTypeDesc{}, false
		}
		return "arr<" + inner + ">", fieldTypeDesc{kind: fieldTypeArray}, true
	}
	if strings.HasPrefix(s, "rec<") && strings.HasSuffix(s, ">") {
		key, value, ok := splitRecordParams(s[4 : len(s)-1])
		if !ok {
			return "", fieldTypeDesc{}, false
		}
		keyName, _, keyOK := parseFieldTypeCore(key)
		if !keyOK || (keyName != "str" && keyName != "number") {
			return "", fieldTypeDesc{}, false
		}
		valueName, _, valueOK := parseFieldTypeCore(value)
		if !valueOK {
			return "", fieldTypeDesc{}, false
		}
		return "rec<" + keyName + ", " + valueName + ">", fieldTypeDesc{kind: fieldTypeRecord}, true
	}
	return "", fieldTypeDesc{}, false
}

// MaxRegisteredFieldTypes bounds the process-global type registry.
//
// Composed types are interned on first sight and never released, because a
// FieldType is an integer that has to keep meaning the same thing for as long
// as anything holds it. That is fine for a CLI, which exits. It is not fine for
// the callers the cached-schema API exists for — an LSP, an incremental
// checker, the Node bridge — which compile source they did not write, for as
// long as the process lives.
//
// The bound is far above any real schema and is not a budget to design
// against: reaching it means something is generating type spellings, not
// writing them. Registration past it fails rather than growing, which does make
// the outcome depend on what the process compiled earlier. That is the lesser
// of the two, and the honest fix is to stop interning into a global at all —
// see RegisteredFieldTypes for what a caller can do in the meantime.
const MaxRegisteredFieldTypes = 4096

// RegisteredFieldTypes returns how many field types are interned, base types
// included. A long-lived host can watch it to know whether it is approaching
// MaxRegisteredFieldTypes, which it cannot recover from without restarting.
func RegisteredFieldTypes() int {
	fieldTypesMu.RLock()
	defer fieldTypesMu.RUnlock()
	return len(fieldTypesByName)
}

func FieldTypeFromString(s string) (FieldType, bool) {
	name, desc, ok := parseFieldTypeString(s)
	if !ok {
		return FieldTypeInvalid, false
	}
	fieldTypesMu.RLock()
	existing, found := fieldTypesByName[name]
	fieldTypesMu.RUnlock()
	if found {
		return existing, true
	}
	if desc.kind == fieldTypeArray {
		desc.elem, _ = FieldTypeFromString(name[4 : len(name)-1])
	} else if desc.kind == fieldTypeRecord {
		keyName, valueName, _ := splitRecordParams(name[4 : len(name)-1])
		desc.key, _ = FieldTypeFromString(keyName)
		desc.value, _ = FieldTypeFromString(valueName)
	}
	desc.name = name
	fieldTypesMu.Lock()
	defer fieldTypesMu.Unlock()
	if existing, found := fieldTypesByName[name]; found {
		return existing, true
	}
	// Re-checked under the write lock: the read in RegistryFull is only a hint.
	if len(fieldTypesByName) >= MaxRegisteredFieldTypes {
		return FieldTypeInvalid, false
	}
	ft := nextFieldType
	nextFieldType++
	fieldTypes[ft] = desc
	fieldTypesByName[name] = ft
	return ft, true
}
func (ft FieldType) IsRecord() bool {
	d, ok := fieldTypeDescriptor(ft)
	return ok && d.kind == fieldTypeRecord
}
func (ft FieldType) RecordKeyType() (FieldType, bool) {
	d, ok := fieldTypeDescriptor(ft)
	if !ok || d.kind != fieldTypeRecord {
		return FieldTypeInvalid, false
	}
	return d.key, true
}
func (ft FieldType) RecordValueType() (FieldType, bool) {
	d, ok := fieldTypeDescriptor(ft)
	if !ok || d.kind != fieldTypeRecord {
		return FieldTypeInvalid, false
	}
	return d.value, true
}
func (ft FieldType) IsArray() bool {
	d, ok := fieldTypeDescriptor(ft)
	return ok && d.kind == fieldTypeArray
}
func (ft FieldType) TryElemType() (FieldType, bool) {
	d, ok := fieldTypeDescriptor(ft)
	if !ok || d.kind != fieldTypeArray {
		return FieldTypeInvalid, false
	}
	return d.elem, true
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
// The order is the wire format. Sigils are stored in the proto as the int32
// from ToInt32, so these may be renamed but not reordered.
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
