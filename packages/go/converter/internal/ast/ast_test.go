package ast_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
)

// ── compile-time interface checks ─────────────────────────────────────────────
//
// These blank-identifier assignments fail at compile time if the named type
// does not satisfy the interface, giving us exhaustive coverage with zero
// runtime cost.

var (
	// StateSource
	_ ast.StateSource = (*ast.InlineStateBlock)(nil)
	_ ast.StateSource = (*ast.StateFileDirective)(nil)

	// BindingRHS
	_ ast.BindingRHS = (*ast.LiteralRHS)(nil)
	_ ast.BindingRHS = (*ast.SingleRefRHS)(nil)
	_ ast.BindingRHS = (*ast.FuncCallRHS)(nil)
	_ ast.BindingRHS = (*ast.InfixRHS)(nil)

	// Arg
	_ ast.Arg = (*ast.RefArg)(nil)
	_ ast.Arg = (*ast.LitArg)(nil)
	_ ast.Arg = (*ast.FuncRefArg)(nil)
	_ ast.Arg = (*ast.StepRefArg)(nil)
	_ ast.Arg = (*ast.TransformArg)(nil)

	// ActionPrepareSource — FromState, FromHook
	_ ast.ActionPrepareSource = (*ast.FromState)(nil)
	_ ast.ActionPrepareSource = (*ast.FromHook)(nil)

	// NextPrepareSource — FromState, FromAction, FromLiteral
	_ ast.NextPrepareSource = (*ast.FromState)(nil)
	_ ast.NextPrepareSource = (*ast.FromAction)(nil)
	_ ast.NextPrepareSource = (*ast.FromLiteral)(nil)

	// Literal
	_ ast.Literal = (*ast.NumberLiteral)(nil)
	_ ast.Literal = (*ast.StringLiteral)(nil)
	_ ast.Literal = (*ast.BoolLiteral)(nil)
	_ ast.Literal = (*ast.ArrayLiteral)(nil)
)

// ── Compile-time sentinel notes ───────────────────────────────────────────────
//
// ast.go contains two compile-time exhaustiveness sentinels:
//   - fieldTypeExhaustiveCheck  (FieldType)     — enforces FieldType switch sites
//   - rhsKindExhaustiveCheck    (BindingRHSKind) — enforces BindingRHSKind switch sites
//
// These arrays cause a compile error when a new constant is added without
// updating the array, forcing the developer to audit all affected switch sites.
// No runtime test is needed — the build itself is the test.

// ── FieldType ─────────────────────────────────────────────────────────────────

func TestFieldTypeString(t *testing.T) {
	cases := []struct {
		ft   ast.FieldType
		want string
	}{
		{ast.FieldTypeNumber, "number"},
		{ast.FieldTypeStr, "str"},
		{ast.FieldTypeBool, "bool"},
		{ast.FieldTypeArrNumber, "arr<number>"},
		{ast.FieldTypeArrStr, "arr<str>"},
		{ast.FieldTypeArrBool, "arr<bool>"},
	}
	for _, tc := range cases {
		if got := tc.ft.String(); got != tc.want {
			t.Errorf("FieldType(%d).String() = %q, want %q", int(tc.ft), got, tc.want)
		}
	}
}

func TestFieldTypeFromString(t *testing.T) {
	valid := []string{"number", "str", "bool", "arr<number>", "arr<str>", "arr<bool>"}
	for _, s := range valid {
		ft, ok := ast.FieldTypeFromString(s)
		if !ok {
			t.Errorf("FieldTypeFromString(%q) returned false", s)
		}
		if ft.String() != s {
			t.Errorf("FieldTypeFromString(%q).String() = %q, want round-trip", s, ft.String())
		}
	}

	if _, ok := ast.FieldTypeFromString("integer"); ok {
		t.Error("FieldTypeFromString(\"integer\") should return false")
	}
	if _, ok := ast.FieldTypeFromString(""); ok {
		t.Error("FieldTypeFromString(\"\") should return false")
	}
}

func TestFieldTypeIsArray(t *testing.T) {
	arrays := []ast.FieldType{ast.FieldTypeArrNumber, ast.FieldTypeArrStr, ast.FieldTypeArrBool}
	for _, ft := range arrays {
		if !ft.IsArray() {
			t.Errorf("%s.IsArray() = false, want true", ft)
		}
	}
	scalars := []ast.FieldType{ast.FieldTypeNumber, ast.FieldTypeStr, ast.FieldTypeBool}
	for _, ft := range scalars {
		if ft.IsArray() {
			t.Errorf("%s.IsArray() = true, want false", ft)
		}
	}
}

