package main

import (
	"os"
	"strings"
	"testing"
)

const validTurnSrc = `state { ns { v:number = 0 } }
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = "r" prog "p" { r:bool = true } } }
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
	expectedOut := strings.TrimSuffix(path, ".turn") + ".hcl"

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
