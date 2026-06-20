package converter

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

func TestRecoverInternalPanic(t *testing.T) {
	result := "not reset"
	var ds Diagnostics

	func() {
		defer recoverInternalPanic(&result, &ds)
		panic("boom")
	}()

	if result != "" {
		t.Fatalf("result was not reset: %q", result)
	}
	if !ds.HasErrors() || len(ds) != 1 || ds[0].Code != diag.CodeInternalError {
		t.Fatalf("expected one InternalError diagnostic, got %#v", ds)
	}
	if !bytes.Contains(ds[0].DebugStack, []byte("TestRecoverInternalPanic")) {
		t.Fatalf("internal diagnostic did not retain a stack: %q", ds[0].DebugStack)
	}
}

func TestRecoverSchemaPanic(t *testing.T) {
	var schema Schema
	order := []string{"ns.count"}
	var ds Diagnostics

	func() {
		defer recoverSchemaPanic(&schema, &order, &ds)
		panic("boom")
	}()

	if order != nil {
		t.Fatalf("order was not reset: %#v", order)
	}
	if !ds.HasErrors() || len(ds) != 1 || ds[0].Code != diag.CodeInternalError {
		t.Fatalf("expected one InternalError diagnostic, got %#v", ds)
	}
}

func TestRecoverValidatePanic(t *testing.T) {
	warnings := Diagnostics{diag.Warnf("W", "warning")}
	var errors Diagnostics

	func() {
		defer recoverValidatePanic(&warnings, &errors)
		panic("boom")
	}()

	if warnings != nil {
		t.Fatalf("warnings were not reset: %#v", warnings)
	}
	if !errors.HasErrors() || len(errors) != 1 || errors[0].Code != diag.CodeInternalError {
		t.Fatalf("expected one InternalError diagnostic, got %#v", errors)
	}
}

func TestCompileSourceRejectsOversizedInput(t *testing.T) {
	result, ds := CompileSourceWithOptions("large.turn", "12345", "", Options{Limits: Limits{MaxSourceBytes: 4}})
	if result != nil || !ds.HasErrors() || ds[0].Code != diag.CodeInputTooLarge {
		t.Fatalf("expected InputTooLarge, got result=%v diagnostics=%v", result, ds)
	}
}

func TestCompileRejectsOversizedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large.turn")
	if err := os.WriteFile(path, []byte("12345"), 0o644); err != nil {
		t.Fatal(err)
	}
	result, ds := CompileWithOptions(path, "", Options{Limits: Limits{MaxSourceBytes: 4}})
	if result != nil || !ds.HasErrors() || ds[0].Code != diag.CodeInputTooLarge {
		t.Fatalf("expected InputTooLarge, got result=%v diagnostics=%v", result, ds)
	}
}

func TestRecoverInternalPanicReportsStack(t *testing.T) {
	var result string
	var ds Diagnostics
	var report PanicReport
	func() {
		defer recoverInternalPanicWithReporter(&result, &ds, func(r PanicReport) { report = r })
		panic("reported boom")
	}()
	if report.Value != "reported boom" || !bytes.Contains(report.Stack, []byte("TestRecoverInternalPanicReportsStack")) {
		t.Fatalf("unexpected panic report: value=%v stack=%q", report.Value, report.Stack)
	}
}
