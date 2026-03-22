package validate_test

import (
	"testing"

	"github.com/turnout/converter/internal/ast"
	"github.com/turnout/converter/internal/diag"
	"github.com/turnout/converter/internal/lower"
	"github.com/turnout/converter/internal/state"
	"github.com/turnout/converter/internal/validate"
)

func TestValidateIrregularRouteModels(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		model    *lower.Model
		wantCode string
	}{
		{
			name: "duplicate_fallback",
			model: irregularModelWithRoutes([]*lower.HCLRouteBlock{
				{
					ID: "main",
					Arms: []*lower.HCLMatchArm{
						{Patterns: []string{"_"}, Target: "s"},
						{Patterns: []string{"_"}, Target: "s"},
					},
				},
			}),
			wantCode: diag.CodeDuplicateFallback,
		},
		{
			name: "multiple_wildcards",
			model: irregularModelWithRoutes([]*lower.HCLRouteBlock{
				{
					ID: "main",
					Arms: []*lower.HCLMatchArm{
						{Patterns: []string{"s.*.*.done"}, Target: "s"},
					},
				},
			}),
			wantCode: diag.CodeMultipleWildcards,
		},
		{
			name: "unresolved_scene",
			model: irregularModelWithRoutes([]*lower.HCLRouteBlock{
				{
					ID: "main",
					Arms: []*lower.HCLMatchArm{
						{Patterns: []string{"s.start"}, Target: "missing"},
					},
				},
			}),
			wantCode: diag.CodeUnresolvedScene,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ds := validate.Validate(tc.model, irregularSchema())
			if !hasCode(ds, tc.wantCode) {
				t.Fatalf("missing diagnostic code %q in %v", tc.wantCode, ds)
			}
		})
	}
}

func TestValidateIrregularActionEffects(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		action   *lower.HCLAction
		wantCode string
	}{
		{
			name: "missing_prepare_entry",
			action: irregularAction(
				[]*lower.HCLBinding{
					{Name: "score", Type: ast.FieldTypeNumber, Sigil: ast.SigilIngress, Value: &ast.NumberLiteral{Value: 0}},
				},
				nil,
				nil,
				nil,
			),
			wantCode: diag.CodeMissingPrepareEntry,
		},
		{
			name: "spurious_prepare_entry_and_invalid_path",
			action: irregularAction(
				[]*lower.HCLBinding{
					{Name: "plain", Type: ast.FieldTypeNumber, Value: &ast.NumberLiteral{Value: 0}},
				},
				&lower.HCLPrepare{Entries: []*lower.HCLPrepareEntry{
					{BindingName: "plain", FromState: "bad"},
				}},
				nil,
				nil,
			),
			wantCode: diag.CodeSpuriousPrepareEntry,
		},
		{
			name: "state_type_mismatch",
			action: irregularAction(
				[]*lower.HCLBinding{
					{Name: "flag", Type: ast.FieldTypeBool, Sigil: ast.SigilEgress, Value: &ast.BoolLiteral{Value: true}},
				},
				nil,
				&lower.HCLMerge{Entries: []*lower.HCLMergeEntry{
					{BindingName: "flag", ToState: "app.score"},
				}},
				nil,
			),
			wantCode: diag.CodeStateTypeMismatch,
		},
		{
			name: "unresolved_merge_binding",
			action: irregularAction(
				nil,
				nil,
				&lower.HCLMerge{Entries: []*lower.HCLMergeEntry{
					{BindingName: "ghost", ToState: "app.score"},
				}},
				nil,
			),
			wantCode: diag.CodeUnresolvedMergeBinding,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			model := irregularModelWithAction(tc.action)
			ds := validate.Validate(model, irregularSchema())
			if !hasCode(ds, tc.wantCode) {
				t.Fatalf("missing diagnostic code %q in %v", tc.wantCode, ds)
			}
			if tc.name == "spurious_prepare_entry_and_invalid_path" && !hasCode(ds, diag.CodeInvalidStatePath) {
				t.Fatalf("missing diagnostic code %q in %v", diag.CodeInvalidStatePath, ds)
			}
		})
	}
}

