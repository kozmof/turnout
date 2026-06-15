package converter

import (
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
