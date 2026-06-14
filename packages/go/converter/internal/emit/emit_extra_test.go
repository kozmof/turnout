package emit_test

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// pipelineModel runs parse→state→lower→validate and returns the lowered model.
func pipelineModel(t *testing.T, src string) *turnoutpb.TurnModel {
	t.Helper()
	tf, ds := parser.ParseFile("test.turn", src)
	if ds.HasErrors() {
		t.Fatalf("parse: %v", ds)
	}
	lr, ds2 := lower.LowerResolvingState(tf, "")
	if ds2.HasErrors() {
		t.Fatalf("lower: %v", ds2)
	}
	if ds4 := validate.Validate(validate.ValidateInput{Model: lr.Model, Schema: lr.Schema}); ds4.HasErrors() {
		t.Fatalf("validate: %v", ds4)
	}
	return lr.Model
}

// ─── writeLiteral: non-empty array and bool false ─────────────────────────────

func TestEmitLiteralNonEmptyArray(t *testing.T) {
	out := fullPipeline(t, `state {
  ns { items:arr<number> = [1, 2, 3] }
}
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}`)
	if !strings.Contains(out, `value = [1, 2, 3]`) {
		t.Errorf("missing non-empty array literal in output:\n%s", out)
	}
}

func TestEmitLiteralBoolFalse(t *testing.T) {
	out := fullPipeline(t, `state {
  ns { flag:bool = false }
}
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}`)
	if !strings.Contains(out, `value = false`) {
		t.Errorf("missing bool false literal in output:\n%s", out)
	}
}

// ─── writeArg: transform, step_ref, lit branches ─────────────────────────────

func TestEmitArgTransform(t *testing.T) {
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
												{Transform: &turnoutpb.TransformArg{Ref: "x", Fn: []string{"myTransform"}}},
												{Lit: structpb.NewNumberValue(0)},
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
	out := emitModel(model)
	if !strings.Contains(out, `transform = { ref = "x"`) {
		t.Errorf("missing transform arg in output:\n%s", out)
	}
	if !strings.Contains(out, `fn = ["myTransform"]`) {
		t.Errorf("missing transform fn in output:\n%s", out)
	}
	// Also covers lit branch (NumberValue 0 as second arg)
	if !strings.Contains(out, `lit = 0`) {
		t.Errorf("missing lit arg in output:\n%s", out)
	}
}

func TestEmitArgStepRef(t *testing.T) {
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
										Pipe: &turnoutpb.PipeExpr{
											Params: []*turnoutpb.PipeParam{{ParamName: "a", SourceIdent: "x"}},
											Steps: []*turnoutpb.PipeStep{
												{Fn: "add", Args: []*turnoutpb.ArgModel{{Ref: proto.String("a")}, {Ref: proto.String("a")}}},
												{Fn: "add", Args: []*turnoutpb.ArgModel{
													{StepRef: proto.Int32(0)},
													{Lit: structpb.NewNumberValue(1)},
												}},
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
	out := emitModel(model)
	if !strings.Contains(out, `step_ref = 0`) {
		t.Errorf("missing step_ref in output:\n%s", out)
	}
}

// ─── writeNextPrepare: from_state and from_literal branches ──────────────────

func TestEmitNextPrepareFromState(t *testing.T) {
	out := fullPipeline(t, `state {
  app { score:number = 10 }
}
scene "s" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
    next {
      compute {
        condition = go
        prog "n" {
          ~>score:number
          go:bool = true
        }
      }
      prepare {
        score { from_state = app.score }
      }
      action = a
    }
  }
}`)
	if !strings.Contains(out, `from_state   = "app.score"`) {
		t.Errorf("missing from_state in next prepare output:\n%s", out)
	}
}

func TestEmitNextPrepareFromLiteral(t *testing.T) {
	out := fullPipeline(t, `state {
  app { val:number = 0 }
}
scene "s" {
  entry_actions = ["a"]
  action "a" {
    compute { root = r prog "p" { r:bool = true } }
    next {
      compute {
        condition = go
        prog "n" {
          ~>val:number
          go:bool = true
        }
      }
      prepare {
        val { from_literal = 42 }
      }
      action = a
    }
  }
}`)
	if !strings.Contains(out, `from_literal = 42`) {
		t.Errorf("missing from_literal in next prepare output:\n%s", out)
	}
}

// ─── JSON: pipe, cond, route, litToJSON array, argToJSON branches ─────────────

func TestEmitJSONPipeExpr(t *testing.T) {
	// Construct proto model directly to test that PipeExpr serializes to JSON.
	model := &turnoutpb.TurnModel{
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{{
				Id: "a",
				Compute: &turnoutpb.ComputeModel{
					Root: "result",
					Prog: &turnoutpb.ProgModel{
						Name: "p",
						Bindings: []*turnoutpb.BindingModel{
							{Name: "x", Type: "number", Value: structpb.NewNumberValue(3)},
							{Name: "y", Type: "number", Value: structpb.NewNumberValue(4)},
							{Name: "result", Type: "number", Expr: &turnoutpb.ExprModel{
								Pipe: &turnoutpb.PipeExpr{
									Params: []*turnoutpb.PipeParam{
										{ParamName: "a", SourceIdent: "x"},
										{ParamName: "b", SourceIdent: "y"},
									},
									Steps: []*turnoutpb.PipeStep{{
										Fn: "add",
										Args: []*turnoutpb.ArgModel{
											{Ref: proto.String("a")},
											{Ref: proto.String("b")},
										},
									}},
								},
							}},
						},
					},
				},
			}},
		}},
	}
	var sb strings.Builder
	if ds := emit.EmitJSON(&sb, model); ds.HasErrors() {
		t.Fatalf("EmitJSON: %v", ds)
	}
	out := sb.String()
	if !strings.Contains(out, `"pipe"`) {
		t.Errorf("missing pipe in JSON:\n%s", out)
	}
	if !strings.Contains(out, `"params"`) {
		t.Errorf("missing params in JSON:\n%s", out)
	}
	if !strings.Contains(out, `"steps"`) {
		t.Errorf("missing steps in JSON:\n%s", out)
	}
}

