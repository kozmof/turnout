// Package emit — projection contract tests.
//
// The rule that compiler-only fields never reach a runtime is implemented three
// times: this emitter strips them, the TypeScript encoder strips them again,
// and the Zig runtime rejects them on arrival. spec/runtime-projection.json is
// the one declaration all three answer to. This test is the Go half; the other
// two are in packages/ts/scene-runner/tests/runtime-projection.test.ts.
package emit

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

// projectionSpecPath is the path from the test binary's working directory
// (the package directory) to the shared specification at the repo root.
const projectionSpecPath = "../../../../../spec/runtime-projection.json"

type projectionSpec struct {
	CompilerOnly []struct {
		Message string `json:"message"`
		Field   string `json:"field"`
		Path    string `json:"path"`
		Why     string `json:"why"`
	} `json:"compilerOnly"`
	Retained map[string][]string `json:"retained"`
}

// readProjectionSpec loads the shared specification.
func readProjectionSpec(t *testing.T) projectionSpec {
	t.Helper()
	data, err := os.ReadFile(projectionSpecPath)
	if err != nil {
		t.Fatalf("could not read %s: %v", projectionSpecPath, err)
	}
	var spec projectionSpec
	if err := json.Unmarshal(data, &spec); err != nil {
		t.Fatalf("could not parse %s: %v", projectionSpecPath, err)
	}
	if len(spec.CompilerOnly) == 0 {
		t.Fatalf("%s declares no compiler-only fields", projectionSpecPath)
	}
	return spec
}

// lookupPath reads a dotted path out of decoded JSON. A `[]` suffix descends
// into the first element of a repeated field, which is all the fixture needs:
// the rule is about a field existing anywhere, not about how often.
func lookupPath(doc map[string]any, path string) (any, bool) {
	var node any = doc
	for _, segment := range strings.Split(path, ".") {
		repeated := strings.HasSuffix(segment, "[]")
		key := strings.TrimSuffix(segment, "[]")
		object, ok := node.(map[string]any)
		if !ok {
			return nil, false
		}
		node, ok = object[key]
		if !ok {
			return nil, false
		}
		if repeated {
			items, ok := node.([]any)
			if !ok || len(items) == 0 {
				return nil, false
			}
			node = items[0]
		}
	}
	return node, true
}

