package diag_test

import (
	"strings"
	"testing"

	"github.com/turnout/converter/internal/diag"
)

func TestDiagnosticFormatWithFile(t *testing.T) {
	d := diag.Diagnostic{
		Severity: diag.SeverityError,
		Code:     "TestCode",
		Message:  "something went wrong",
		File:     "test.turn",
		Line:     5,
		Col:      10,
	}
	got := d.Format()
	for _, want := range []string{"test.turn", "5", "TestCode", "something went wrong"} {
		if !strings.Contains(got, want) {
			t.Errorf("Format() missing %q in %q", want, got)
		}
	}
}

func TestDiagnosticFormatWithoutFile(t *testing.T) {
	d := diag.Diagnostic{
		Severity: diag.SeverityError,
		Code:     "NoFile",
		Message:  "error without position",
	}
	got := d.Format()
	if !strings.Contains(got, "NoFile") {
		t.Errorf("Format() missing code: %q", got)
	}
	if !strings.Contains(got, "error without position") {
		t.Errorf("Format() missing message: %q", got)
	}
	// Without file, should not start with a filename prefix.
	if strings.HasPrefix(got, ":") {
		t.Errorf("Format() should not start with ':' when no file: %q", got)
	}
}

func TestHasErrorsEmpty(t *testing.T) {
	var ds diag.Diagnostics
	if ds.HasErrors() {
		t.Error("empty Diagnostics.HasErrors() should be false")
	}
}

func TestHasErrorsWithError(t *testing.T) {
	ds := diag.Diagnostics{diag.Errorf("E", "msg")}
	if !ds.HasErrors() {
		t.Error("Diagnostics with error should HasErrors()")
	}
}

func TestHasErrorsWarningOnly(t *testing.T) {
	ds := diag.Diagnostics{
		{Severity: diag.SeverityWarning, Code: "W1", Message: "warn"},
	}
	if ds.HasErrors() {
		t.Error("warning-only Diagnostics.HasErrors() should be false")
	}
}

func TestHasErrorsMixed(t *testing.T) {
	ds := diag.Diagnostics{
		{Severity: diag.SeverityWarning, Code: "W", Message: "warn"},
		diag.Errorf("E", "error"),
	}
	if !ds.HasErrors() {
		t.Error("mixed Diagnostics.HasErrors() should be true")
	}
}

func TestErrorf(t *testing.T) {
	d := diag.Errorf("MyCode", "value is %d", 42)
	if d.Code != "MyCode" {
		t.Errorf("Code = %q, want MyCode", d.Code)
	}
	if d.Message != "value is 42" {
		t.Errorf("Message = %q, want 'value is 42'", d.Message)
	}
	if d.File != "" || d.Line != 0 || d.Col != 0 {
		t.Errorf("Errorf should have no position: file=%q line=%d col=%d", d.File, d.Line, d.Col)
	}
	if d.Severity != diag.SeverityError {
		t.Errorf("Severity = %v, want SeverityError", d.Severity)
	}
}

func TestErrorAt(t *testing.T) {
	d := diag.ErrorAt("foo.turn", 3, 7, "ACode", "at %s", "pos")
	if d.File != "foo.turn" {
		t.Errorf("File = %q, want foo.turn", d.File)
	}
	if d.Line != 3 {
		t.Errorf("Line = %d, want 3", d.Line)
	}
	if d.Col != 7 {
		t.Errorf("Col = %d, want 7", d.Col)
	}
	if d.Code != "ACode" {
		t.Errorf("Code = %q, want ACode", d.Code)
	}
	if d.Message != "at pos" {
		t.Errorf("Message = %q, want 'at pos'", d.Message)
	}
	if d.Severity != diag.SeverityError {
		t.Errorf("Severity should be SeverityError")
	}
}

func TestFormatWithFileMatchesExpected(t *testing.T) {
	d := diag.ErrorAt("src.turn", 1, 2, "Code1", "msg here")
	got := d.Format()
	want := "src.turn:1:2: error [Code1]: msg here"
	if got != want {
		t.Errorf("Format() = %q, want %q", got, want)
	}
}

func TestFormatWithoutFileMatchesExpected(t *testing.T) {
	d := diag.Errorf("Code2", "no file")
	got := d.Format()
	want := "error [Code2]: no file"
	if got != want {
		t.Errorf("Format() = %q, want %q", got, want)
	}
}
