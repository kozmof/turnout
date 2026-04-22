package emit_test

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
)

// pipelineModel runs parse→state→lower→validate and returns the lowered model.
func pipelineModel(t *testing.T, src string) *lower.Model {
	t.Helper()
	tf, ds := parser.ParseFile("test.turn", src)
	if ds.HasErrors() {
		t.Fatalf("parse: %v", ds)
	}
	schema, ds2 := state.Resolve(tf.StateSource, "")
	if ds2.HasErrors() {
		t.Fatalf("state: %v", ds2)
	}
	model, ds3 := lower.Lower(tf, schema)
	if ds3.HasErrors() {
		t.Fatalf("lower: %v", ds3)
	}
	if ds4 := validate.Validate(model, schema); ds4.HasErrors() {
		t.Fatalf("validate: %v", ds4)
	}
	return model
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
	model := &lower.Model{
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "result",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								{
									Name: "result",
									Type: ast.FieldTypeNumber,
									Expr: &lower.HCLExpr{
										Combine: &lower.HCLCombine{
											Fn: "add",
											Args: []*lower.HCLArg{
												{Transform: &lower.HCLTransform{Ref: "x", Fn: []string{"myTransform"}}},
												{Lit: &ast.NumberLiteral{Value: 0}},
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
	// Also covers lit branch (NumberLiteral 0 as second arg)
	if !strings.Contains(out, `lit = 0`) {
		t.Errorf("missing lit arg in output:\n%s", out)
	}
}

func TestEmitArgStepRef(t *testing.T) {
	model := &lower.Model{
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "result",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								{
									Name: "result",
									Type: ast.FieldTypeNumber,
									Expr: &lower.HCLExpr{
										Pipe: &lower.HCLPipe{
											Params: []*lower.HCLPipeParam{{ParamName: "a", SourceIdent: "x"}},
											Steps: []*lower.HCLPipeStep{
												{Fn: "add", Args: []*lower.HCLArg{{Ref: "a"}, {Ref: "a"}}},
												{Fn: "add", Args: []*lower.HCLArg{
													{IsStepRef: true, StepRef: 0},
													{Lit: &ast.NumberLiteral{Value: 1}},
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
          ~>score:number = _
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
          ~>val:number = _
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
	src := `state { ns { v:number = 0 } }
scene "s" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        x:number      = 3
        y:number      = 4
        result:number = #pipe(a:x, b:y)[add(a, b)]
      }
    }
  }
}`
	var sb strings.Builder
	if err := emit.EmitJSON(&sb, pipelineModel(t, src)); err != nil {
		t.Fatalf("EmitJSON: %v", err)
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
	src := `state { ns { v:number = 0 } }
scene "s" {
  entry_actions = ["a"]
  action "a" {
    compute {
      root = result
      prog "p" {
        flag:bool     = true
        thenFn:number = add(x, x)
        x:number      = 1
        result:number = {
          cond = {
            condition = flag
            then      = thenFn
            else      = thenFn
          }
        }
      }
    }
  }
}`
	var sb strings.Builder
	if err := emit.EmitJSON(&sb, pipelineModel(t, src)); err != nil {
		t.Fatalf("EmitJSON: %v", err)
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
  match {
    scene_1.*.final => scene_1,
    _ => scene_1
  }
}`
	var sb strings.Builder
	if err := emit.EmitJSON(&sb, pipelineModel(t, src)); err != nil {
		t.Fatalf("EmitJSON: %v", err)
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
	if err := emit.EmitJSON(&sb, pipelineModel(t, src)); err != nil {
		t.Fatalf("EmitJSON: %v", err)
	}
	out := sb.String()
	if !strings.Contains(out, `"a"`) || !strings.Contains(out, `"b"`) {
		t.Errorf("missing array elements in JSON:\n%s", out)
	}
}

func TestEmitJSONArgStepRefAndLit(t *testing.T) {
	stepRef := 0
	model := &lower.Model{
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "result",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								{
									Name: "result",
									Type: ast.FieldTypeNumber,
									Expr: &lower.HCLExpr{
										Pipe: &lower.HCLPipe{
											Params: []*lower.HCLPipeParam{{ParamName: "a", SourceIdent: "x"}},
											Steps: []*lower.HCLPipeStep{
												{Fn: "add", Args: []*lower.HCLArg{{Ref: "a"}, {Ref: "a"}}},
												{Fn: "add", Args: []*lower.HCLArg{
													{IsStepRef: true, StepRef: stepRef},
													{Lit: &ast.NumberLiteral{Value: 5}},
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
	if err := emit.EmitJSON(&sb, model); err != nil {
		t.Fatalf("EmitJSON: %v", err)
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
	model := &lower.Model{
		Scenes: []*lower.HCLSceneBlock{{
			ID:           "s",
			EntryActions: []string{"a"},
			Actions: []*lower.HCLAction{
				{
					ID: "a",
					Compute: &lower.HCLCompute{
						Root: "result",
						Prog: &lower.HCLProg{
							Name: "p",
							Bindings: []*lower.HCLBinding{
								{
									Name: "result",
									Type: ast.FieldTypeNumber,
									Expr: &lower.HCLExpr{
										Combine: &lower.HCLCombine{
											Fn: "add",
											Args: []*lower.HCLArg{
												{Transform: &lower.HCLTransform{Ref: "v", Fn: []string{"myFn"}}},
												{Lit: &ast.NumberLiteral{Value: 0}},
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
	if err := emit.EmitJSON(&sb, model); err != nil {
		t.Fatalf("EmitJSON: %v", err)
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
	if err := emit.EmitJSON(&sb, nil); err != nil {
		t.Fatalf("EmitJSON(nil): %v", err)
	}
	out := sb.String()
	if strings.TrimSpace(out) == "" {
		t.Errorf("nil model JSON should not be empty")
	}
}