func TestFieldTypeElemType(t *testing.T) {
	cases := []struct {
		arr  ast.FieldType
		elem ast.FieldType
	}{
		{ast.FieldTypeArrNumber, ast.FieldTypeNumber},
		{ast.FieldTypeArrStr, ast.FieldTypeStr},
		{ast.FieldTypeArrBool, ast.FieldTypeBool},
	}
	for _, tc := range cases {
		if got := tc.arr.ElemType(); got != tc.elem {
			t.Errorf("%s.ElemType() = %s, want %s", tc.arr, got, tc.elem)
		}
	}
}

func TestFieldTypeElemTypePanicsOnScalar(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Error("ElemType on scalar type should panic")
		}
	}()
	ast.FieldTypeNumber.ElemType()
}

// ── Sigil ─────────────────────────────────────────────────────────────────────

func TestSigilString(t *testing.T) {
	cases := []struct {
		s    ast.Sigil
		want string
	}{
		{ast.SigilNone, ""},
		{ast.SigilIngress, "~>"},
		{ast.SigilEgress, "<~"},
		{ast.SigilBiDir, "<~>"},
	}
	for _, tc := range cases {
		if got := tc.s.String(); got != tc.want {
			t.Errorf("Sigil(%d).String() = %q, want %q", int(tc.s), got, tc.want)
		}
	}
}

// ── InfixOp ───────────────────────────────────────────────────────────────────

func TestInfixOpString(t *testing.T) {
	cases := []struct {
		op   ast.InfixOp
		want string
	}{
		{ast.InfixAnd, "&"},
		{ast.InfixGTE, ">="},
		{ast.InfixLTE, "<="},
		{ast.InfixGT, ">"},
		{ast.InfixLT, "<"},
		{ast.InfixBoolOr, "|"},
		{ast.InfixEq, "=="},
		{ast.InfixNeq, "!="},
		{ast.InfixPlus, "+"},
		{ast.InfixSub, "-"},
		{ast.InfixMul, "*"},
		{ast.InfixDiv, "/"},
		{ast.InfixMod, "%"},
	}
	for _, tc := range cases {
		if got := tc.op.String(); got != tc.want {
			t.Errorf("InfixOp(%d).String() = %q, want %q", int(tc.op), got, tc.want)
		}
	}
}

func TestInfixOpFnAliasForType(t *testing.T) {
	// Fixed-alias operators: FnAliasForType is type-independent.
	fixedCases := []struct {
		op   ast.InfixOp
		want string
	}{
		{ast.InfixAnd, "bool_and"},
		{ast.InfixGTE, "gte"},
		{ast.InfixLTE, "lte"},
		{ast.InfixGT, "gt"},
		{ast.InfixLT, "lt"},
		{ast.InfixBoolOr, "bool_or"},
		{ast.InfixEq, "eq"},
		{ast.InfixNeq, "neq"},
		{ast.InfixSub, "sub"},
		{ast.InfixMul, "mul"},
		{ast.InfixDiv, "div"},
		{ast.InfixMod, "mod"},
	}
	for _, tc := range fixedCases {
		if got := tc.op.FnAliasForType(ast.FieldTypeNumber); got != tc.want {
			t.Errorf("InfixOp(%d).FnAliasForType(number) = %q, want %q", int(tc.op), got, tc.want)
		}
	}

	// InfixPlus is type-dispatched.
	if got := ast.InfixPlus.FnAliasForType(ast.FieldTypeNumber); got != "add" {
		t.Errorf("InfixPlus.FnAliasForType(number) = %q, want %q", got, "add")
	}
	if got := ast.InfixPlus.FnAliasForType(ast.FieldTypeStr); got != "str_concat" {
		t.Errorf("InfixPlus.FnAliasForType(str) = %q, want %q", got, "str_concat")
	}
}

// ── Pos ───────────────────────────────────────────────────────────────────────

func TestPosString(t *testing.T) {
	p := ast.Pos{File: "foo.turn", Line: 10, Col: 5}
	if got := p.String(); got != "foo.turn:10:5" {
		t.Errorf("Pos.String() = %q, want %q", got, "foo.turn:10:5")
	}
	p2 := ast.Pos{Line: 3, Col: 7}
	if got := p2.String(); got != "3:7" {
		t.Errorf("Pos.String() (no file) = %q, want %q", got, "3:7")
	}
}