// marshalToMap renders a model the way EmitJSON does and decodes it, so paths
// are checked against the JSON names a runtime actually receives.
func marshalToMap(t *testing.T, tm *turnoutpb.TurnModel) map[string]any {
	t.Helper()
	raw, err := protojson.Marshal(tm)
	if err != nil {
		t.Fatalf("protojson.Marshal failed: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("could not decode marshalled model: %v", err)
	}
	return doc
}

// modelWithCompilerFields builds a model populating every compiler-only field
// the specification names, at every path it names.
func modelWithCompilerFields() *turnoutpb.TurnModel {
	binding := func() *turnoutpb.BindingModel {
		return &turnoutpb.BindingModel{
			Name:         "value",
			Type:         "number",
			Value:        structpb.NewNumberValue(1),
			ExtExpr:      &turnoutpb.LocalExprModel{},
			SourcePos:    &turnoutpb.SourcePos{File: "flow.tu", Line: 3, Col: 5},
			DeclaredType: &turnoutpb.TypeExpr{},
		}
	}
	prog := func() *turnoutpb.ProgModel {
		return &turnoutpb.ProgModel{
			Name:     "program",
			Bindings: []*turnoutpb.BindingModel{binding()},
			Sigils:   map[string]int32{"value": 1},
		}
	}
	return &turnoutpb.TurnModel{
		Version:     2,
		Annotations: &turnoutpb.SigilAnnotations{},
		TypeDecls: []*turnoutpb.TypeDeclModel{
			{Name: "Status", SourcePos: &turnoutpb.SourcePos{File: "flow.tu", Line: 1}},
		},
		Scenes: []*turnoutpb.SceneBlock{
			{
				Id:          "scene",
				EntryAction: "action",
				View: &turnoutpb.ViewBlock{
					Name:      "overview",
					Flow:      "action |-> done",
					Nodes:     []*turnoutpb.FlowNodeModel{{Id: "action"}},
					Edges:     []*turnoutpb.FlowEdgeModel{{From: "action", To: "done"}},
					SourcePos: &turnoutpb.SourcePos{File: "flow.tu", Line: 2},
				},
				Actions: []*turnoutpb.ActionModel{
					{
						Id:      "action",
						Compute: &turnoutpb.ComputeModel{Root: "value", Prog: prog()},
						Next: []*turnoutpb.NextRuleModel{
							{
								Action:  "done",
								Compute: &turnoutpb.NextComputeModel{Condition: "value", Prog: prog()},
							},
						},
					},
				},
			},
		},
	}
}

// TestStripNonRuntimeFieldsMatchesProjectionSpec checks both directions: the
// fixture reaches every path the specification names, and stripping clears
// every one of them. A new compiler-only field added to the spec fails the
// first check until the fixture populates it, and the second until the emitter
// strips it.
func TestStripNonRuntimeFieldsMatchesProjectionSpec(t *testing.T) {
	spec := readProjectionSpec(t)
	model := modelWithCompilerFields()

	before := marshalToMap(t, model)
	for _, entry := range spec.CompilerOnly {
		if _, found := lookupPath(before, entry.Path); !found {
			t.Errorf(
				"fixture does not populate %s (%s.%s); extend modelWithCompilerFields so the strip is actually exercised",
				entry.Path, entry.Message, entry.Field,
			)
		}
	}

	after := marshalToMap(t, stripNonRuntimeFields(model))
	for _, entry := range spec.CompilerOnly {
		if value, found := lookupPath(after, entry.Path); found {
			t.Errorf(
				"stripNonRuntimeFields left compiler-only field %s (%s.%s) in the emitted model: %v",
				entry.Path, entry.Message, entry.Field, value,
			)
		}
	}
}

// TestStripNonRuntimeFieldsKeepsRetainedFields checks the other half of the
// specification: stripping must not reach a field a runtime reads.
func TestStripNonRuntimeFieldsKeepsRetainedFields(t *testing.T) {
	spec := readProjectionSpec(t)
	model := modelWithCompilerFields()
	after := marshalToMap(t, stripNonRuntimeFields(model))

	retained := map[string]string{
		"TurnModel":        "version",
		"SceneBlock":       "scenes[].id",
		"ViewBlock":        "scenes[].view.name",
		"ActionModel":      "scenes[].actions[].id",
		"ComputeModel":     "scenes[].actions[].compute.root",
		"ProgModel":        "scenes[].actions[].compute.prog.name",
		"BindingModel":     "scenes[].actions[].compute.prog.bindings[].type",
		"NextRuleModel":    "scenes[].actions[].next[].action",
		"NextComputeModel": "scenes[].actions[].next[].compute.condition",
	}
	for message, path := range retained {
		field := path[strings.LastIndex(path, ".")+1:]
		if !containsString(spec.Retained[message], snakeCase(field)) {
			t.Fatalf("%s is not listed as retained on %s in %s", field, message, projectionSpecPath)
		}
		if _, found := lookupPath(after, path); !found {
			t.Errorf("stripNonRuntimeFields removed retained field %s", path)
		}
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// snakeCase converts a protojson field name back to its proto declaration, the
// form the specification's retained table uses.
func snakeCase(name string) string {
	var out strings.Builder
	for _, char := range name {
		if char >= 'A' && char <= 'Z' {
			out.WriteByte('_')
			out.WriteRune(char + ('a' - 'A'))
			continue
		}
		out.WriteRune(char)
	}
	return out.String()
}
