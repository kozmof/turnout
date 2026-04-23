package validate_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestValidateIrregularRouteModels(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		model    *turnoutpb.TurnModel
		wantCode string
	}{
		{
			name: "duplicate_fallback",
			model: irregularModelWithRoutes([]*turnoutpb.RouteModel{
				{
					Id: "main",
					Match: []*turnoutpb.MatchArm{
						{Patterns: []string{"_"}, Target: "s"},
						{Patterns: []string{"_"}, Target: "s"},
					},
				},
			}),
			wantCode: diag.CodeDuplicateFallback,
		},
		{
			name: "multiple_wildcards",
			model: irregularModelWithRoutes([]*turnoutpb.RouteModel{
				{
					Id: "main",
					Match: []*turnoutpb.MatchArm{
						{Patterns: []string{"s.*.*.done"}, Target: "s"},
					},
				},
			}),
			wantCode: diag.CodeMultipleWildcards,
		},
		{
			name: "unresolved_scene",
			model: irregularModelWithRoutes([]*turnoutpb.RouteModel{
				{
					Id: "main",
					Match: []*turnoutpb.MatchArm{
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

			ds := validate.Validate(tc.model, nil, irregularSchema())
			if !hasCode(ds, tc.wantCode) {
				t.Fatalf("missing diagnostic code %q in %v", tc.wantCode, ds)
			}
		})
	}
}

func TestValidateIrregularActionEffects(t *testing.T) {
	t.Parallel()

	type irrCase struct {
		name     string
		bindings []irrBind
		prepare  []*turnoutpb.PrepareEntry
		merge    []*turnoutpb.MergeEntry
		next     []*turnoutpb.NextRuleModel
		wantCode string
		extra    string // optional extra code check
	}

	cases := []irrCase{
		{
			name: "missing_prepare_entry",
			bindings: []irrBind{
				{name: "score", ft: ast.FieldTypeNumber, sigil: ast.SigilIngress, val: structpb.NewNumberValue(0)},
			},
			wantCode: diag.CodeMissingPrepareEntry,
		},
		{
			name: "spurious_prepare_entry_and_invalid_path",
			bindings: []irrBind{
				{name: "plain", ft: ast.FieldTypeNumber, val: structpb.NewNumberValue(0)},
			},
			prepare: []*turnoutpb.PrepareEntry{
				{Binding: "plain", FromState: proto.String("bad")},
			},
			wantCode: diag.CodeSpuriousPrepareEntry,
			extra:    diag.CodeInvalidStatePath,
		},
		{
			name: "state_type_mismatch",
			bindings: []irrBind{
				{name: "flag", ft: ast.FieldTypeBool, sigil: ast.SigilEgress, val: structpb.NewBoolValue(true)},
			},
			merge: []*turnoutpb.MergeEntry{
				{Binding: "flag", ToState: "app.score"},
			},
			wantCode: diag.CodeStateTypeMismatch,
		},
		{
			name:  "unresolved_merge_binding",
			merge: []*turnoutpb.MergeEntry{{Binding: "ghost", ToState: "app.score"}},
			wantCode: diag.CodeUnresolvedMergeBinding,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			action, sc := buildIrregularAction(tc.bindings, tc.prepare, tc.merge, tc.next)
			model := irregularModelWithAction(action)
			ds := validate.Validate(model, sc, irregularSchema())
			if !hasCode(ds, tc.wantCode) {
				t.Fatalf("missing diagnostic code %q in %v", tc.wantCode, ds)
			}
			if tc.extra != "" && !hasCode(ds, tc.extra) {
				t.Fatalf("missing diagnostic code %q in %v", tc.extra, ds)
			}
		})
	}
}

func TestValidateIrregularNextRules(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		next     []*turnoutpb.NextRuleModel
		wantCode string
	}{
		{
			name: "transition_prepare_with_zero_sources",
			next: []*turnoutpb.NextRuleModel{
				{
					Action: "a",
					Prepare: []*turnoutpb.NextPrepareEntry{
						{Binding: "score"}, // count=0: no FromAction/FromState/FromLiteral
					},
				},
			},
			wantCode: diag.CodeInvalidTransitionIngress,
		},
		{
			name: "transition_prepare_with_multiple_sources",
			next: []*turnoutpb.NextRuleModel{
				{
					Action: "a",
					Prepare: []*turnoutpb.NextPrepareEntry{
						{Binding: "score", FromAction: proto.String("score"), FromState: proto.String("app.score")},
					},
				},
			},
			wantCode: diag.CodeInvalidTransitionIngress,
		},
		{
			name: "condition_wrong_type",
			next: []*turnoutpb.NextRuleModel{
				{
					Action: "a",
					Compute: &turnoutpb.NextComputeModel{
						Condition: "score",
						Prog: &turnoutpb.ProgModel{
							Name: "n",
							Bindings: []*turnoutpb.BindingModel{
								{Name: "score", Type: "number", Value: structpb.NewNumberValue(1)},
							},
						},
					},
				},
			},
			wantCode: diag.CodeSCNNextComputeNotBool,
		},
		{
			name: "transition_output_sigil",
			next: []*turnoutpb.NextRuleModel{
				{
					Action: "a",
					Compute: &turnoutpb.NextComputeModel{
						Condition: "go",
						Prog: &turnoutpb.ProgModel{
							Name: "n",
							Bindings: []*turnoutpb.BindingModel{
								{Name: "out", Type: "number", Value: structpb.NewNumberValue(1)},
								{Name: "go", Type: "bool", Value: structpb.NewBoolValue(true)},
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

			// "transition_output_sigil" needs a sigil on binding "out" in next prog
			var sc *lower.Sidecar
			if tc.name == "transition_output_sigil" {
				sc = &lower.Sidecar{
					Sigils:  make(map[lower.BindingKey]ast.Sigil),
					Actions: make(map[string]lower.ActionMeta),
					Scenes:  make(map[string]lower.SceneMeta),
				}
				sc.Sigils[lower.BindingKey{SceneID: "s", ActionID: "a", ProgName: "n", BindingName: "out"}] = ast.SigilEgress
			}
			action, actionSC := buildIrregularAction(nil, nil, nil, tc.next)
			if sc == nil {
				sc = actionSC
			} else if actionSC != nil {
				for k, v := range actionSC.Sigils {
					sc.Sigils[k] = v
				}
			}
			model := irregularModelWithAction(action)
			ds := validate.Validate(model, sc, irregularSchema())
			if !hasCode(ds, tc.wantCode) {
				t.Fatalf("missing diagnostic code %q in %v", tc.wantCode, ds)
			}
		})
	}
}

func irregularSchema() state.Schema {
	return state.Schema{
		"app.score": {Type: ast.FieldTypeNumber, DefaultValue: nil},
		"app.flag":  {Type: ast.FieldTypeBool, DefaultValue: nil},
		"app.label": {Type: ast.FieldTypeStr, DefaultValue: nil},
	}
}

func irregularModelWithRoutes(routes []*turnoutpb.RouteModel) *turnoutpb.TurnModel {
	action, _ := buildIrregularAction(nil, nil, nil, nil)
	return &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions:      []*turnoutpb.ActionModel{action},
		}},
		Routes: routes,
	}
}

func irregularModelWithAction(action *turnoutpb.ActionModel) *turnoutpb.TurnModel {
	return &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions:      []*turnoutpb.ActionModel{action},
		}},
	}
}