func TestEmitJSONCondExpr(t *testing.T) {
	// Construct proto model directly to test that CondExpr serializes to JSON.
	model := &turnoutpb.TurnModel{
		Scenes: []*turnoutpb.SceneBlock{{
			Id:           "s",
			EntryActions: []string{"a"},
			Actions: []*turnoutpb.ActionModel{{
				Id: "a",
				Compute: &turnoutpb.ComputeModel{
					Root: "result",
					Prog: &turnoutpb.ProgModel{
						Name: "p",
						Bindings: []*turnoutpb.BindingModel{
							{Name: "flag", Type: "bool", Value: structpb.NewBoolValue(true)},
							{Name: "thenFn", Type: "number", Expr: &turnoutpb.ExprModel{
								Combine: &turnoutpb.CombineExpr{
									Fn: "add",
									Args: []*turnoutpb.ArgModel{
										{Ref: proto.String("flag")},
										{Ref: proto.String("flag")},
									},
								},
							}},
							{Name: "result", Type: "number", Expr: &turnoutpb.ExprModel{
								Cond: &turnoutpb.CondExpr{
									Condition:  &turnoutpb.ArgModel{Ref: proto.String("flag")},
									Then:       &turnoutpb.ArgModel{FuncRef: proto.String("thenFn")},
									ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String("thenFn")},
								},
							}},
						},
					},
				},
			}},
		}},
	}
	var sb strings.Builder
	if ds := emit.EmitJSON(&sb, model); ds.HasErrors() {
		t.Fatalf("EmitJSON: %v", ds)
	}
	out := sb.String()
	if !strings.Contains(out, `"cond"`) {
		t.Errorf("missing cond in JSON:\n%s", out)
	}
	if !strings.Contains(out, `"funcRef"`) {
		t.Errorf("missing func_ref in JSON:\n%s", out)
	}
}

func TestEmitJSONRoute(t *testing.T) {
	src := `state { ns { v:number = 0 } }
scene "scene_1" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}
route "r1" {
  entry "scene_1"
  match {
    scene_1.*.final => scene_1,
    _ => scene_1
  }
}`
	var sb strings.Builder
	if ds := emit.EmitJSON(&sb, pipelineModel(t, src)); ds.HasErrors() {
		t.Fatalf("EmitJSON: %v", ds)
	}
	out := sb.String()
	if !strings.Contains(out, `"routes"`) {
		t.Errorf("missing routes in JSON:\n%s", out)
	}
	if !strings.Contains(out, `"r1"`) {
		t.Errorf("missing route id in JSON:\n%s", out)
	}
	if !strings.Contains(out, `"match"`) {
		t.Errorf("missing match in JSON:\n%s", out)
	}
}

func TestEmitJSONLitToJSONArray(t *testing.T) {
	src := `state {
  ns { tags:arr<str> = ["a", "b"] }
}
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}`
	var sb strings.Builder
	if ds := emit.EmitJSON(&sb, pipelineModel(t, src)); ds.HasErrors() {
		t.Fatalf("EmitJSON: %v", ds)
	}
	out := sb.String()
	if !strings.Contains(out, `"a"`) || !strings.Contains(out, `"b"`) {
		t.Errorf("missing array elements in JSON:\n%s", out)
	}
}

