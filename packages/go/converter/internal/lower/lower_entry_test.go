// Tests for the lower package's own entry points.
//
// Lower, LowerResolvingStateContained and LowerResolvingStateContainedWithLimit
// were each at 0% here. They are reached by the converter package's tests, so
// the pipeline was covered — but the package that owns them tested only
// LowerResolvingState, which means the containment entry points had no test
// asserting that they actually contain anything, and the pre-resolved-schema
// entry point had none asserting it uses the schema it is handed.
//
// The containment ones are the reason this matters: a source names the file its
// STATE comes from, so compiling one you did not write reads whatever that file
// names. Containment is what makes that safe, and it is the kind of check that
// fails open when it breaks.
package lower_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

const entryScene = `scene "s" {
  entry_action = a
  action "a" { compute "p" { v:bool := true } }
}`

const entryStateBody = `state {
  app {
    count:number = 0
    label:str    = ""
  }
}`

// parseIn parses src as a file inside dir.
func parseIn(t *testing.T, dir, src string) *ast.TurnFile {
	t.Helper()
	tf, ds := parser.ParseFile(filepath.Join(dir, "test.tu"), src)
	if ds.HasErrors() {
		t.Fatalf("parse: %v", ds)
	}
	return tf
}

// writeFile writes name under dir with the given content.
func writeFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	return path
}

// hasCode reports whether ds contains a diagnostic with the given code.
func hasCode(ds diag.Diagnostics, code diag.ErrorCode) bool {
	for _, d := range ds {
		if d.Code == code {
			return true
		}
	}
	return false
}

// ─── Lower (pre-resolved schema) ──────────────────────────────────────────────

// Lower is the entry point the cached-schema API is built on: the LSP resolves
// the schema once and lowers on every keystroke. The schema it is handed is the
// one it must use — re-resolving would defeat the point, and ignoring it would
// silently lower against an empty one.
func TestLowerUsesTheSuppliedSchema(t *testing.T) {
	src := `state_file = "never-read.tu"
` + entryScene
	tf := parseIn(t, t.TempDir(), src)

	// A schema that could not have come from disk: the file it names is absent.
	schema, order, ds := state.ResolveWithOrder(parseIn(t, t.TempDir(), entryStateBody+"\n"+entryScene).StateSource, ".")
	if ds.HasErrors() {
		t.Fatalf("resolve: %v", ds)
	}

	lr, ds2 := lower.Lower(tf, schema, order)
	if ds2.HasErrors() {
		t.Fatalf("lower: %v", ds2)
	}
	if lr.Model.State == nil || len(lr.Model.State.Namespaces) != 1 {
		t.Fatalf("want the supplied schema's namespace, got %v", lr.Model.State)
	}
	if got := lr.Model.State.Namespaces[0].Name; got != "app" {
		t.Errorf("namespace = %q, want %q", got, "app")
	}
	// The state_file was never opened — it does not exist.
	if len(lr.Model.State.Namespaces[0].Fields) != 2 {
		t.Errorf("fields = %d, want 2", len(lr.Model.State.Namespaces[0].Fields))
	}
}

// ─── containment ──────────────────────────────────────────────────────────────

func TestLowerResolvingStateContainedAcceptsAFileInsideTheBase(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "mystate.tu", entryStateBody)
	tf := parseIn(t, dir, "state_file = \"mystate.tu\"\n"+entryScene)

	lr, ds := lower.LowerResolvingStateContained(tf, dir)
	if ds.HasErrors() {
		t.Fatalf("lower: %v", ds)
	}
	if lr.Model.State == nil || len(lr.Model.State.Namespaces) != 1 {
		t.Fatalf("want 1 namespace, got %v", lr.Model.State)
	}
}