// ── FromState dual interface ──────────────────────────────────────────────────

func TestFromStateDualInterface(t *testing.T) {
	// FromState should satisfy both ActionPrepareSource and NextPrepareSource
	fs := &ast.FromState{Path: "applicant.income"}
	var _ ast.ActionPrepareSource = fs
	var _ ast.NextPrepareSource = fs
	if fs.Path != "applicant.income" {
		t.Errorf("FromState.Path = %q, want %q", fs.Path, "applicant.income")
	}
}

func TestFromLiteralNextPrepareOnly(t *testing.T) {
	// FromLiteral implements only NextPrepareSource (forbidden at action level)
	fl := &ast.FromLiteral{Value: &ast.NumberLiteral{Value: 42}}
	var _ ast.NextPrepareSource = fl
}

func TestFromHookActionPrepareOnly(t *testing.T) {
	// FromHook must satisfy ActionPrepareSource
	var _ ast.ActionPrepareSource = (*ast.FromHook)(nil)
	// (FromHook does NOT satisfy NextPrepareSource — compile-time check only via absence)
}

func TestFromActionNextPrepareOnly(t *testing.T) {
	// FromAction must satisfy NextPrepareSource
	var _ ast.NextPrepareSource = (*ast.FromAction)(nil)
}

// ── Construction smoke tests ──────────────────────────────────────────────────

func TestTurnFileConstruction(t *testing.T) {
	p := ast.Pos{File: "test.turn", Line: 1, Col: 1}
	tf := &ast.TurnFile{
		StateSource: &ast.InlineStateBlock{
			Pos: p,
			Namespaces: []*ast.NamespaceDecl{
				{
					Pos:  p,
					Name: "applicant",
					Fields: []*ast.FieldDecl{
						{
							Pos:     p,
							Name:    "income",
							Type:    ast.FieldTypeNumber,
							Default: &ast.NumberLiteral{Value: 0},
						},
					},
				},
			},
		},
		Scenes: []*ast.SceneBlock{{
			Pos:          p,
			ID:           "loan_flow",
			EntryActions: []string{"score"},
			NextPolicy:   "first-match",
		}},
	}

	if tf.Scenes[0].ID != "loan_flow" {
		t.Errorf("scene ID = %q, want %q", tf.Scenes[0].ID, "loan_flow")
	}

	ns := tf.StateSource.(*ast.InlineStateBlock).Namespaces[0]
	if ns.Name != "applicant" {
		t.Errorf("namespace name = %q, want %q", ns.Name, "applicant")
	}
	if ns.Fields[0].Type != ast.FieldTypeNumber {
		t.Errorf("field type = %v, want FieldTypeNumber", ns.Fields[0].Type)
	}
}

func TestActionBlockConstruction(t *testing.T) {
	p := ast.Pos{}
	text := "Logic overview: ..."
	action := &ast.ActionBlock{
		Pos:  p,
		ID:   "score",
		Text: &text,
		Compute: &ast.ComputeBlock{
			Root: "decision",
			Prog: &ast.ProgBlock{
				Name: "score_graph",
				Bindings: []*ast.BindingDecl{
					{
						Sigil: ast.SigilIngress,
						Name:  "income",
						Type:  ast.FieldTypeNumber,
						RHS:   &ast.SigilInputRHS{},
					},
					{
						Sigil: ast.SigilEgress,
						Name:  "decision",
						Type:  ast.FieldTypeBool,
						RHS: &ast.InfixRHS{
							Op:  ast.InfixAnd,
							LHS: &ast.RefArg{Name: "income_ok"},
							RHS: &ast.RefArg{Name: "debt_ok"},
						},
					},
				},
			},
		},
		Prepare: &ast.PrepareBlock{
			Entries: []*ast.PrepareEntry{
				{
					BindingName: "income",
					Source:      &ast.FromState{Path: "applicant.income"},
				},
			},
		},
		Merge: &ast.MergeBlock{
			Entries: []*ast.MergeEntry{
				{BindingName: "decision", ToState: "decision.approved"},
			},
		},
	}

	if action.ID != "score" {
		t.Errorf("action ID = %q, want %q", action.ID, "score")
	}
	if *action.Text != text {
		t.Errorf("action Text = %q", *action.Text)
	}
	if len(action.Compute.Prog.Bindings) != 2 {
		t.Errorf("binding count = %d, want 2", len(action.Compute.Prog.Bindings))
	}
}

