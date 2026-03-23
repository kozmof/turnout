package ast_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
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
	_ ast.BindingRHS = (*ast.PlaceholderRHS)(nil)
	_ ast.BindingRHS = (*ast.SingleRefRHS)(nil)
	_ ast.BindingRHS = (*ast.FuncCallRHS)(nil)
	_ ast.BindingRHS = (*ast.InfixRHS)(nil)
	_ ast.BindingRHS = (*ast.PipeRHS)(nil)
	_ ast.BindingRHS = (*ast.CondRHS)(nil)
	_ ast.BindingRHS = (*ast.IfRHS)(nil)

	// Arg
	_ ast.Arg = (*ast.RefArg)(nil)
	_ ast.Arg = (*ast.LitArg)(nil)
	_ ast.Arg = (*ast.FuncRefArg)(nil)
	_ ast.Arg = (*ast.StepRefArg)(nil)
	_ ast.Arg = (*ast.TransformArg)(nil)

	// CondExpr
	_ ast.CondExpr = (*ast.CondExprRef)(nil)
	_ ast.CondExpr = (*ast.CondExprCall)(nil)

	// PrepareSource — FromState, FromHook, FromLiteral
	_ ast.PrepareSource = (*ast.FromState)(nil)
	_ ast.PrepareSource = (*ast.FromHook)(nil)
	_ ast.PrepareSource = (*ast.FromLiteral)(nil)

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
	for i, s := range valid {
		ft, ok := ast.FieldTypeFromString(s)
		if !ok {
			t.Errorf("FieldTypeFromString(%q) returned false", s)
		}
		if int(ft) != i {
			t.Errorf("FieldTypeFromString(%q) = %d, want %d", s, int(ft), i)
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

func TestInfixOpFnAlias(t *testing.T) {
	cases := []struct {
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
		{ast.InfixPlus, ""},  // type-dispatched; lowerer resolves to "add" or "str_concat"
		{ast.InfixSub, "sub"},
		{ast.InfixMul, "mul"},
		{ast.InfixDiv, "div"},
		{ast.InfixMod, "mod"},
	}
	for _, tc := range cases {
		if got := tc.op.FnAlias(); got != tc.want {
			t.Errorf("InfixOp(%d).FnAlias() = %q, want %q", int(tc.op), got, tc.want)
		}
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
	// FromState should satisfy both PrepareSource and NextPrepareSource
	fs := &ast.FromState{Path: "applicant.income"}
	var _ ast.PrepareSource = fs
	var _ ast.NextPrepareSource = fs
	if fs.Path != "applicant.income" {
		t.Errorf("FromState.Path = %q, want %q", fs.Path, "applicant.income")
	}
}

func TestFromLiteralDualInterface(t *testing.T) {
	fl := &ast.FromLiteral{Value: &ast.NumberLiteral{Value: 42}}
	var _ ast.PrepareSource = fl
	var _ ast.NextPrepareSource = fl
}

func TestFromHookPrepareSoureOnly(t *testing.T) {
	// FromHook must satisfy PrepareSource
	var _ ast.PrepareSource = (*ast.FromHook)(nil)
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
						RHS:   &ast.PlaceholderRHS{},
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

func TestPipeRHSConstruction(t *testing.T) {
	rhs := &ast.PipeRHS{
		Params: []ast.PipeParam{
			{ParamName: "x", SourceIdent: "v1"},
			{ParamName: "y", SourceIdent: "v2"},
		},
		Steps: []ast.PipeStep{
			{FnAlias: "add", Args: []ast.Arg{
				&ast.RefArg{Name: "x"},
				&ast.RefArg{Name: "y"},
			}},
			{FnAlias: "mul", Args: []ast.Arg{
				&ast.StepRefArg{Index: 0},
				&ast.RefArg{Name: "x"},
			}},
		},
	}

	if len(rhs.Params) != 2 {
		t.Errorf("param count = %d, want 2", len(rhs.Params))
	}
	if len(rhs.Steps) != 2 {
		t.Errorf("step count = %d, want 2", len(rhs.Steps))
	}
	if _, ok := rhs.Steps[1].Args[0].(*ast.StepRefArg); !ok {
		t.Error("first arg of step 1 should be *StepRefArg")
	}
}

func TestCondRHSAndIfRHS(t *testing.T) {
	condRHS := &ast.CondRHS{
		Condition: &ast.CondExprRef{BindingName: "flag"},
		Then:      "addFn",
		Else:      "subFn",
	}
	if _, ok := condRHS.Condition.(*ast.CondExprRef); !ok {
		t.Error("CondRHS.Condition should be *CondExprRef")
	}

	ifRHS := &ast.IfRHS{
		Cond: &ast.CondExprCall{
			FnAlias: "gt",
			Args:    []ast.Arg{&ast.RefArg{Name: "v1"}, &ast.RefArg{Name: "v2"}},
		},
		Then: "addFn",
		Else: "subFn",
	}
	if _, ok := ifRHS.Cond.(*ast.CondExprCall); !ok {
		t.Error("IfRHS.Cond should be *CondExprCall")
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
						RHS:   &ast.PlaceholderRHS{},
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
