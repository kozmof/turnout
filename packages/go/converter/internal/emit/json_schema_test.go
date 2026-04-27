// Package emit — proto round-trip tests.
//
// These tests verify that EmitJSON output round-trips cleanly through
// protojson.Unmarshal, proving that the emitter produces valid proto JSON.
// The schema is defined in schema/turnout-model.proto and enforced at compile
// time by the generated types in both Go (turnoutpb) and TypeScript.
package emit

import (
	"bytes"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
	"google.golang.org/protobuf/encoding/protojson"
)

// TestEmitJSONRoundTrip runs the full DSL pipeline on a source that exercises
// every proto boundary type (state, compute, prepare, merge, publish, next,
// route), then unmarshals the output back via protojson. Any field emitted
// outside the proto schema causes protojson.Unmarshal to return an error
// (unknown field), catching emitter drift from the schema.
func TestEmitJSONRoundTrip(t *testing.T) {
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
        ~>score:number
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
          ~>score:number
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
	lr, ds3 := lower.Lower(tf, schema)
	if ds3.HasErrors() {
		t.Fatalf("lower: %v", ds3)
	}
	if ds4 := validate.Validate(lr.Model, lr.Sidecar, schema); ds4.HasErrors() {
		t.Fatalf("validate: %v", ds4)
	}

	var buf bytes.Buffer
	if err := EmitJSON(&buf, lr.Model); err != nil {
		t.Fatalf("EmitJSON: %v", err)
	}

	// Unmarshal back via protojson — rejects unknown fields, verifying the
	// emitter never produces keys outside the proto schema.
	var got turnoutpb.TurnModel
	if err := protojson.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("protojson.Unmarshal: %v\n(emitted JSON contains a field not declared in turnout-model.proto)", err)
	}

	if len(got.Scenes) == 0 {
		t.Fatal("expected at least one scene in output")
	}
	if got.Scenes[0].Id != "s" {
		t.Errorf("scene ID: got %q, want %q", got.Scenes[0].Id, "s")
	}
}

// TestEmitJSONNilModelProducesValidJSON verifies that a nil model still emits
// valid proto JSON that unmarshals without error.
func TestEmitJSONNilModelProducesValidJSON(t *testing.T) {
	var buf bytes.Buffer
	if err := EmitJSON(&buf, nil); err != nil {
		t.Fatalf("EmitJSON nil: %v", err)
	}
	var tm turnoutpb.TurnModel
	if err := protojson.Unmarshal(buf.Bytes(), &tm); err != nil {
		t.Fatalf("protojson.Unmarshal nil model: %v", err)
	}
	if len(tm.Scenes) != 0 {
		t.Errorf("expected 0 scenes, got %d", len(tm.Scenes))
	}
}
