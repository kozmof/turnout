package emit_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
)

// ─── helpers ──────────────────────────────────────────────────────────────────

// fullPipeline parses src, lowers, validates, and emits. Returns the HCL string.
func fullPipeline(t *testing.T, src string) string {
	t.Helper()
	tf, ds := parser.ParseFile("test.tu", src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Logf("parse: %s", d.Format())
		}
		t.Fatalf("parse failed")
	}
	lr, ds2 := lower.LowerResolvingState(tf, "")
	if ds2.HasErrors() {
		t.Fatalf("lower failed: %v", ds2)
	}
	ds3 := validate.Validate(validate.ValidateInput{Model: lr.Model, Schema: lr.Schema})
	if ds3.HasErrors() {
		for _, d := range ds3 {
			t.Logf("validate: %s", d.Format())
		}
		t.Fatalf("validate failed")
	}
	var sb strings.Builder
	emit.Emit(&sb, lr.Model)
	return sb.String()
}

// emitModel emits a pre-built model (bypassing parse/validate).
func emitModel(tm *turnoutpb.TurnModel) string {
	var sb strings.Builder
	emit.Emit(&sb, tm)
	return sb.String()
}

// ─── type declarations ──────────────────────────────────────────────────────

func TestEmitTypeDecls(t *testing.T) {
	src := `type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"
state { app { score:number = 0 } }
scene "s" {
  entry_action = a
  action "a" { compute "p" { k: Kind := "foo" } }
}
`
	out := fullPipeline(t, src)
	if !strings.Contains(out, `type "Kind" {`) {
		t.Error("missing Kind type decl block")
	}
	if !strings.Contains(out, `type "ResourceId" {`) {
		t.Error("missing ResourceId type decl block")
	}
	if !strings.Contains(out, `{kind: Kind}-{sequence: integer}`) {
		t.Error("missing canonical template def")
	}
	// The named binding re-emits with its declared type name, not the base type.
	if !strings.Contains(out, `type  = "Kind"`) {
		t.Errorf("binding should re-emit declared type name Kind; got:\n%s", out)
	}
}

// ─── state block ─────────────────────────────────────────────────────────────

func TestEmitStateBlock(t *testing.T) {
	src := `state {
  applicant {
    income:number = 50
    name:str      = "anon"
    active:bool   = true
    tags:arr<str> = []
  }
}
scene "s" {
  entry_action = a
  action "a" { compute "p" { v:bool := true } }
}
`
	out := fullPipeline(t, src)

	// Structural checks
	if !strings.Contains(out, `state {`) {
		t.Error("missing state block")
	}
	if !strings.Contains(out, `namespace "applicant"`) {
		t.Error("missing namespace")
	}
	if !strings.Contains(out, `field "income"`) {
		t.Error("missing field income")
	}
	if !strings.Contains(out, `type  = "number"`) {
		t.Error("missing type number")
	}
	if !strings.Contains(out, `value = 50`) {
		t.Error("missing value 50")
	}
	if !strings.Contains(out, `value = "anon"`) {
		t.Error("missing string value")
	}
	if !strings.Contains(out, `value = true`) {
		t.Error("missing bool value")
	}
	if !strings.Contains(out, `value = []`) {
		t.Error("missing empty array value")
	}
}

func TestEmitStateBeforeScene(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" { compute "p" { x:bool := true } }
}`)
	stateIdx := strings.Index(out, "state {")
	sceneIdx := strings.Index(out, "scene ")
	if stateIdx < 0 || sceneIdx < 0 {
		t.Fatal("missing state or scene block")
	}
	if stateIdx >= sceneIdx {
		t.Error("state block must appear before scene block")
	}
}

// ─── scene block ─────────────────────────────────────────────────────────────

func TestEmitSceneBlock(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "loan_flow" {
  entry_action = score
  action "score" { compute "p" { r:bool := true } }
  action "init"  { compute "p" { r:bool := true } }
}`)
	if !strings.Contains(out, `scene "loan_flow"`) {
		t.Error("missing scene label")
	}
	if !strings.Contains(out, `entry_action = "score"`) {
		t.Error("missing entry_action")
	}
	// `next_policy` was removed from the language; emitting it would produce a
	// file the converter can no longer read back.
	if strings.Contains(out, "next_policy") || strings.Contains(out, "nextPolicy") {
		t.Error("emitted a next_policy attribute")
	}
}

// ─── action text ─────────────────────────────────────────────────────────────