func TestEmitJSONArgStepRefAndLit(t *testing.T) {
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
										Pipe: &turnoutpb.PipeExpr{
											Params: []*turnoutpb.PipeParam{{ParamName: "a", SourceIdent: "x"}},
											Steps: []*turnoutpb.PipeStep{
												{Fn: "add", Args: []*turnoutpb.ArgModel{{Ref: proto.String("a")}, {Ref: proto.String("a")}}},
												{Fn: "add", Args: []*turnoutpb.ArgModel{
													{StepRef: proto.Int32(0)},
													{Lit: structpb.NewNumberValue(5)},
												}},
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
	var sb strings.Builder
	if ds := emit.EmitJSON(&sb, model); ds.HasErrors() {
		t.Fatalf("EmitJSON: %v", ds)
	}
	out := sb.String()
	if !strings.Contains(out, `"stepRef"`) {
		t.Errorf("missing step_ref in JSON:\n%s", out)
	}
	if !strings.Contains(out, `"lit"`) {
		t.Errorf("missing lit in JSON:\n%s", out)
	}
}

func TestEmitJSONArgTransform(t *testing.T) {
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
												{Transform: &turnoutpb.TransformArg{Ref: "v", Fn: []string{"myFn"}}},
												{Lit: structpb.NewNumberValue(0)},
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
	var sb strings.Builder
	if ds := emit.EmitJSON(&sb, model); ds.HasErrors() {
		t.Fatalf("EmitJSON: %v", ds)
	}
	out := sb.String()
	if !strings.Contains(out, `"transform"`) {
		t.Errorf("missing transform in JSON:\n%s", out)
	}
	if !strings.Contains(out, `"myFn"`) {
		t.Errorf("missing transform fn in JSON:\n%s", out)
	}
}

func TestEmitJSONNilModel(t *testing.T) {
	var sb strings.Builder
	if ds := emit.EmitJSON(&sb, nil); ds.HasErrors() {
		t.Fatalf("EmitJSON(nil): %v", ds)
	}
	out := sb.String()
	if strings.TrimSpace(out) == "" {
		t.Errorf("nil model JSON should not be empty")
	}
}

// ─── chooseHeredocDelim: hash-fallback path ───────────────────────────────────

// ─── writeStructpbValue: number format ───────────────────────────────────────

func TestEmitLargeNumberDecimal(t *testing.T) {
	// A state field default of 1000000 must emit as "1000000" (decimal), not
	// "1e+06" (scientific notation). The Turn DSL lexer does not accept 'e'.
	out := fullPipeline(t, `state {
  ns { big:number = 1000000 }
}
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}`)
	if strings.Contains(out, "1e+") || strings.Contains(out, "e+0") {
		t.Errorf("number value must not use scientific notation, got output containing 'e+': %s", out)
	}
	if !strings.Contains(out, "1000000") {
		t.Errorf("expected decimal 1000000 in output:\n%s", out)
	}
}

func TestEmitSmallNumberDecimal(t *testing.T) {
	// A state field default of 0.00001 must emit as "0.00001" (decimal), not
	// "1e-05". The Turn DSL lexer does not accept 'e'.
	out := fullPipeline(t, `state {
  ns { small:number = 0.00001 }
}
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}`)
	if strings.Contains(out, "1e-") || strings.Contains(out, "e-0") {
		t.Errorf("number value must not use scientific notation, got output containing 'e-': %s", out)
	}
	if !strings.Contains(out, "0.00001") {
		t.Errorf("expected decimal 0.00001 in output:\n%s", out)
	}
}

func TestChooseHeredocDelimHashFallback(t *testing.T) {
	// All four standard candidates appear as bare lines so they all collide.
	// The fast "EOT" path fires first; the slow-path candidates also collide,
	// forcing the hash fallback to produce a "TURN_EOT_xxxxxxxx" delimiter.
	text := "EOT\nTURN_EOT\nTURN_EOT_1\nTURN_EOT_2"
	delim, err := emit.ChooseHeredocDelim(text, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if delim == "" {
		t.Fatal("expected a non-empty delimiter")
	}
	for _, known := range []string{"EOT", "TURN_EOT", "TURN_EOT_1", "TURN_EOT_2"} {
		if delim == known {
			t.Errorf("hash fallback should not return known candidate %q", known)
		}
	}
	if !strings.HasPrefix(delim, "TURN_EOT_") {
		t.Errorf("hash-fallback delimiter should start with TURN_EOT_, got %q", delim)
	}
}

func TestChooseHeredocDelimEOTOnlySlowPath(t *testing.T) {
	// "EOT" appears as a bare line → fast path fails, slow path picks "TURN_EOT".
	delim, err := emit.ChooseHeredocDelim("EOT", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if delim != "TURN_EOT" {
		t.Errorf("expected TURN_EOT when only EOT collides, got %q", delim)
	}
}

