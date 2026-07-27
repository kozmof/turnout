package validate

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/encoding/protojson"
)

// The template-matching conformance fixture is shared with the TypeScript
// runtime (packages/ts/scene-runner/src/template/matcher.test.ts). Both
// implementations must produce identical match results and decoded captures
// (literal-template-types-spec.md §28.8).
const conformanceFixturePath = "../../../../../spec/conformance/template-matching.json"

type conformanceCase struct {
	Type     string         `json:"type"`
	Input    string         `json:"input"`
	Matched  bool           `json:"matched"`
	Captures map[string]any `json:"captures"`
}

type conformanceFixture struct {
	Model json.RawMessage   `json:"model"`
	Cases []conformanceCase `json:"cases"`
}

func TestTemplateMatchConformance(t *testing.T) {
	raw, err := os.ReadFile(conformanceFixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fx conformanceFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}

	var tm turnoutpb.TurnModel
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(fx.Model, &tm); err != nil {
		t.Fatalf("unmarshal model: %v", err)
	}

	var ds diag.DiagSink
	reg := validateTypeDecls(tm.TypeDecls, &ds)
	if ds.HasErrors() {
		for _, d := range ds.Flush() {
			t.Errorf("fixture type decls should validate cleanly: %s", d.Format())
		}
	}

	for _, c := range fx.Cases {
		typ, ok := reg.get(c.Type)
		if !ok {
			t.Errorf("case %q/%q: type not found in fixture", c.Type, c.Input)
			continue
		}
		tmpl, ok := ast.Resolve(typ).(*ast.TemplateType)
		if !ok {
			t.Errorf("case %q: not a template type", c.Type)
			continue
		}
		caps, matched := ast.TemplateMatch(tmpl, c.Input)
		if matched != c.Matched {
			t.Errorf("%s <- %q: matched=%v, want %v", c.Type, c.Input, matched, c.Matched)
			continue
		}
		if matched && c.Captures != nil {
			if !reflect.DeepEqual(caps, c.Captures) {
				t.Errorf("%s <- %q: captures=%#v, want %#v", c.Type, c.Input, caps, c.Captures)
			}
		}
	}
}