// The check that earns the entry point its existence.
func TestLowerResolvingStateContainedRejectsAFileOutsideTheBase(t *testing.T) {
	root := t.TempDir()
	outside := writeFile(t, root, "outside/secret.tu", entryStateBody)
	base := filepath.Join(root, "base")
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	tf := parseIn(t, base, "state_file = \"../outside/secret.tu\"\n"+entryScene)

	_, ds := lower.LowerResolvingStateContained(tf, base)
	if !hasCode(ds, diag.CodeStateFileOutsideBase) {
		t.Fatalf("escaping state_file %q: want %s, got %v", outside, diag.CodeStateFileOutsideBase, ds)
	}

	// The uncontained entry point reads the same file, which is what makes the
	// contained one worth having rather than a redundant alias.
	if _, dsOpen := lower.LowerResolvingState(tf, base); dsOpen.HasErrors() {
		t.Fatalf("uncontained lower should have read the file: %v", dsOpen)
	}
}

func TestLowerResolvingStateContainedWithLimitRejectsAnOversizeStateFile(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "mystate.tu", entryStateBody)
	tf := parseIn(t, dir, "state_file = \"mystate.tu\"\n"+entryScene)

	_, ds := lower.LowerResolvingStateContainedWithLimit(tf, dir, 8)
	if !hasCode(ds, diag.CodeStateFileTooLarge) {
		t.Fatalf("want %s, got %v", diag.CodeStateFileTooLarge, ds)
	}

	// Generous limit, same file: the limit is what refused it above, not the
	// containment check or the file itself.
	lr, ds2 := lower.LowerResolvingStateContainedWithLimit(tf, dir, 1<<20)
	if ds2.HasErrors() {
		t.Fatalf("lower under a generous limit: %v", ds2)
	}
	if lr.Model.State == nil {
		t.Fatal("want a state block")
	}
}

func TestLowerResolvingStateContainedWithLimitStillContains(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "outside/secret.tu", entryStateBody)
	base := filepath.Join(root, "base")
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	tf := parseIn(t, base, "state_file = \"../outside/secret.tu\"\n"+entryScene)

	// A limit large enough to read the file — so containment is the only thing
	// that can refuse it.
	_, ds := lower.LowerResolvingStateContainedWithLimit(tf, base, 1<<20)
	if !hasCode(ds, diag.CodeStateFileOutsideBase) {
		t.Fatalf("want %s under a generous limit, got %v", diag.CodeStateFileOutsideBase, ds)
	}
}

// A symlink pointing out of the base is the case the lexical check alone misses.
func TestLowerResolvingStateContainedRejectsASymlinkOutOfTheBase(t *testing.T) {
	root := t.TempDir()
	target := writeFile(t, root, "outside/secret.tu", entryStateBody)
	base := filepath.Join(root, "base")
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	link := filepath.Join(base, "mystate.tu")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	tf := parseIn(t, base, "state_file = \"mystate.tu\"\n"+entryScene)

	_, ds := lower.LowerResolvingStateContained(tf, base)
	if !hasCode(ds, diag.CodeStateFileOutsideBase) {
		t.Fatalf("symlinked state_file: want %s, got %v", diag.CodeStateFileOutsideBase, ds)
	}
}

// ─── unresolved from_state path ───────────────────────────────────────────────

// resolveFromState's failure arm: a `<~` clause naming a path the schema does
// not declare. Lowering carries on with a zero value so the rest of the file is
// still checked, which is what makes the diagnostic code the thing to assert on.
func TestLowerReportsAnUndeclaredFromStatePath(t *testing.T) {
	src := entryStateBody + `
scene "s" {
  entry_action = a
  action "a" {
    compute "p" {
      n:number <~ @app.missing
      v:bool := n > 0
    }
  }
}`
	tf := parseIn(t, t.TempDir(), src)
	_, ds := lower.LowerResolvingState(tf, t.TempDir())
	if !hasCode(ds, diag.CodeUnresolvedStatePath) {
		t.Fatalf("want %s, got %v", diag.CodeUnresolvedStatePath, ds)
	}
}
