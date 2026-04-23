package emit_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestEmitIrregularPreparePrefersFromStateOverFromHook(t *testing.T) {
	t.Parallel()

	model := &turnoutpb.TurnModel{
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Prepare: []*turnoutpb.PrepareEntry{
						{Binding: "score", FromState: proto.String("app.score"), FromHook: proto.String("score_hook")},
					},
				},
			},
		}},
	}

	out := emitModel(model, nil)
	if !strings.Contains(out, `from_state = "app.score"`) {
		t.Fatalf("missing from_state in output:\n%s", out)
	}
	if strings.Contains(out, `from_hook`) {
		t.Fatalf("unexpected from_hook in output:\n%s", out)
	}
}

func TestEmitIrregularNextPreparePrefersFromActionOverOtherSources(t *testing.T) {
	t.Parallel()

	model := &turnoutpb.TurnModel{
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Next: []*turnoutpb.NextRuleModel{
						{
							Action: "a",
							Prepare: []*turnoutpb.NextPrepareEntry{
								{
									Binding:     "score",
									FromAction:  proto.String("score"),
									FromState:   proto.String("app.score"),
									FromLiteral: structpb.NewNumberValue(5),
								},
							},
						},
					},
				},
			},
		}},
	}

	out := emitModel(model, nil)
	if !strings.Contains(out, `from_action  = "score"`) {
		t.Fatalf("missing from_action in output:\n%s", out)
	}
	if strings.Contains(out, `from_state`) || strings.Contains(out, `from_literal`) {
		t.Fatalf("unexpected fallback source in output:\n%s", out)
	}
}

func TestEmitIrregularEmptyArgEmitsEmptyObject(t *testing.T) {
	t.Parallel()

	model := &turnoutpb.TurnModel{
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Compute: &turnoutpb.ComputeModel{
						Root: "result",
						Prog: &turnoutpb.ProgModel{
							Name: "p",
							Bindings: []*turnoutpb.BindingModel{
								{
									Name: "result",
									Type: "number",
									Expr: &turnoutpb.ExprModel{
										Combine: &turnoutpb.CombineExpr{
											Fn: "add",
											Args: []*turnoutpb.ArgModel{
												{},
												{Lit: structpb.NewNumberValue(1)},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		}},
	}

	out := emitModel(model, nil)
	if !strings.Contains(out, `args = [{}, { lit = 1 }]`) {
		t.Fatalf("expected empty arg object in output:\n%s", out)
	}
}

func TestEmitIrregularArrayWithNilElementEmitsNull(t *testing.T) {
	t.Parallel()

	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{
			Namespaces: []*turnoutpb.NamespaceModel{
				{
					Name: "ns",
					Fields: []*turnoutpb.FieldModel{
						{
							Name: "items",
							Type: "arr<number>",
							Value: &structpb.Value{Kind: &structpb.Value_ListValue{
								ListValue: &structpb.ListValue{
									Values: []*structpb.Value{nil, structpb.NewNumberValue(2)},
								},
							}},
						},
					},
				},
			},
		},
	}

	out := emitModel(model, nil)
	if !strings.Contains(out, `value = [null, 2]`) {
		t.Fatalf("expected null array element in output:\n%s", out)
	}
}

func TestEmitJSONIrregularSourcePrecedenceAndNulls(t *testing.T) {
	t.Parallel()

	// Each prepare entry has exactly one source set; the JSON serializes all non-nil fields.
	model := &turnoutpb.TurnModel{
		State: &turnoutpb.StateModel{
			Namespaces: []*turnoutpb.NamespaceModel{
				{
					Name: "ns",
					Fields: []*turnoutpb.FieldModel{
						{
							Name: "items",
							Type: "arr<number>",
							Value: &structpb.Value{Kind: &structpb.Value_ListValue{
								ListValue: &structpb.ListValue{
									Values: []*structpb.Value{
										{Kind: &structpb.Value_NullValue{}},
										structpb.NewNumberValue(2),
									},
								},
							}},
						},
					},
				},
			},
		},
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{
				{
					Id: "a",
					Prepare: []*turnoutpb.PrepareEntry{
						{Binding: "score", FromState: proto.String("app.score")},
					},
					Next: []*turnoutpb.NextRuleModel{
						{
							Action: "a",
							Prepare: []*turnoutpb.NextPrepareEntry{
								{Binding: "score", FromAction: proto.String("score")},
							},
						},
					},
				},
			},
		}},
	}

	var sb strings.Builder
	if err := emit.EmitJSON(&sb, model); err != nil {
		t.Fatalf("EmitJSON: %v", err)
	}
	out := sb.String()
	if !strings.Contains(out, `"fromState"`) {
		t.Fatalf("missing fromState in output:\n%s", out)
	}
	if strings.Contains(out, `"fromHook"`) {
		t.Fatalf("unexpected fromHook in output:\n%s", out)
	}
	if !strings.Contains(out, `"fromAction"`) {
		t.Fatalf("missing fromAction in output:\n%s", out)
	}
	if strings.Contains(out, `"fromLiteral"`) {
		t.Fatalf("unexpected fromLiteral in output:\n%s", out)
	}

	var decoded map[string]any
	if err := json.Unmarshal([]byte(out), &decoded); err != nil {
		t.Fatalf("json.Unmarshal: %v\njson:\n%s", err, out)
	}

	stateObj := decoded["state"].(map[string]any)
	namespaces := stateObj["namespaces"].([]any)
	fields := namespaces[0].(map[string]any)["fields"].([]any)
	value := fields[0].(map[string]any)["value"].([]any)
	if len(value) != 2 || value[0] != nil || value[1].(float64) != 2 {
		t.Fatalf("decoded state value = %#v, want [nil 2]", value)
	}

	scenes := decoded["scenes"].([]any)
	actions := scenes[0].(map[string]any)["actions"].([]any)
	action := actions[0].(map[string]any)
	prepare := action["prepare"].([]any)
	prepareEntry := prepare[0].(map[string]any)
	if _, ok := prepareEntry["fromHook"]; ok {
		t.Fatalf("unexpected fromHook in decoded prepare entry: %#v", prepareEntry)
	}
	if prepareEntry["fromState"].(string) != "app.score" {
		t.Fatalf("decoded prepare entry = %#v", prepareEntry)
	}

	nextRules := action["next"].([]any)
	nextPrepare := nextRules[0].(map[string]any)["prepare"].([]any)
	nextPrepareEntry := nextPrepare[0].(map[string]any)
	if _, ok := nextPrepareEntry["fromState"]; ok {
		t.Fatalf("unexpected fromState in decoded next prepare entry: %#v", nextPrepareEntry)
	}
	if _, ok := nextPrepareEntry["fromLiteral"]; ok {
		t.Fatalf("unexpected fromLiteral in decoded next prepare entry: %#v", nextPrepareEntry)
	}
	if nextPrepareEntry["fromAction"].(string) != "score" {
		t.Fatalf("decoded next prepare entry = %#v", nextPrepareEntry)
	}
}
