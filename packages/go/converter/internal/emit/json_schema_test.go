// Package emit — JSON schema conformance tests.
//
// These tests verify that:
//  1. schema/turnout-model.json is valid JSON and contains all expected definitions.
//  2. EmitJSON output round-trips through DisallowUnknownFields, proving that the
//     emitter never produces keys outside those declared in the shared schema.
package emit

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/turnout/converter/internal/lower"
	"github.com/turnout/converter/internal/parser"
	"github.com/turnout/converter/internal/state"
	"github.com/turnout/converter/internal/validate"
)

// schemaPath is relative to the package directory (packages/go/converter/internal/emit).
const schemaPath = "../../../../../schema/turnout-model.json"

// loadResolvedSchema reads schemaPath and returns a resolved schema ready for validation.
func loadResolvedSchema(t *testing.T) *jsonschema.Resolved {
	t.Helper()
	data, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("cannot read schema: %v", err)
	}
	var s jsonschema.Schema
	if err := json.Unmarshal(data, &s); err != nil {
		t.Fatalf("cannot parse schema: %v", err)
	}
	rs, err := s.Resolve(&jsonschema.ResolveOptions{BaseURI: "https://turnout.dev/schema/turnout-model.json"})
	if err != nil {
		t.Fatalf("cannot resolve schema: %v", err)
	}
	return rs
}

// validateAgainstSchema checks that the JSON in buf conforms to turnout-model.json.
func validateAgainstSchema(t *testing.T, rs *jsonschema.Resolved, buf *bytes.Buffer) {
	t.Helper()
	var instance any
	if err := json.Unmarshal(buf.Bytes(), &instance); err != nil {
		t.Fatalf("cannot unmarshal emitted JSON for schema validation: %v", err)
	}
	if err := rs.Validate(instance); err != nil {
		t.Fatalf("emitted JSON does not conform to schema/turnout-model.json:\n%v", err)
	}
}

// expectedDefs is the full set of $defs names the schema must declare.
var expectedDefs = []string{
	"FieldTypeStr", "Literal",
	"StateModel", "NamespaceModel", "FieldModel",
	"SceneBlock", "ActionModel",
	"ComputeModel", "ProgModel", "BindingModel",
	"ExprModel", "CombineExpr", "PipeExpr", "PipeParam", "PipeStep", "CondExpr",
	"ArgModel", "TransformArg",
	"PrepareEntry", "MergeEntry",
	"NextRuleModel", "NextComputeModel", "NextPrepareEntry",
	"RouteModel", "MatchArm",
}

// TestSchemaFileIsValidJSON verifies that schema/turnout-model.json is parseable
// and declares every definition required by the Go–TS JSON boundary.
func TestSchemaFileIsValidJSON(t *testing.T) {
	data, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("cannot read schema file: %v", err)
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("invalid JSON in schema file: %v", err)
	}
	for _, key := range []string{"$schema", "$id", "title", "description", "$defs", "properties"} {
		if _, ok := raw[key]; !ok {
			t.Errorf("schema missing top-level key %q", key)
		}
	}
	defs, ok := raw["$defs"].(map[string]interface{})
	if !ok {
		t.Fatal("schema $defs is not a JSON object")
	}
	for _, name := range expectedDefs {
		if _, ok := defs[name]; !ok {
			t.Errorf("schema $defs missing definition %q", name)
		}
	}
}

// TestEmitJSONRoundTrip runs the full DSL pipeline on a source that exercises
// every JSON boundary type (state, compute, prepare, merge, publish, next,
// route), then decodes the emitted JSON back into jsonModel using
// DisallowUnknownFields. Any key emitted by the Go side that is absent from
// jsonModel (and therefore absent from the shared schema) will cause the decode
// to fail, catching drift between emitter and schema.
func TestEmitJSONRoundTrip(t *testing.T) {
	rs := loadResolvedSchema(t)
	const src = `state {
  user {
    score:number = 0
    active:bool  = false
    tag:str      = ""
    ids:arr<number> = []
  }
}
scene "s" {
  entry_actions = ["a"]
  next_policy   = "first-match"
  action "a" {
    compute {
      root = done
      prog "p" {
        ~>score:number = _
        <~done:bool    = true
      }
    }
    prepare {
      score { from_state = user.score }
    }
    merge {
      done { to_state = user.active }
    }
    publish {
      hook = "on_done"
    }
    next {
      compute {
        condition = go
        prog "n" {
          ~>score:number = _
          go:bool = true
        }
      }
      prepare {
        score { from_action = score }
      }
      action = b
    }
  }
  action "b" {
    compute { root = r prog "p" { r:bool = true } }
  }
}
route "main" {
  match {
    _ => "s"
  }
}`
	tf, ds := parser.ParseFile("test.turn", src)
	if ds.HasErrors() {
		t.Fatalf("parse: %v", ds)
	}
	schema, ds2 := state.Resolve(tf.StateSource, "")
	if ds2.HasErrors() {
		t.Fatalf("state resolve: %v", ds2)
	}
	model, ds3 := lower.Lower(tf, schema)
	if ds3.HasErrors() {
		t.Fatalf("lower: %v", ds3)
	}
	if ds4 := validate.Validate(model, schema); ds4.HasErrors() {
		t.Fatalf("validate: %v", ds4)
	}

	var buf bytes.Buffer
	if err := EmitJSON(&buf, model); err != nil {
		t.Fatalf("EmitJSON: %v", err)
	}

	// Validate against the JSON Schema — catches missing required fields, wrong
	// enum values, wrong types, and extra properties.
	validateAgainstSchema(t, rs, &buf)

	// Also decode with strict unknown-field rejection as a secondary guard.
	dec := json.NewDecoder(&buf)
	dec.DisallowUnknownFields()
	var jm jsonModel
	if err := dec.Decode(&jm); err != nil {
		t.Fatalf("round-trip decode: %v\n(emitted JSON contains a field not declared in schema/turnout-model.json)", err)
	}

	if len(jm.Scenes) == 0 {
		t.Fatal("expected at least one scene in output")
	}
	if jm.Scenes[0].ID != "s" {
		t.Errorf("scene ID: got %q, want %q", jm.Scenes[0].ID, "s")
	}
}

// TestEmitJSONNilModelProducesEmptyScenes verifies that a nil model still
// emits a valid JSON object with an empty scenes array.
func TestEmitJSONNilModelProducesEmptyScenes(t *testing.T) {
	rs := loadResolvedSchema(t)
	var buf bytes.Buffer
	if err := EmitJSON(&buf, (*lower.Model)(nil)); err != nil {
		t.Fatalf("EmitJSON nil: %v", err)
	}
	validateAgainstSchema(t, rs, &buf)
	dec := json.NewDecoder(&buf)
	dec.DisallowUnknownFields()
	var jm jsonModel
	if err := dec.Decode(&jm); err != nil {
		t.Fatalf("round-trip nil model: %v", err)
	}
	if jm.Scenes == nil {
		t.Error("scenes must be an empty array, not null")
	}
	if len(jm.Scenes) != 0 {
		t.Errorf("expected 0 scenes, got %d", len(jm.Scenes))
	}
}
