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
func parseFieldTypeString(s string) (string, fieldTypeDesc, bool) {
	s = strings.TrimSpace(s)
	if s == "number" || s == "str" || s == "bool" {
		return s, fieldTypeDesc{name: s, kind: fieldTypePrimitive}, true
	}
	if strings.HasPrefix(s, "arr<") && strings.HasSuffix(s, ">") {
		inner, _, ok := parseFieldTypeString(s[4 : len(s)-1])
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
		keyName, _, keyOK := parseFieldTypeString(key)
		if !keyOK || (keyName != "str" && keyName != "number") {
			return "", fieldTypeDesc{}, false
		}
		valueName, _, valueOK := parseFieldTypeString(value)
		if !valueOK {
			return "", fieldTypeDesc{}, false
		}
		return "rec<" + keyName + ", " + valueName + ">", fieldTypeDesc{kind: fieldTypeRecord}, true
	}
	return "", fieldTypeDesc{}, false
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

// Sigil marks the directional intent of a binding in a compute block.
type Sigil int

const (
	SigilNone Sigil = iota // no sigil (plain compute binding)
	// Internal historical names retained for wire compatibility. Surface input
	// is `<~`; surface output is `~>`; bidirectional IO writes both arrows.
	SigilIngress
	SigilEgress
	SigilBiDir
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
