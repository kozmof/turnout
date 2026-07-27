package ast

import (
	"math"
	"strconv"
	"strings"
)

// ────────────────────────────────────────────────────────────
// Structured type IR
// ────────────────────────────────────────────────────────────
//
// Type is the structured representation of a Turnout type as introduced by the
// literal & template type specification (literal-template-types-spec.md). It is a superset of
// FieldType: every scalar FieldType has an equivalent PrimitiveType, while
// literal, union, and template types are new forms with no FieldType analogue.
//
// The type-system primitive set (str, integer, number, bool) is intentionally
// finer-grained than FieldType, which has only `number`. `integer` is tracked
// distinctly here (integer <: number, literal-template-types-spec.md §24.2) and collapses to `number`
// only when bridged back to the flat FieldType/runtime layer.
//
// Every node carries a Pos for diagnostics. Interface marker methods keep the
// set of variants closed and force exhaustive type switches.
type Type interface {
	typeNode()
	Pos() Pos
	// String renders the canonical DSL form of the type.
	String() string
}

// PrimitiveKind enumerates the type-system scalar primitives. PrimInvalid (0)
// is the safe zero value.
type PrimitiveKind int

const (
	PrimInvalid      PrimitiveKind = iota // 0: zero value → invalid
	PrimStr                               // str
	PrimInteger                           // integer
	PrimNumber                            // number
	PrimBool                              // bool
	primKindSentinel                      // unexported end marker; add new kinds above
)

var primitiveKindNames = map[PrimitiveKind]string{
	PrimStr:     "str",
	PrimInteger: "integer",
	PrimNumber:  "number",
	PrimBool:    "bool",
}

var primitiveKindByString = map[string]PrimitiveKind{
	"str":     PrimStr,
	"integer": PrimInteger,
	"number":  PrimNumber,
	"bool":    PrimBool,
}

func (k PrimitiveKind) String() string {
	if name, ok := primitiveKindNames[k]; ok {
		return name
	}
	return "PrimitiveKind(invalid)"
}

// Valid reports whether k is a recognised (non-zero, in-range) PrimitiveKind.
func (k PrimitiveKind) Valid() bool {
	return k > PrimInvalid && k < primKindSentinel
}

// PrimitiveKindFromString maps a DSL primitive keyword to a PrimitiveKind.
func PrimitiveKindFromString(s string) (PrimitiveKind, bool) {
	k, ok := primitiveKindByString[s]
	return k, ok
}

// ────────────────────────────────────────────────────────────
// PrimitiveType
// ────────────────────────────────────────────────────────────

// PrimitiveType is one of str / integer / number / bool.
type PrimitiveType struct {
	tpos Pos
	Kind PrimitiveKind
}

func (*PrimitiveType) typeNode()        {}
func (t *PrimitiveType) Pos() Pos       { return t.tpos }
func (t *PrimitiveType) String() string { return t.Kind.String() }

// NewPrimitiveType constructs a PrimitiveType.
func NewPrimitiveType(pos Pos, kind PrimitiveKind) *PrimitiveType {
	return &PrimitiveType{tpos: pos, Kind: kind}
}

// ────────────────────────────────────────────────────────────
// LiteralType
// ────────────────────────────────────────────────────────────

// LiteralType is a type containing exactly one scalar value (literal-template-types-spec.md §4.2).
// Value is one of *StringLiteral, *NumberLiteral, *BoolLiteral.
type LiteralType struct {
	tpos  Pos
	Value Literal
}

func (*LiteralType) typeNode()  {}
func (t *LiteralType) Pos() Pos { return t.tpos }

func (t *LiteralType) String() string {
	switch v := t.Value.(type) {
	case *StringLiteral:
		return strconv.Quote(v.Value)
	case *NumberLiteral:
		return formatNumber(v.Value)
	case *BoolLiteral:
		return strconv.FormatBool(v.Value)
	}
	return "<invalid literal>"
}

// NewLiteralType constructs a LiteralType from a scalar Literal.
func NewLiteralType(pos Pos, value Literal) *LiteralType {
	return &LiteralType{tpos: pos, Value: value}
}

// BaseKind returns the primitive base type of the literal value (literal-template-types-spec.md
// §24.1). An integral number literal has base `integer`; a non-integral one has
// base `number`.
func (t *LiteralType) BaseKind() PrimitiveKind {
	switch v := t.Value.(type) {
	case *StringLiteral:
		return PrimStr
	case *BoolLiteral:
		return PrimBool
	case *NumberLiteral:
		if isIntegral(v.Value) {
			return PrimInteger
		}
		return PrimNumber
	}
	return PrimInvalid
}

// ────────────────────────────────────────────────────────────
// UnionType
// ────────────────────────────────────────────────────────────

// UnionType is a finite union of literal types (literal-template-types-spec.md §4.3). In the initial
// implementation every member is a *LiteralType and all members share a
// compatible base type (§5.3).
type UnionType struct {
	tpos    Pos
	Members []Type
}

func (*UnionType) typeNode()  {}
func (t *UnionType) Pos() Pos { return t.tpos }

