// Package ast — internal test file to exercise unexported marker methods.
// These empty methods exist solely for interface discrimination; calling them
// satisfies the coverage requirement without adding runtime cost.
package ast

import "testing"

// TestMarkerMethods calls every unexported interface-marker method to achieve
// coverage. All method bodies are empty, so the only thing being measured is
// whether the function entry is reached.
func TestMarkerMethods(t *testing.T) {
	// StateSource markers
	(*InlineStateBlock)(nil).stateSource()
	(*StateFileDirective)(nil).stateSource()

	// BindingRHS markers
	(*LiteralRHS)(nil).bindingRHS()
	(*PlaceholderRHS)(nil).bindingRHS()
	(*SingleRefRHS)(nil).bindingRHS()
	(*FuncCallRHS)(nil).bindingRHS()
	(*InfixRHS)(nil).bindingRHS()
	(*PipeRHS)(nil).bindingRHS()
	(*CondRHS)(nil).bindingRHS()
	(*IfRHS)(nil).bindingRHS()

	// Arg markers
	(*RefArg)(nil).arg()
	(*LitArg)(nil).arg()
	(*FuncRefArg)(nil).arg()
	(*StepRefArg)(nil).arg()
	(*TransformArg)(nil).arg()

	// CondExpr markers
	(*CondExprRef)(nil).condExpr()
	(*CondExprCall)(nil).condExpr()

	// ActionPrepareSource markers
	(*FromState)(nil).actionPrepareSource()
	(*FromHook)(nil).actionPrepareSource()

	// NextPrepareSource markers
	(*FromState)(nil).nextPrepareSource()
	(*FromLiteral)(nil).nextPrepareSource()
	(*FromAction)(nil).nextPrepareSource()

	// Literal markers
	(*NumberLiteral)(nil).literal()
	(*StringLiteral)(nil).literal()
	(*BoolLiteral)(nil).literal()
	(*ArrayLiteral)(nil).literal()
}

// TestEnumStringOutOfBounds covers the default branches in String() methods,
// which are reached only when an out-of-range enum value is used.
func TestEnumStringOutOfBounds(t *testing.T) {
	ft := FieldType(999)
	if got := ft.String(); got != "FieldType(999)" {
		t.Errorf("FieldType(999).String() = %q, want %q", got, "FieldType(999)")
	}

	s := Sigil(99)
	if got := s.String(); got != "Sigil(99)" {
		t.Errorf("Sigil(99).String() = %q, want %q", got, "Sigil(99)")
	}

	op := InfixOp(99)
	if got := op.String(); got != "InfixOp(99)" {
		t.Errorf("InfixOp(99).String() = %q, want %q", got, "InfixOp(99)")
	}
}

// TestInfixOpFnAliasDefault covers the default branch in FnAlias() which is
// reached for out-of-range InfixOp values.
func TestInfixOpFnAliasDefault(t *testing.T) {
	op := InfixOp(999)
	if got := op.FnAlias(); got != "" {
		t.Errorf("InfixOp(999).FnAlias() = %q, want empty string", got)
	}
}
