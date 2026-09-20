package main

import (
	"flag"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const validTurnSrc = `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}`

func TestBuildVersionReturnsTurnoutPrefix(t *testing.T) {
	v := buildVersion()
	if !strings.HasPrefix(v, "turnout") {
		t.Fatalf("buildVersion() = %q, want prefix 'turnout'", v)
	}
}

func TestSafeRunReturnsExitCode(t *testing.T) {
	got := safeRun(func() int { return 42 })
	if got != 42 {
		t.Fatalf("safeRun = %d, want 42", got)
	}
}

func TestSafeRunRecoversPanic(t *testing.T) {
	var stderr string
	_, stderr, _ = captureProcessIO(t, func() int {
		return safeRun(func() int { panic("boom from test") })
	})
	if !strings.Contains(stderr, "internal error") {
		t.Fatalf("stderr = %q, want 'internal error'", stderr)
	}
}

func TestSafeRunPanicExitCode(t *testing.T) {
	rc := safeRun(func() int { panic("boom") })
	if rc != 2 {
		t.Fatalf("safeRun panic exit code = %d, want 2", rc)
	}
}

func TestRunValidateMissingInput(t *testing.T) {
	_, stderr, rc := captureProcessIO(t, func() int {
		return runValidate(nil)
	})
	if rc != 1 {
		t.Fatalf("runValidate() = %d, want 1", rc)
	}
	if !strings.Contains(stderr, "turnout validate: missing input file") {
		t.Fatalf("stderr = %q, want missing input message", stderr)
	}
}

func TestRunValidateSuccess(t *testing.T) {
	path := writeTempTurnFile(t, validTurnSrc)

	stdout, stderr, rc := captureProcessIO(t, func() int {
		return runValidate([]string{path})
	})

	if rc != 0 {
		t.Fatalf("runValidate() = %d, want 0; stderr: %s", rc, stderr)
	}
	if stdout != "" {
		t.Fatalf("stdout = %q, want empty", stdout)
	}
}

func TestRunValidateInvalidFile(t *testing.T) {
	path := writeTempTurnFile(t, "this is not valid turn syntax @@@")

	_, stderr, rc := captureProcessIO(t, func() int {
		return runValidate([]string{path})
	})

	if rc != 1 {
		t.Fatalf("runValidate() = %d, want 1", rc)
	}
	if !strings.Contains(stderr, "[") {
		t.Fatalf("stderr = %q, want at least one diagnostic", stderr)
	}
}

func TestRunValidateStateFileFlagOverride(t *testing.T) {
	// Validate should accept -state-file even if it points to a non-existent dir;
	// the resulting error is still exit 1 with a diagnostic, not a panic.
	path := writeTempTurnFile(t, validTurnSrc)

	_, _, rc := captureProcessIO(t, func() int {
		return runValidate([]string{"-state-file", t.TempDir(), path})
	})

	// Either success (0) or a diagnostic error (1) is acceptable; a panic (2) is not.
	if rc == 2 {
		t.Fatalf("runValidate() = %d (panic), want 0 or 1", rc)
	}
}

func TestRunConvertSuccessHCLToStdout(t *testing.T) {
	path := writeTempTurnFile(t, validTurnSrc)

	stdout, _, rc := captureProcessIO(t, func() int {
		return runConvert([]string{"-o", "-", path})
	})

	if rc != 0 {
		t.Fatalf("runConvert() = %d, want 0", rc)
	}
	if !strings.Contains(stdout, "state") {
		t.Fatalf("stdout = %q, want HCL output containing 'state'", stdout)
	}
}

func TestRunConvertSuccessJSONToStdout(t *testing.T) {
	path := writeTempTurnFile(t, validTurnSrc)

	stdout, _, rc := captureProcessIO(t, func() int {
		return runConvert([]string{"-o", "-", "-format", "json", path})
	})

	if rc != 0 {
		t.Fatalf("runConvert() = %d, want 0", rc)
	}
	if !strings.Contains(stdout, `"scenes"`) {
		t.Fatalf("stdout = %q, want JSON output containing '\"scenes\"'", stdout)
	}
}

func TestRunConvertAcceptsFlagsAfterInput(t *testing.T) {
	path := writeTempTurnFile(t, validTurnSrc)

	stdout, stderr, rc := captureProcessIO(t, func() int {
		return runConvert([]string{path, "-o", "-", "-format", "json"})
	})

	if rc != 0 {
		t.Fatalf("runConvert() = %d, want 0; stderr: %s", rc, stderr)
	}
	if !strings.Contains(stdout, `"scenes"`) {
		t.Fatalf("stdout = %q, want JSON output", stdout)
	}
}

func TestReorderFlagArgsPreservesSeparator(t *testing.T) {
	fs := flag.NewFlagSet("test", flag.ContinueOnError)
	fs.String("format", "hcl", "")
	got := reorderFlagArgs(fs, []string{"-format", "json", "--", "-input.tu"})
	want := []string{"-format", "json", "--", "-input.tu"}
	if !slices.Equal(got, want) {
		t.Fatalf("reorderFlagArgs() = %q, want %q", got, want)
	}
}

func TestRunConvertPrintsCompileWarnings(t *testing.T) {
	src := `state { ns { v:number = 0 } }
scene "s" {
  entry_action = a
  action "a" { compute "p" { unused:number = 1 r:bool := true } }
}`
	path := writeTempTurnFile(t, src)

	_, stderr, rc := captureProcessIO(t, func() int {
		return runConvert([]string{path, "-o", "-"})
	})

	if rc != 0 {
		t.Fatalf("runConvert() = %d, want 0; stderr: %s", rc, stderr)
	}
	if !strings.Contains(stderr, "[UnusedBinding]") {
		t.Fatalf("stderr = %q, want UnusedBinding warning", stderr)
	}
}

func TestRunConvertFromStdin(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	go func() {
		_, _ = w.WriteString(validTurnSrc)
		_ = w.Close()
	}()

	oldStdin := os.Stdin
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	stdout, stderr, rc := captureProcessIO(t, func() int {
		return runConvert([]string{"-o", "-", "-format", "json", "-"})
	})

	if rc != 0 {
		t.Fatalf("runConvert(stdin) = %d, want 0; stderr: %s", rc, stderr)
	}
	if !strings.Contains(stdout, `"scenes"`) {
		t.Fatalf("stdout = %q, want JSON output containing '\"scenes\"'", stdout)
	}
}

func TestRunConvertFromStdinDefaultsToStdout(t *testing.T) {
	// With "-" input and no -o flag, output should default to stdout rather than
	// trying to write a "-.json" file.
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	go func() {
		_, _ = w.WriteString(validTurnSrc)
		_ = w.Close()
	}()

	oldStdin := os.Stdin
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	stdout, stderr, rc := captureProcessIO(t, func() int {
		return runConvert([]string{"-format", "json", "-"})
	})

	if rc != 0 {
		t.Fatalf("runConvert(stdin, no -o) = %d, want 0; stderr: %s", rc, stderr)
	}
	if !strings.Contains(stdout, `"scenes"`) {
		t.Fatalf("stdout = %q, want JSON output containing '\"scenes\"'", stdout)
	}
}

func TestRunConvertSuccessToFile(t *testing.T) {
	path := writeTempTurnFile(t, validTurnSrc)
	outPath := path + ".json"

	_, _, rc := captureProcessIO(t, func() int {
		return runConvert([]string{"-o", outPath, "-format", "json", path})
	})

	if rc != 0 {
		t.Fatalf("runConvert() = %d, want 0", rc)
	}
	data, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("ReadFile(%q): %v", outPath, err)
	}
	if !strings.Contains(string(data), `"scenes"`) {
		t.Fatalf("output = %q, want JSON containing '\"scenes\"'", string(data))
	}
}