func TestEmitActionText(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" {
    """
    Review the application.
    """
    compute "p" { r:bool := true }
  }
}`)
	if !strings.Contains(out, "text = <<-EOT") {
		t.Error("missing heredoc text block")
	}
	if !strings.Contains(out, "Review the application.") {
		t.Error("missing text content")
	}
	if !strings.Contains(out, "EOT") {
		t.Error("missing EOT marker")
	}
}

// ─── compute / prog / bindings ────────────────────────────────────────────────

func TestEmitValueBinding(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" {
    compute "score_graph" {
      result:number := 42
    }
  }
}`)
	if !strings.Contains(out, `compute {`) {
		t.Error("missing compute block")
	}
	if !strings.Contains(out, `root = "result"`) {
		t.Error("missing root")
	}
	if !strings.Contains(out, `prog "score_graph"`) {
		t.Error("missing prog label")
	}
	if !strings.Contains(out, `binding "result"`) {
		t.Error("missing binding block")
	}
	if !strings.Contains(out, `type  = "number"`) {
		t.Error("missing type in binding")
	}
	if !strings.Contains(out, `value = 42`) {
		t.Error("missing value 42")
	}
}

func TestEmitCombineExpr(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" {
    compute "p" {
      x:number     = 3
      y:number     = 4
      result:number := max(x, y)
    }
  }
}`)
	if !strings.Contains(out, `expr  = {`) {
		t.Error("missing expr block")
	}
	if !strings.Contains(out, `combine = {`) {
		t.Error("missing combine block")
	}
	if !strings.Contains(out, `fn   = "max"`) {
		t.Error("missing fn = max")
	}
	if !strings.Contains(out, `{ ref = "x" }`) {
		t.Error("missing ref arg x")
	}
	if !strings.Contains(out, `{ ref = "y" }`) {
		t.Error("missing ref arg y")
	}
}

func TestEmitPipeExpr(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" {
    compute "p" {
      x:number      = 3
      y:number      = 4
      result:number := x |> max(#it, y)
    }
  }
}`)
	if !strings.Contains(out, `pipe = {`) {
		t.Error("missing pipe block")
	}
	if !strings.Contains(out, `initial = `) {
		t.Error("missing initial in pipe")
	}
	if !strings.Contains(out, `it = true`) {
		t.Error("missing it placeholder in pipe step")
	}
}

func TestEmitCondExpr(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" {
    compute "p" {
      x:number      = 1
      flag:bool     = true
      thenFn:number = max(x, x)
      result:number := if(flag, thenFn, thenFn)
    }
  }
}`)
	if !strings.Contains(out, `if = {`) {
		t.Error("missing if block")
	}
	if !strings.Contains(out, `cond = { ref = "flag" }`) {
		t.Error("missing cond ref")
	}
	if !strings.Contains(out, `{ ref = "thenFn" }`) {
		t.Error("missing then/else ref")
	}
}

// ─── prepare / merge / publish ────────────────────────────────────────────────

func TestEmitPrepareFromState(t *testing.T) {
	out := fullPipeline(t, `state {
  app { score:number = 0 }
}
scene "s" {
  entry_action = a
  action "a" {
    compute "p" { score:number := <~ @app.score }
  }
}`)
	if !strings.Contains(out, `prepare {`) {
		t.Error("missing prepare block")
	}
	if !strings.Contains(out, `from_state = "app.score"`) {
		t.Error("missing from_state")
	}
}

func TestEmitPrepareFromHook(t *testing.T) {
	out := fullPipeline(t, `state {
  app { data:str = "" }
}
scene "s" {
  entry_action = a
  action "a" {
    compute "p" { data:str := <~ hook("api_hook") }
  }
}`)
	if !strings.Contains(out, `from_hook  = "api_hook"`) {
		t.Error("missing from_hook")
	}
}

func TestEmitMergeBlock(t *testing.T) {
	out := fullPipeline(t, `state {
  app { approved:bool = false }
}
scene "s" {
  entry_action = a
  action "a" {
    compute "p" { approved:bool := (true) ~> @app.approved }
  }
}`)
	if !strings.Contains(out, `merge {`) {
		t.Error("missing merge block")
	}
	if !strings.Contains(out, `to_state = "app.approved"`) {
		t.Error("missing to_state")
	}
}

func TestEmitPublishBlock(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" {
    compute "p" { r:bool := true }
    publish {
      hook = "audit"
      hook = "notify"
    }
  }
}`)
	if !strings.Contains(out, `publish = ["audit", "notify"]`) {
		t.Errorf("missing publish list attribute, got:\n%s", out)
	}
}

// ─── next rule ────────────────────────────────────────────────────────────────

func TestEmitNextRule(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" {
    compute "p" { r:bool := true }
    next {
      compute "n" { ready:bool = false   go:bool := ready }
      action = b
    }
  }
  action "b" {
    compute "p" { r:bool := true }
  }
}`)
	if !strings.Contains(out, `next {`) {
		t.Error("missing next block")
	}
	if !strings.Contains(out, `condition = "go"`) {
		t.Error("missing condition")
	}
	if !strings.Contains(out, `action = "b"`) {
		t.Error("missing action target")
	}
}

// A deterministic transition (condition is the literal `true`) is normalized to
// the concise `next { action = ... }` form: no compute block is emitted.
func TestEmitNextRuleDeterministicOmitsCompute(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" {
    compute "p" { r:bool := true }
    next {
      compute "n" { always:bool := true }
      action = b
    }
  }
  action "b" {
    compute "p" { r:bool := true }
  }
}`)
	if !strings.Contains(out, `action = "b"`) {
		t.Error("missing action target")
	}
	if strings.Contains(out, "condition") {
		t.Errorf("deterministic next rule should omit compute/condition, got:\n%s", out)
	}
}

