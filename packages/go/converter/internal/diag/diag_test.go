package diag_test

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
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

// ─────────────────────────────────────────────────────────────────────────────
// DiagSink — cap/halt behaviour
// ─────────────────────────────────────────────────────────────────────────────

func TestDiagSinkIsHaltedStateTransition(t *testing.T) {
	var s diag.DiagSink
	if s.IsHalted() {
		t.Error("new DiagSink should not be halted")
	}
	s.Halt()
	if !s.IsHalted() {
		t.Error("DiagSink should be halted after Halt()")
	}
}

func TestDiagSinkAtCap(t *testing.T) {
	var s diag.DiagSink
	for i := range diag.MaxDiagnostics - 1 {
		s.Append(diag.Errorf("E", "diag %d", i))
	}
	if s.AtCap() {
		t.Errorf("AtCap() should be false at %d entries (cap is %d)", s.Len(), diag.MaxDiagnostics)
	}
	s.Append(diag.Errorf("E", "diag %d", diag.MaxDiagnostics-1))
	if !s.AtCap() {
		t.Errorf("AtCap() should be true at %d entries (cap is %d)", s.Len(), diag.MaxDiagnostics)
	}
}

func TestDiagSinkAppendAtCap(t *testing.T) {
	var s diag.DiagSink
	// Fill to the cap exactly.
	for i := range diag.MaxDiagnostics {
		s.Append(diag.Errorf("E", "diag %d", i))
	}
	if s.Len() != diag.MaxDiagnostics {
		t.Fatalf("expected %d diagnostics before cap trigger, got %d", diag.MaxDiagnostics, s.Len())
	}

	// The next Append should trigger Halt: the new diagnostic is dropped and
	// the TooManyDiagnostics sentinel is appended instead.
	s.Append(diag.Errorf("E", "this should be dropped"))
	if !s.IsHalted() {
		t.Error("DiagSink should be halted after cap exceeded")
	}
	if s.Len() != diag.MaxDiagnostics+1 {
		t.Errorf("expected %d entries (cap + sentinel), got %d", diag.MaxDiagnostics+1, s.Len())
	}
	last := s.Peek()[s.Len()-1]
	if last.Code != diag.CodeTooManyDiagnostics {
		t.Errorf("last diagnostic code = %q, want %q", last.Code, diag.CodeTooManyDiagnostics)
	}
	// The dropped diagnostic must not appear anywhere in the slice.
	for _, d := range s.Peek() {
		if d.Message == "this should be dropped" {
			t.Error("dropped diagnostic must not appear in DiagSink")
		}
	}
}

func TestDiagSinkAppendWhenHalted(t *testing.T) {
	var s diag.DiagSink
	s.Halt()
	before := s.Len()
	s.Append(diag.Errorf("E", "must be dropped"))
	if s.Len() != before {
		t.Errorf("Append after Halt should be a no-op: len was %d, now %d", before, s.Len())
	}
}

func TestDiagSinkHaltSentinelNotDuplicated(t *testing.T) {
	var s diag.DiagSink
	s.Halt()
	count1 := countCode(s.Peek(), diag.CodeTooManyDiagnostics)
	s.Halt()
	count2 := countCode(s.Peek(), diag.CodeTooManyDiagnostics)
	if count1 != 1 {
		t.Errorf("first Halt() should append sentinel once, got %d sentinels", count1)
	}
	if count2 != count1 {
		t.Errorf("second Halt() must not add another sentinel: count went from %d to %d", count1, count2)
	}
}

func TestDiagnosticsCapped(t *testing.T) {
	ds := make(diag.Diagnostics, diag.MaxDiagnostics+10)
	for i := range ds {
		ds[i] = diag.Errorf("E", "diag %d", i)
	}
	capped := ds.Capped()
	want := diag.MaxDiagnostics + 1
	if len(capped) != want {
		t.Errorf("Capped() len = %d, want %d", len(capped), want)
	}
	last := capped[len(capped)-1]
	if last.Code != diag.CodeTooManyDiagnostics {
		t.Errorf("Capped() sentinel code = %q, want %q", last.Code, diag.CodeTooManyDiagnostics)
	}
}

func TestDiagnosticsCappedNoOpWhenUnderLimit(t *testing.T) {
	ds := diag.Diagnostics{diag.Errorf("E", "one"), diag.Errorf("E", "two")}
	capped := ds.Capped()
	if len(capped) != len(ds) {
		t.Errorf("Capped() on under-limit slice: got %d entries, want %d", len(capped), len(ds))
	}
}

func TestDiagSinkFlushPreventsAppend(t *testing.T) {
	var s diag.DiagSink
	s.Append(diag.Errorf("E", "before flush"))
	_ = s.Flush()
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic after Append following Flush, got none")
		}
	}()
	s.Append(diag.Errorf("E", "after flush — should panic"))
}

func countCode(ds diag.Diagnostics, code diag.ErrorCode) int {
	n := 0
	for _, d := range ds {
		if d.Code == code {
			n++
		}
	}
	return n
}
