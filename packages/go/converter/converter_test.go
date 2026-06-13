package converter_test

import (
	"os"
	"path/filepath"
	"testing"

	converter "github.com/kozmof/turnout/packages/go/converter"
)

const simpleTurnSrc = `
state {
  ns {
    count:number = 0
  }
}

scene "start" {
  entry_actions = ["init"]

  action "init" {
    compute {
      root = "v"
      prog "p" {
        <~ v:number = 1
      }
    }
    merge {
      v { to_state = ns.count }
    }
  }
}
`

func writeTempFile(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "test.turn")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("writeTempFile: %v", err)
	}
	return path
}

func TestCompile_success(t *testing.T) {
	path := writeTempFile(t, simpleTurnSrc)
	result, ds := converter.Compile(path, "")
	if ds.HasErrors() {
		for _, d := range ds {
			t.Logf("diag: %s", d.Format())
		}
		t.Fatalf("Compile returned errors on a valid input")
	}
	if result == nil {
		t.Fatal("Compile returned nil result with no errors")
	}
	if result.Model() == nil {
		t.Fatal("CompileResult.Model is nil")
	}
	if len(result.Model().Scenes) != 1 {
		t.Fatalf("expected 1 scene, got %d", len(result.Model().Scenes))
	}
	if result.Model().Scenes[0].Id != "start" {
		t.Fatalf("expected scene id 'start', got %q", result.Model().Scenes[0].Id)
	}
}

func TestCompile_missingFile(t *testing.T) {
	result, ds := converter.Compile("/nonexistent/path/test.turn", "")
	if result != nil {
		t.Fatal("expected nil result for missing file")
	}
	if !ds.HasErrors() {
		t.Fatal("expected errors for missing file")
	}
}

func TestCompile_parseError(t *testing.T) {
	path := writeTempFile(t, "@@@ not valid turn syntax @@@")
	result, ds := converter.Compile(path, "")
	if result != nil {
		t.Fatal("expected nil result for invalid syntax")
	}
	if !ds.HasErrors() {
		t.Fatal("expected errors for invalid syntax")
	}
}

func TestCompileSource_success(t *testing.T) {
	result, ds := converter.CompileSource("inline.turn", simpleTurnSrc, "")
	if ds.HasErrors() {
		for _, d := range ds {
			t.Logf("diag: %s", d.Format())
		}
		t.Fatalf("CompileSource returned errors on a valid input")
	}
	if result == nil {
		t.Fatal("CompileSource returned nil result with no errors")
	}
	if result.Model() == nil {
		t.Fatal("CompileResult.Model is nil")
	}
	if len(result.Model().Scenes) != 1 {
		t.Fatalf("expected 1 scene, got %d", len(result.Model().Scenes))
	}
	if result.Model().Scenes[0].Id != "start" {
		t.Fatalf("expected scene id 'start', got %q", result.Model().Scenes[0].Id)
	}
}

func TestCompileSource_parseError(t *testing.T) {
	result, ds := converter.CompileSource("inline.turn", "@@@ not valid turn syntax @@@", "")
	if result != nil {
		t.Fatal("expected nil result for invalid syntax")
	}
	if !ds.HasErrors() {
		t.Fatal("expected errors for invalid syntax")
	}
}

// TestCompileToModelWithSchema verifies that CompileToModelWithSchema produces
// a model identical to CompileSource when given the schema extracted from a
// prior CompileSource call.
func TestCompileToModelWithSchema(t *testing.T) {
	// First pass: full compile to extract schema + order.
	first, ds := converter.CompileSource("inline.turn", simpleTurnSrc, "")
	if ds.HasErrors() {
		t.Fatalf("CompileSource failed: %v", ds)
	}
	schema, order, schemaDiags := converter.ResolveSchema("inline.turn", simpleTurnSrc, "")
	if schemaDiags.HasErrors() {
		t.Fatalf("ResolveSchema failed: %v", schemaDiags)
	}

	// Second pass: compile using the pre-resolved schema — skips state I/O.
	lr, ds2 := converter.CompileToModelWithSchema("inline.turn", simpleTurnSrc, schema, order)
	if ds2.HasErrors() {
		t.Fatalf("CompileToModelWithSchema returned errors: %v", ds2)
	}
	if lr == nil || lr.Model == nil {
		t.Fatal("CompileToModelWithSchema returned nil model")
	}

	// Models must have the same number of scenes and the same scene IDs.
	if len(lr.Model.Scenes) != len(first.Model().Scenes) {
		t.Fatalf("scene count mismatch: got %d, want %d", len(lr.Model.Scenes), len(first.Model().Scenes))
	}
	for i, s := range first.Model().Scenes {
		if lr.Model.Scenes[i].Id != s.Id {
			t.Errorf("scene[%d]: id %q != %q", i, lr.Model.Scenes[i].Id, s.Id)
		}
	}
}

// TestResolveSchema verifies that ResolveSchema returns a non-empty schema and
// order slice for a source that contains a STATE block.
func TestResolveSchema(t *testing.T) {
	schema, order, ds := converter.ResolveSchema("inline.turn", simpleTurnSrc, "")
	if ds.HasErrors() {
		t.Fatalf("ResolveSchema failed: %v", ds)
	}
	if _, ok := schema.Get("ns.count"); !ok {
		t.Error("expected schema to contain ns.count")
	}
	if len(order) == 0 {
		t.Error("expected non-empty schema order slice")
	}
}