func TestValidateIrregularNextRules(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		next     []*lower.HCLNextRule
		wantCode string
	}{
		{
			name: "transition_prepare_with_zero_sources",
			next: []*lower.HCLNextRule{
				{
					Action: "a",
					Prepare: &lower.HCLNextPrepare{Entries: []*lower.HCLNextPrepareEntry{
						{BindingName: "score"},
					}},
				},
			},
			wantCode: diag.CodeInvalidTransitionIngress,
		},
		{
			name: "transition_prepare_with_multiple_sources",
			next: []*lower.HCLNextRule{
				{
					Action: "a",
					Prepare: &lower.HCLNextPrepare{Entries: []*lower.HCLNextPrepareEntry{
						{BindingName: "score", FromAction: "score", FromState: "app.score"},
					}},
				},
			},
			wantCode: diag.CodeInvalidTransitionIngress,
		},
		{
			name: "condition_wrong_type",
			next: []*lower.HCLNextRule{
				{
					Action: "a",
					Compute: &lower.HCLNextCompute{
						Condition: "score",
						Prog: &lower.HCLProg{
							Name: "n",
							Bindings: []*lower.HCLBinding{
								{Name: "score", Type: ast.FieldTypeNumber, Value: &ast.NumberLiteral{Value: 1}},
							},
						},
					},
				},
			},
			wantCode: diag.CodeSCNNextComputeNotBool,
		},
		{
			name: "transition_output_sigil",
			next: []*lower.HCLNextRule{
				{
					Action: "a",
					Compute: &lower.HCLNextCompute{
						Condition: "go",
						Prog: &lower.HCLProg{
							Name: "n",
							Bindings: []*lower.HCLBinding{
								{Name: "out", Type: ast.FieldTypeNumber, Sigil: ast.SigilEgress, Value: &ast.NumberLiteral{Value: 1}},
								{Name: "go", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
							},
						},
					},
				},
			},
			wantCode: diag.CodeTransitionOutputSigil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			model := irregularModelWithAction(irregularAction(nil, nil, nil, tc.next))
			ds := validate.Validate(model, irregularSchema())
			if !hasCode(ds, tc.wantCode) {
				t.Fatalf("missing diagnostic code %q in %v", tc.wantCode, ds)
			}
		})
	}
}

func irregularSchema() state.Schema {
	return state.Schema{
		"app.score": {Type: ast.FieldTypeNumber, DefaultValue: &ast.NumberLiteral{Value: 0}},
		"app.flag":  {Type: ast.FieldTypeBool, DefaultValue: &ast.BoolLiteral{Value: false}},
		"app.label": {Type: ast.FieldTypeStr, DefaultValue: &ast.StringLiteral{Value: ""}},
	}
}

func irregularModelWithRoutes(routes []*lower.HCLRouteBlock) *lower.Model {
	return &lower.Model{
		State: &lower.HCLStateBlock{},
		Scene: &lower.HCLSceneBlock{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				irregularAction(nil, nil, nil, nil),
			},
		},
		Routes: routes,
	}
}

func irregularModelWithAction(action *lower.HCLAction) *lower.Model {
	return &lower.Model{
		State: &lower.HCLStateBlock{},
		Scene: &lower.HCLSceneBlock{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions:      []*lower.HCLAction{action},
		},
	}
}

func irregularAction(bindings []*lower.HCLBinding, prepare *lower.HCLPrepare, merge *lower.HCLMerge, next []*lower.HCLNextRule) *lower.HCLAction {
	progBindings := []*lower.HCLBinding{
		{Name: "ready", Type: ast.FieldTypeBool, Value: &ast.BoolLiteral{Value: true}},
	}
	progBindings = append(progBindings, bindings...)

	return &lower.HCLAction{
		ID: "a",
		Compute: &lower.HCLCompute{
			Root: "ready",
			Prog: &lower.HCLProg{
				Name:     "p",
				Bindings: progBindings,
			},
		},
		Prepare: prepare,
		Merge:   merge,
		Next:    next,
	}
}