type irrBind struct {
	name  string
	ft    ast.FieldType
	sigil ast.Sigil
	val   *structpb.Value
	expr  *turnoutpb.ExprModel
}

// buildIrregularAction constructs an ActionModel with a "ready:bool = true" base binding
// plus any additional bindings. Returns the action and a sidecar with any sigils.
func buildIrregularAction(bindings []irrBind, prepare []*turnoutpb.PrepareEntry, merge []*turnoutpb.MergeEntry, next []*turnoutpb.NextRuleModel) (*turnoutpb.ActionModel, *lower.Sidecar) {
	sc := &lower.Sidecar{
		Sigils:  make(map[lower.BindingKey]ast.Sigil),
		Actions: make(map[string]lower.ActionMeta),
		Scenes:  make(map[string]lower.SceneMeta),
	}

	progBindings := []*turnoutpb.BindingModel{
		{Name: "ready", Type: "bool", Value: structpb.NewBoolValue(true)},
	}
	for _, ib := range bindings {
		bm := &turnoutpb.BindingModel{Name: ib.name, Type: ib.ft.String()}
		if ib.val != nil {
			bm.Value = ib.val
		} else {
			bm.Expr = ib.expr
		}
		progBindings = append(progBindings, bm)
		if ib.sigil != ast.SigilNone {
			sc.Sigils[lower.BindingKey{SceneID: "s", ActionID: "a", ProgName: "p", BindingName: ib.name}] = ib.sigil
		}
	}

	return &turnoutpb.ActionModel{
		Id: "a",
		Compute: &turnoutpb.ComputeModel{
			Root: "ready",
			Prog: &turnoutpb.ProgModel{
				Name:     "p",
				Bindings: progBindings,
			},
		},
		Prepare: prepare,
		Merge:   merge,
		Next:    next,
	}, sc
}
