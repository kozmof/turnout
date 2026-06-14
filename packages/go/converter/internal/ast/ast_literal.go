package ast

import (
	"fmt"

	"google.golang.org/protobuf/types/known/structpb"
)

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