func TestRunConvertDefaultOutputExtensionHCL(t *testing.T) {
	path := writeTempTurnFile(t, validTurnSrc)
	expectedOut := strings.TrimSuffix(path, ".tu") + ".hcl"

	_, _, rc := captureProcessIO(t, func() int {
		return runConvert([]string{path})
	})

	if rc != 0 {
		t.Fatalf("runConvert() = %d, want 0", rc)
	}
	if _, err := os.Stat(expectedOut); err != nil {
		t.Fatalf("expected output file %q not found: %v", expectedOut, err)
	}
}

func TestRunConvertRejectsOversizedStdin(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	go func() { _, _ = w.WriteString("12345"); _ = w.Close() }()
	oldStdin := os.Stdin
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()
	_, stderr, rc := captureProcessIO(t, func() int {
		return runConvert([]string{"-o", "-", "-max-source-bytes", "4", "-"})
	})
	if rc != 1 || !strings.Contains(stderr, "exceeds the 4-byte source limit") {
		t.Fatalf("rc=%d stderr=%q", rc, stderr)
	}
}

// A .tu file names the file its STATE comes from, so compiling one you did not
// write is an arbitrary read unless the resolution is contained. The Go API has
// always been able to contain it; until -contain-state-file the CLI could only
// ask for it as a side effect of overriding the base directory, which is not
// the same request and does not cover the default base at all.
func TestRunValidateContainStateFileRejectsEscape(t *testing.T) {
	dir := t.TempDir()
	secret := filepath.Join(filepath.Dir(dir), "outside-schema.tu")
	if err := os.WriteFile(secret, []byte("state { ns { v:number = 0 } }"), 0o600); err != nil {
		t.Fatalf("write outside schema: %v", err)
	}
	t.Cleanup(func() { os.Remove(secret) })

	src := "state_file = \"../outside-schema.tu\"\n" + `
scene "s" {
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}`
	path := filepath.Join(dir, "flow.tu")
	if err := os.WriteFile(path, []byte(src), 0o600); err != nil {
		t.Fatalf("write flow: %v", err)
	}

	_, stderr, rc := captureProcessIO(t, func() int {
		return runValidate([]string{"-contain-state-file", path})
	})
	if rc != 1 {
		t.Fatalf("runValidate(-contain-state-file) = %d, want 1; stderr: %s", rc, stderr)
	}
	if !strings.Contains(stderr, "StateFileOutsideBase") {
		t.Fatalf("stderr = %q, want a StateFileOutsideBase diagnostic", stderr)
	}

	// Without the flag the same source still reads the file outside the base,
	// which is the documented default and what the flag exists to opt out of.
	_, stderr, rc = captureProcessIO(t, func() int {
		return runValidate([]string{path})
	})
	if rc != 0 {
		t.Fatalf("runValidate() = %d, want 0; stderr: %s", rc, stderr)
	}
}

func TestRunConvertContainStateFileRejectsEscape(t *testing.T) {
	dir := t.TempDir()
	secret := filepath.Join(filepath.Dir(dir), "outside-convert-schema.tu")
	if err := os.WriteFile(secret, []byte("state { ns { v:number = 0 } }"), 0o600); err != nil {
		t.Fatalf("write outside schema: %v", err)
	}
	t.Cleanup(func() { os.Remove(secret) })

	src := "state_file = \"../outside-convert-schema.tu\"\n" + `
scene "s" {
  entry_action = a
  action "a" { compute "p" { r:bool := true } }
}`
	path := filepath.Join(dir, "flow.tu")
	if err := os.WriteFile(path, []byte(src), 0o600); err != nil {
		t.Fatalf("write flow: %v", err)
	}

	_, stderr, rc := captureProcessIO(t, func() int {
		return runConvert([]string{"-contain-state-file", "-o", "-", path})
	})
	if rc != 1 {
		t.Fatalf("runConvert(-contain-state-file) = %d, want 1; stderr: %s", rc, stderr)
	}
	if !strings.Contains(stderr, "StateFileOutsideBase") {
		t.Fatalf("stderr = %q, want a StateFileOutsideBase diagnostic", stderr)
	}
}
