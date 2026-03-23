package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

func TestRunConvertLexDiagnosticBurstIsCapped(t *testing.T) {
	path := writeTempTurnFile(t, strings.Repeat("@", 5000))

	stdout, stderr, rc := captureProcessIO(t, func() int {
		return runConvert([]string{path, "-o", "-", "-format", "json"})
	})

	if rc != 1 {
		t.Fatalf("runConvert() = %d, want 1", rc)
	}
	if stdout != "" {
		t.Fatalf("stdout = %q, want empty", stdout)
	}

	lines := splitNonEmptyLines(stderr)
	if len(lines) != 101 {
		t.Fatalf("stderr lines = %d, want 101\nstderr:\n%s", len(lines), stderr)
	}
	if !strings.Contains(lines[0], "[LexError]") {
		t.Fatalf("first stderr line = %q, want LexError", lines[0])
	}
	if !strings.Contains(lines[len(lines)-1], "[TooManyDiagnostics]") {
		t.Fatalf("last stderr line = %q, want TooManyDiagnostics", lines[len(lines)-1])
	}
}

func TestRunConvertParseDiagnosticBurstIsCapped(t *testing.T) {
	var sb strings.Builder
	for range 1000 {
		sb.WriteString("foo\n")
	}
	path := writeTempTurnFile(t, sb.String())

	stdout, stderr, rc := captureProcessIO(t, func() int {
		return runConvert([]string{path, "-o", "-", "-format", "json"})
	})

	if rc != 1 {
		t.Fatalf("runConvert() = %d, want 1", rc)
	}
	if stdout != "" {
		t.Fatalf("stdout = %q, want empty", stdout)
	}

	lines := splitNonEmptyLines(stderr)
	if len(lines) != 101 {
		t.Fatalf("stderr lines = %d, want 101\nstderr:\n%s", len(lines), stderr)
	}
	if !strings.Contains(lines[0], "[ParseSyntaxError]") {
		t.Fatalf("first stderr line = %q, want ParseSyntaxError", lines[0])
	}
	if !strings.Contains(lines[len(lines)-1], "[TooManyDiagnostics]") {
		t.Fatalf("last stderr line = %q, want TooManyDiagnostics", lines[len(lines)-1])
	}
}

func TestRunConvertUnterminatedTripleQuoteReturnsLexError(t *testing.T) {
	path := writeTempTurnFile(t, "\"\"\"\nopen")

	stdout, stderr, rc := captureProcessIO(t, func() int {
		return runConvert([]string{path, "-o", "-", "-format", "json"})
	})

	if rc != 1 {
		t.Fatalf("runConvert() = %d, want 1", rc)
	}
	if stdout != "" {
		t.Fatalf("stdout = %q, want empty", stdout)
	}
	if !strings.Contains(stderr, "[LexError]") {
		t.Fatalf("stderr = %q, want LexError", stderr)
	}
	if !strings.Contains(stderr, "unterminated triple-quoted string") {
		t.Fatalf("stderr = %q, want unterminated triple-quoted string", stderr)
	}
}

func TestRunConvertMissingInput(t *testing.T) {
	stdout, stderr, rc := captureProcessIO(t, func() int {
		return runConvert(nil)
	})

	if rc != 1 {
		t.Fatalf("runConvert() = %d, want 1", rc)
	}
	if stdout != "" {
		t.Fatalf("stdout = %q, want empty", stdout)
	}
	if !strings.Contains(stderr, "turnout convert: missing input file") {
		t.Fatalf("stderr = %q, want missing input message", stderr)
	}
}

func TestRunConvertUnknownFormat(t *testing.T) {
	path := writeTempTurnFile(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}`)

	stdout, stderr, rc := captureProcessIO(t, func() int {
		return runConvert([]string{"-o", "-", "-format", "yaml", path})
	})

	if rc != 1 {
		t.Fatalf("runConvert() = %d, want 1", rc)
	}
	if stdout != "" {
		t.Fatalf("stdout = %q, want empty", stdout)
	}
	if !strings.Contains(stderr, `turnout: unknown format "yaml"`) {
		t.Fatalf("stderr = %q, want unknown format message", stderr)
	}
}

func TestRunConvertCreateFailure(t *testing.T) {
	path := writeTempTurnFile(t, `state { ns { v:number = 0 } }
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = r prog "p" { r:bool = true } } }
}`)
	outPath := filepath.Join(t.TempDir(), "missing", "out.json")

	stdout, stderr, rc := captureProcessIO(t, func() int {
		return runConvert([]string{"-o", outPath, "-format", "json", path})
	})

	if rc != 1 {
		t.Fatalf("runConvert() = %d, want 1", rc)
	}
	if stdout != "" {
		t.Fatalf("stdout = %q, want empty", stdout)
	}
	if !strings.Contains(stderr, "turnout: cannot create") {
		t.Fatalf("stderr = %q, want create failure message", stderr)
	}
}

func TestPrintDiagsWritesOneLinePerDiagnostic(t *testing.T) {
	stdout, stderr, _ := captureProcessIO(t, func() int {
		printDiags(diag.Diagnostics{
			diag.ErrorAt("a.turn", 1, 2, "Code1", "first"),
			diag.Errorf("Code2", "second"),
		})
		return 0
	})

	if stdout != "" {
		t.Fatalf("stdout = %q, want empty", stdout)
	}
	lines := splitNonEmptyLines(stderr)
	if len(lines) != 2 {
		t.Fatalf("stderr lines = %d, want 2\nstderr:\n%s", len(lines), stderr)
	}
	if !strings.Contains(lines[0], "a.turn:1:2: error [Code1]: first") {
		t.Fatalf("first line = %q", lines[0])
	}
	if !strings.Contains(lines[1], "error [Code2]: second") {
		t.Fatalf("second line = %q", lines[1])
	}
}

func writeTempTurnFile(t *testing.T, src string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "bad.turn")
	if err := os.WriteFile(path, []byte(src), 0o644); err != nil {
		t.Fatalf("WriteFile(%q): %v", path, err)
	}
	return path
}

func captureProcessIO(t *testing.T, fn func() int) (string, string, int) {
	t.Helper()

	oldStdout := os.Stdout
	oldStderr := os.Stderr

	rOut, wOut, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe stdout: %v", err)
	}
	rErr, wErr, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe stderr: %v", err)
	}

	os.Stdout = wOut
	os.Stderr = wErr
	defer func() {
		os.Stdout = oldStdout
		os.Stderr = oldStderr
	}()

	outCh := make(chan string, 1)
	errCh := make(chan string, 1)
	go func() { outCh <- readAllFromPipe(rOut) }()
	go func() { errCh <- readAllFromPipe(rErr) }()

	rc := fn()

	_ = wOut.Close()
	_ = wErr.Close()

	stdout := <-outCh
	stderr := <-errCh

	return stdout, stderr, rc
}

func readAllFromPipe(r *os.File) string {
	defer r.Close()

	var buf bytes.Buffer
	_, _ = io.Copy(&buf, r)
	return buf.String()
}

func splitNonEmptyLines(s string) []string {
	raw := strings.Split(strings.TrimSpace(s), "\n")
	out := make([]string, 0, len(raw))
	for _, line := range raw {
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}