func (t *UnionType) String() string {
	parts := make([]string, len(t.Members))
	for i, m := range t.Members {
		parts[i] = m.String()
	}
	return strings.Join(parts, " | ")
}

// NewUnionType constructs a UnionType.
func NewUnionType(pos Pos, members []Type) *UnionType {
	return &UnionType{tpos: pos, Members: members}
}

// ────────────────────────────────────────────────────────────
// TemplateType
// ────────────────────────────────────────────────────────────

// TemplateType is a string type composed of static text and typed capture
// segments (literal-template-types-spec.md §4.4, §6). Empty text segments are normalized away
// (§6.5).
type TemplateType struct {
	tpos     Pos
	Segments []TemplateSegment
}

func (*TemplateType) typeNode()  {}
func (t *TemplateType) Pos() Pos { return t.tpos }

func (t *TemplateType) String() string {
	var b strings.Builder
	b.WriteByte('"')
	for _, seg := range t.Segments {
		switch s := seg.(type) {
		case *TextSegment:
			b.WriteString(s.Value)
		case *CaptureSegment:
			b.WriteByte('{')
			b.WriteString(s.Name)
			b.WriteString(": ")
			b.WriteString(s.CaptureType.String())
			b.WriteByte('}')
		}
	}
	b.WriteByte('"')
	return b.String()
}

// NewTemplateType constructs a TemplateType.
func NewTemplateType(pos Pos, segments []TemplateSegment) *TemplateType {
	return &TemplateType{tpos: pos, Segments: segments}
}

// Captures returns the capture segments of the template in order.
func (t *TemplateType) Captures() []*CaptureSegment {
	var caps []*CaptureSegment
	for _, seg := range t.Segments {
		if c, ok := seg.(*CaptureSegment); ok {
			caps = append(caps, c)
		}
	}
	return caps
}

// TemplateSegment is a single segment of a template literal type: either static
// text or a typed capture.
type TemplateSegment interface{ templateSegment() }

// TextSegment is a run of static text within a template.
type TextSegment struct{ Value string }

func (*TextSegment) templateSegment() {}

// CaptureSegment is a named, typed capture within a template.
type CaptureSegment struct {
	Pos         Pos
	Name        string
	CaptureType Type
}

func (*CaptureSegment) templateSegment() {}

// ────────────────────────────────────────────────────────────
// NamedType
// ────────────────────────────────────────────────────────────

// NamedType is a reference to a named type declaration (literal-template-types-spec.md §5.4). Resolved
// is populated by the resolution pass; it is nil until the reference is bound.
type NamedType struct {
	tpos     Pos
	Name     string
	Resolved Type
}

func (*NamedType) typeNode()        {}
func (t *NamedType) Pos() Pos       { return t.tpos }
func (t *NamedType) String() string { return t.Name }

// NewNamedType constructs an unresolved NamedType.
func NewNamedType(pos Pos, name string) *NamedType {
	return &NamedType{tpos: pos, Name: name}
}

// ────────────────────────────────────────────────────────────
// TypeDecl — top-level `type Name = Type`
// ────────────────────────────────────────────────────────────

// TypeDecl is a top-level named type declaration (literal-template-types-spec.md §21).
type TypeDecl struct {
	Pos  Pos
	Name string
	Type Type
}

// ────────────────────────────────────────────────────────────
// Bridge to / from FieldType
// ────────────────────────────────────────────────────────────

// AsFieldType maps a PrimitiveKind to the flat FieldType used by the runtime
// state model. `integer` collapses to `number` because the runtime has no
// distinct integer type. Returns (FieldTypeInvalid, false) for kinds with no
// scalar FieldType (none currently).
func (k PrimitiveKind) AsFieldType() (FieldType, bool) {
	switch k {
	case PrimStr:
		return FieldTypeStr, true
	case PrimBool:
		return FieldTypeBool, true
	case PrimInteger, PrimNumber:
		return FieldTypeNumber, true
	}
	return FieldTypeInvalid, false
}

// PrimitiveKindFromFieldType maps a scalar FieldType to a PrimitiveKind. Array
// FieldTypes and FieldTypeInvalid return (PrimInvalid, false).
func PrimitiveKindFromFieldType(ft FieldType) (PrimitiveKind, bool) {
	switch ft {
	case FieldTypeStr:
		return PrimStr, true
	case FieldTypeBool:
		return PrimBool, true
	case FieldTypeNumber:
		return PrimNumber, true
	}
	return PrimInvalid, false
}

// ────────────────────────────────────────────────────────────
// Numeric helpers
// ────────────────────────────────────────────────────────────

// isIntegral reports whether f is a finite integer-valued float.
func isIntegral(f float64) bool {
	return !math.IsInf(f, 0) && !math.IsNaN(f) && math.Trunc(f) == f
}

// formatNumber renders a numeric literal in canonical form: integral values
// without a decimal point, others via the shortest round-trripping form.
func formatNumber(f float64) string {
	if isIntegral(f) && math.Abs(f) < 1e15 {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}
