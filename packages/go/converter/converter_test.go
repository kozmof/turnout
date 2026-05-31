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
	if result.Model == nil {
		t.Fatal("CompileResult.Model is nil")
	}
	if len(result.Model.Scenes) != 1 {
		t.Fatalf("expected 1 scene, got %d", len(result.Model.Scenes))
	}
	if result.Model.Scenes[0].Id != "start" {
		t.Fatalf("expected scene id 'start', got %q", result.Model.Scenes[0].Id)
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