func TestNextRuleConstruction(t *testing.T) {
	p := ast.Pos{}
	rule := &ast.NextRule{
		Pos: p,
		Compute: &ast.NextComputeBlock{
			Condition: "go",
			Prog: &ast.ProgBlock{
				Name: "to_approve",
				Bindings: []*ast.BindingDecl{
					{
						Sigil: ast.SigilIngress,
						Name:  "decision",
						Type:  ast.FieldTypeBool,
						RHS:   &ast.SigilInputRHS{},
					},
				},
			},
		},
		Prepare: &ast.NextPrepareBlock{
			Entries: []*ast.NextPrepareEntry{
				{
					BindingName: "decision",
					Source:      &ast.FromAction{BindingName: "decision"},
				},
			},
		},
		ActionID: "approve",
	}

	if rule.ActionID != "approve" {
		t.Errorf("ActionID = %q, want %q", rule.ActionID, "approve")
	}
	src := rule.Prepare.Entries[0].Source
	if fa, ok := src.(*ast.FromAction); !ok || fa.BindingName != "decision" {
		t.Error("expected *FromAction with BindingName=decision")
	}
}

func TestArrayLiteral(t *testing.T) {
	arr := &ast.ArrayLiteral{
		Elements: []ast.Literal{
			&ast.NumberLiteral{Value: 1},
			&ast.NumberLiteral{Value: 2},
			&ast.NumberLiteral{Value: 3},
		},
	}
	if len(arr.Elements) != 3 {
		t.Errorf("element count = %d, want 3", len(arr.Elements))
	}
	if n, ok := arr.Elements[0].(*ast.NumberLiteral); !ok || n.Value != 1 {
		t.Error("first element should be NumberLiteral(1)")
	}
}

func TestStateFileDirective(t *testing.T) {
	d := &ast.StateFileDirective{Path: "../state/schema.turn"}
	var _ ast.StateSource = d
	if d.Path != "../state/schema.turn" {
		t.Errorf("Path = %q", d.Path)
	}
}

// TestInfixOpMatchesProtoEnum guards the comment-only convention that
// ast.InfixOp iota values must match the proto InfixOp enum values so that
// serialized models remain valid after the int32 → enum migration.
func TestInfixOpMatchesProtoEnum(t *testing.T) {
	cases := []struct {
		goVal ast.InfixOp
		pbVal turnoutpb.InfixOp
		name  string
	}{
		{ast.InfixAnd, turnoutpb.InfixOp_INFIX_OP_AND, "And"},
		{ast.InfixGTE, turnoutpb.InfixOp_INFIX_OP_GTE, "GTE"},
		{ast.InfixLTE, turnoutpb.InfixOp_INFIX_OP_LTE, "LTE"},
		{ast.InfixGT, turnoutpb.InfixOp_INFIX_OP_GT, "GT"},
		{ast.InfixLT, turnoutpb.InfixOp_INFIX_OP_LT, "LT"},
		{ast.InfixBoolOr, turnoutpb.InfixOp_INFIX_OP_BOOL_OR, "BoolOr"},
		{ast.InfixEq, turnoutpb.InfixOp_INFIX_OP_EQ, "Eq"},
		{ast.InfixNeq, turnoutpb.InfixOp_INFIX_OP_NEQ, "Neq"},
		{ast.InfixPlus, turnoutpb.InfixOp_INFIX_OP_PLUS, "Plus"},
		{ast.InfixSub, turnoutpb.InfixOp_INFIX_OP_SUB, "Sub"},
		{ast.InfixMul, turnoutpb.InfixOp_INFIX_OP_MUL, "Mul"},
		{ast.InfixDiv, turnoutpb.InfixOp_INFIX_OP_DIV, "Div"},
		{ast.InfixMod, turnoutpb.InfixOp_INFIX_OP_MOD, "Mod"},
	}
	for _, c := range cases {
		if int32(c.goVal) != int32(c.pbVal) {
			t.Errorf("InfixOp %s: Go iota=%d != proto enum=%d",
				c.name, int32(c.goVal), int32(c.pbVal))
		}
	}
}