func TestEmitNextPrepareFromAction(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" {
    compute "p" {
      decision:bool := true
    }
    next {
      compute "n" {
        decision:bool <~ action(decision)
        go:bool := decision
      }
      action = b
    }
  }
  action "b" {
    compute "p" { r:bool := true }
  }
}`)
	if !strings.Contains(out, `from_action  = "decision"`) {
		t.Error("missing from_action")
	}
}

// ─── route block ─────────────────────────────────────────────────────────────

func TestEmitRouteBlock(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "scene_1" {
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}
route "route_1" {
  entry = scene_1
  to {
    scene_1.*.final_action -> scene_1,
    _ -> scene_1
  }
}`)

	if !strings.Contains(out, `route "route_1"`) {
		t.Error("missing route block")
	}
	if !strings.Contains(out, `entry_scene_id = "scene_1"`) {
		t.Error("missing entry_scene_id")
	}
	if !strings.Contains(out, `match {`) {
		t.Error("missing match block")
	}
	if !strings.Contains(out, `arm {`) {
		t.Error("missing arm block")
	}
	if !strings.Contains(out, `patterns = ["scene_1.*.final_action"]`) {
		t.Error("missing pattern")
	}
	if !strings.Contains(out, `target   = "scene_1"`) {
		t.Error("missing target")
	}
	if !strings.Contains(out, `patterns = ["_"]`) {
		t.Error("missing fallback pattern")
	}
}

func TestEmitRouteEntrySceneIdMissingFails(t *testing.T) {
	src := `state { ns { v:number = 0 } }
scene "scene_1" {
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}
route "route_1" {
  to { _ -> scene_1 }
}`
	tf, ds := parser.ParseFile("test.tu", src)
	if ds.HasErrors() {
		t.Fatalf("parse failed: %v", ds)
	}
	lr, ds2 := lower.LowerResolvingState(tf, "")
	if ds2.HasErrors() {
		t.Fatalf("lower failed: %v", ds2)
	}
	ds4 := validate.Validate(validate.ValidateInput{Model: lr.Model, Schema: lr.Schema})
	hasMissingEntry := false
	for _, d := range ds4 {
		if d.Code == "MissingEntryScene" {
			hasMissingEntry = true
		}
	}
	if !hasMissingEntry {
		t.Error("expected MissingEntryScene diagnostic for route without entry declaration")
	}
}

func TestEmitRouteAfterScene(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}
route "r1" { entry = s to { _ -> s } }`)
	sceneIdx := strings.Index(out, "scene ")
	routeIdx := strings.Index(out, "route ")
	if sceneIdx < 0 || routeIdx < 0 {
		t.Fatal("missing scene or route block")
	}
	if routeIdx <= sceneIdx {
		t.Error("route block must appear after scene block")
	}
}

func TestEmitRouteORBranches(t *testing.T) {
	out := fullPipeline(t, `state { ns { v:number = 0 } }
