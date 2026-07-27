package validate

import (
	"encoding/json"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/encoding/protojson"
)

const conformanceFixturePath = "../../../../../spec/conformance/template-matching.json"

type conformanceCase struct {
	Type     string         `json:"type"`
	Input    string         `json:"input"`
	Matched  bool           `json:"matched"`
	Captures map[string]any `json:"captures"`
}
type constructionCase struct {
	Type     string         `json:"type"`
	Captures map[string]any `json:"captures"`
	Output   string         `json:"output"`
}
type selectionArm struct {
	Capture string `json:"capture"`
	Equals  any    `json:"equals"`
	Default bool   `json:"default"`
}
type selectionCase struct {
	Type     string         `json:"type"`
	Input    string         `json:"input"`
	Arms     []selectionArm `json:"arms"`
	Selected int            `json:"selected"`
}
type failureCase struct {
	Type       string `json:"type"`
	Input      string `json:"input"`
	Diagnostic string `json:"diagnostic"`
}
type conformanceFixture struct {
	Model         json.RawMessage    `json:"model"`
	Cases         []conformanceCase  `json:"cases"`
	Constructions []constructionCase `json:"constructions"`
	ArmSelections []selectionCase    `json:"armSelections"`
	Failures      []failureCase      `json:"failures"`
}

func loadConformanceFixture(t *testing.T) (conformanceFixture, *typeRegistry) {
	t.Helper()
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
			t.Errorf("fixture type declarations: %s", d.Format())
		}
	}
	return fx, reg
}

func fixtureTemplate(t *testing.T, reg *typeRegistry, name string) *ast.TemplateType {
	t.Helper()
	typ, ok := reg.get(name)
	if !ok {
		t.Fatalf("type %q missing", name)
	}
	tmpl, ok := ast.Resolve(typ).(*ast.TemplateType)
	if !ok {
		t.Fatalf("type %q is not a template", name)
	}
	return tmpl
}

func TestTemplateMatchConformance(t *testing.T) {
	fx, reg := loadConformanceFixture(t)
	for _, c := range fx.Cases {
		t.Run(c.Type+"/"+c.Input, func(t *testing.T) {
			caps, matched := ast.TemplateMatch(fixtureTemplate(t, reg, c.Type), c.Input)
			if matched != c.Matched {
				t.Fatalf("matched=%v, want %v", matched, c.Matched)
			}
			if matched && c.Captures != nil && !reflect.DeepEqual(caps, c.Captures) {
				t.Fatalf("captures=%#v, want %#v", caps, c.Captures)
			}
		})
	}
}

func TestTemplateConstructionConformance(t *testing.T) {
	fx, reg := loadConformanceFixture(t)
	for _, c := range fx.Constructions {
		t.Run(c.Type, func(t *testing.T) {
			tmpl := fixtureTemplate(t, reg, c.Type)
			var b strings.Builder
			for _, seg := range tmpl.Segments {
				switch s := seg.(type) {
				case *ast.TextSegment:
					b.WriteString(s.Value)
				case *ast.CaptureSegment:
					v, ok := c.Captures[s.Name]
					if !ok {
						t.Fatalf("missing fixture capture %q", s.Name)
					}
					switch x := v.(type) {
					case string:
						b.WriteString(x)
					case float64:
						b.WriteString(strconv.FormatFloat(x, 'g', -1, 64))
					case bool:
						b.WriteString(strconv.FormatBool(x))
					default:
						t.Fatalf("unsupported capture %T", v)
					}
				}
			}
			if got := b.String(); got != c.Output {
				t.Fatalf("output=%q, want %q", got, c.Output)
			}
			caps, ok := ast.TemplateMatch(tmpl, c.Output)
			if !ok || !reflect.DeepEqual(caps, c.Captures) {
				t.Fatalf("constructed output does not round-trip: %#v,%v", caps, ok)
			}
		})
	}
}

func TestTemplateArmSelectionConformance(t *testing.T) {
	fx, reg := loadConformanceFixture(t)
	for _, c := range fx.ArmSelections {
		t.Run(c.Type+"/"+c.Input, func(t *testing.T) {
			caps, matched := ast.TemplateMatch(fixtureTemplate(t, reg, c.Type), c.Input)
			selected := -1
			if matched {
				for i, arm := range c.Arms {
					if arm.Default || reflect.DeepEqual(caps[arm.Capture], arm.Equals) {
						selected = i
						break
					}
				}
			}
			if selected != c.Selected {
				t.Fatalf("selected=%d, want %d (captures=%v)", selected, c.Selected, caps)
			}
		})
	}
}

func TestTemplateFailureDiagnosticConformance(t *testing.T) {
	fx, reg := loadConformanceFixture(t)
	for _, c := range fx.Failures {
		t.Run(c.Type+"/"+c.Input, func(t *testing.T) {
			diagnostic := ""
			if !ast.TemplateContains(fixtureTemplate(t, reg, c.Type), c.Input) {
				diagnostic = string(diag.CodeInvalidTemplateValue)
			}
			if diagnostic != c.Diagnostic {
				t.Fatalf("diagnostic=%q, want %q", diagnostic, c.Diagnostic)
			}
		})
	}
}