scene "scene_1" {
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}
route "r1" {
  entry = scene_1
  to {
    scene_1.*.end |
    scene_1.a
      -> scene_1
  }
}`)
	// Both patterns in one arm
	if !strings.Contains(out, `"scene_1.*.end"`) {
		t.Error("missing first OR branch")
	}
	if !strings.Contains(out, `"scene_1.a"`) {
		t.Error("missing second OR branch")
	}
	// Should be in one patterns array
	if strings.Count(out, `arm {`) != 1 {
		t.Error("expected exactly 1 arm for OR branches")
	}
}

// ─── idempotency ─────────────────────────────────────────────────────────────

func TestEmitIdempotency(t *testing.T) {
	src := `state {
  applicant {
    income:number = 0
    approved:bool = false
  }
}
scene "loan_flow" {
  entry_action = score
  action "score" {
    """
    Score the application.
    """
    compute "score_graph" {
      income:number   = 50000
      threshold:number = 30000
      decision:bool := income >= threshold
    }
  }
}`
	out1 := fullPipeline(t, src)
	out2 := fullPipeline(t, src)
	if out1 != out2 {
		t.Error("emit is not idempotent: got different output on second run")
	}
}

func TestEmitNilModelNoop(t *testing.T) {
	out := emitModel(nil)
	if out != "" {
		t.Errorf("nil model should emit nothing, got %q", out)
	}
}

// ─── state_file vs inline idempotency ────────────────────────────────────────

func TestEmitStateFileVsInline(t *testing.T) {
	// Inline state
	inlineSrc := `state {
  app {
    score:number = 0
    active:bool  = false
  }
}
scene "s" {
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}
`
	// state_file equivalent
	dir := t.TempDir()
	stateFileContent := `state {
  app {
    active:bool  = false
    score:number = 0
  }
}`
	if err := os.WriteFile(dir+"/app.state.tu", []byte(stateFileContent), 0o644); err != nil {
		t.Fatalf("write state file: %v", err)
	}
	stateFileSrc := `state_file = "app.state.tu"
scene "s" {
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}
`
	// Pipeline for state_file source
	tf2, ds := parser.ParseFile(dir+"/test.tu", stateFileSrc)
	if ds.HasErrors() {
		t.Fatalf("parse state_file src: %v", ds)
	}
	lr2, ds3 := lower.LowerResolvingState(tf2, dir)
	if ds3.HasErrors() {
		t.Fatalf("lower state_file: %v", ds3)
	}

	// Both should produce a state block with namespace "app" and fields "score" + "active".
	inlineOut := fullPipeline(t, inlineSrc)
	var sb strings.Builder
	emit.Emit(&sb, lr2.Model)
	stateFileOut := sb.String()

	// They won't be byte-identical (ordering may differ), but both must contain
	// the same key fields.
	for _, needle := range []string{`namespace "app"`, `field "score"`, `field "active"`} {
		if !strings.Contains(inlineOut, needle) {
			t.Errorf("inline missing %q", needle)
		}
		if !strings.Contains(stateFileOut, needle) {
			t.Errorf("state_file missing %q", needle)
		}
	}
}

// ─── integration: example files ──────────────────────────────────────────────

// compileExample runs an example through the full parse → state-resolve → lower
// → validate → emit pipeline. Every checked-in example carries its own state
// schema, so reference, IO, and STATE type errors can be caught here rather
// than by a parse-only smoke test. Emission also exercises generated anonymous
// egress bindings in the canonical HCL representation.
func compileExample(t *testing.T, path string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read example: %v", err)
	}
	tf, ds := parser.ParseFile(path, string(data))
	if ds.HasErrors() {
		for _, d := range ds {
			t.Logf("parse: %s", d.Format())
		}
		t.Fatalf("parse failed")
	}
	lr, lowerDs := lower.LowerResolvingState(tf, filepath.Dir(path))
	if lowerDs.HasErrors() || lr == nil {
		for _, d := range lowerDs {
			t.Logf("lower: %s", d.Format())
		}
		t.Fatalf("lower failed")
	}
	validateDs := validate.Validate(validate.ValidateInput{Model: lr.Model, Schema: lr.Schema})
	if validateDs.HasErrors() {
		for _, d := range validateDs {
			t.Logf("validate: %s", d.Format())
		}
		t.Fatalf("validate failed")
	}
	var out strings.Builder
	if emitDs := emit.Emit(&out, lr.Model); emitDs.HasErrors() {
		for _, d := range emitDs {
			t.Logf("emit: %s", d.Format())
		}
		t.Fatalf("emit failed")
	}
}

const examplesDir = "../../../../../spec/examples"

func TestIntegrationAllExamplesCompileClean(t *testing.T) {
	examples, err := filepath.Glob(filepath.Join(examplesDir, "*.tu"))
	if err != nil {
		t.Fatalf("glob examples: %v", err)
	}
	if len(examples) == 0 {
		t.Fatalf("no .tu examples found in %s", examplesDir)
	}
	for _, path := range examples {
		t.Run(filepath.Base(path), func(t *testing.T) {
			compileExample(t, path)
		})
	}
}

// ─── JSON emitter ─────────────────────────────────────────────────────────────

func TestEmitJSONBasic(t *testing.T) {
	src := `state {
  request {
    query:str  = ""
    ready:bool = false
  }
}
scene "test_scene" {
  entry_action = act_a
  action "act_a" {
    compute "g" {
      q:str <~ @request.query
      out:str = (q) ~> @request.query
      done:bool := true
    }
    next {
      compute "to_b" { done:bool := true }
      action = act_b
    }
  }
  action "act_b" {
    compute "h" { ok:bool := true }
  }
}`
	tf, ds := parser.ParseFile("test.tu", src)
	if ds.HasErrors() {
		t.Fatalf("parse: %v", ds)
	}
	lr, ds2 := lower.LowerResolvingState(tf, "")
	if ds2.HasErrors() {
		t.Fatalf("lower: %v", ds2)
	}
	if ds3 := validate.Validate(validate.ValidateInput{Model: lr.Model, Schema: lr.Schema}); ds3.HasErrors() {
		t.Fatalf("validate: %v", ds3)
	}

	var sb strings.Builder
	if ds := emit.EmitJSON(&sb, lr.Model); ds.HasErrors() {
		t.Fatalf("EmitJSON: %v", ds)
	}
	out := sb.String()

	checks := []string{
		`"scenes"`,
		`"test_scene"`,
		`"entryAction"`,
		`"act_a"`,
		`"prepare"`,
		`"fromState"`,
		`"request.query"`,
		`"merge"`,
		`"toState"`,
		`"next"`,
		`"namespaces"`,
	}
	for _, want := range checks {
		if !strings.Contains(out, want) {
			t.Errorf("EmitJSON output missing %q\nOutput:\n%s", want, out)
		}
	}
}

func TestAnnotationsNotInJSONOutput(t *testing.T) {
	// Sigil bindings (~>, <~) never write to TurnModel.Annotations. The emitter
	// defensively clears the field anyway so that any future code path that sets
	// it is still safe to call EmitJSON.
	src := `state { app { query:str = "" result:str = "" } }
scene "s" {
  entry_action = a
  action "a" {
    compute "p" {
      q:str <~ @app.query
      out:str = (q) ~> @app.result
      done:bool := true
    }
  }
}`
	tf, ds := parser.ParseFile("test.tu", src)
	if ds.HasErrors() {
		t.Fatalf("parse: %v", ds)
	}
	lr, ds2 := lower.LowerResolvingState(tf, "")
	if ds2.HasErrors() {
		t.Fatalf("lower: %v", ds2)
	}
	var sb strings.Builder
	if ds := emit.EmitJSON(&sb, lr.Model); ds.HasErrors() {
		t.Fatalf("EmitJSON: %v", ds)
	}
	if strings.Contains(sb.String(), `"annotations"`) {
		t.Fatal("emitted JSON must not contain annotations field")
	}
}

func TestEmitJSONIncludesLoweredExtExprs(t *testing.T) {
	src := `state { app { n:number = 0 } }
scene "test" {
  entry_action = a
  action "a" {
    compute "p" {
      flag:bool = true
      out:number := if(flag, 1, 0)
    }
  }
}`
	tf, ds := parser.ParseFile("test.tu", src)
	if ds.HasErrors() {
		t.Fatalf("parse: %v", ds)
	}
	lr, ds2 := lower.LowerResolvingState(tf, "")
	if ds2.HasErrors() {
		t.Fatalf("lower: %v", ds2)
	}
	if ds3 := validate.Validate(validate.ValidateInput{Model: lr.Model, Schema: lr.Schema}); ds3.HasErrors() {
		t.Fatalf("validate: %v", ds3)
	}
	var sb strings.Builder
	if ds := emit.EmitJSON(&sb, lr.Model); ds.HasErrors() {
		t.Fatalf("EmitJSON: %v", ds)
	}
	out := sb.String()
	for _, want := range []string{`"cond"`, `__local_out_then_fn`, `__local_out_else_fn`} {
		if !strings.Contains(out, want) {
			t.Fatalf("EmitJSON output missing %q\n%s", want, out)
		}
	}
}
