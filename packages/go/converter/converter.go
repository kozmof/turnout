// Package converter provides the public entry point for the Turn DSL compiler.
// It chains the internal pipeline stages — parse → state-resolve → lower → validate —
// into a single Compile function that callers can use without importing internal packages.
package converter

import (
	"os"
	"path/filepath"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
)

// Diagnostic and Diagnostics are re-exported so callers do not need to import
// internal paths to inspect compile results.
type Diagnostic = diag.Diagnostic
type Diagnostics = diag.Diagnostics

// CompileResult bundles the artifacts of a successful Compile run.
type CompileResult struct {
	// Model is the lowered, validated proto model.
	// Annotations (sigil metadata) are preserved; clear them before calling
	// emit.EmitJSON if they should not appear in the JSON output.
	Model *turnoutpb.TurnModel
	// Schema is the resolved STATE schema, forwarded from the lowering stage.
	Schema state.Schema
	// Warnings holds non-fatal diagnostics (e.g. unused bindings).
	Warnings Diagnostics
}

// Compile runs parse → state-resolve → lower → validate for inputPath.
//
// stateBasePath overrides the directory used to resolve state_file directives.
// Pass "" to default to the directory of inputPath.
//
// Returns (nil, diags) when any stage produces errors; (*CompileResult, warnings)
// on success. The CLI wraps this function and handles output formatting.
func Compile(inputPath, stateBasePath string) (*CompileResult, Diagnostics) {
	src, err := os.ReadFile(inputPath)
	if err != nil {
		return nil, Diagnostics{diag.Errorf("IOError", "cannot read %s: %v", inputPath, err)}
	}

	base := stateBasePath
	if base == "" {
		base = filepath.Dir(inputPath)
	}

	turnFile, ds1 := parser.ParseFile(inputPath, string(src))
	if ds1.HasErrors() {
		return nil, ds1
	}

	lr, ds2 := lower.LowerResolvingState(turnFile, base)
	if ds2.HasErrors() {
		return nil, ds2
	}

	ds3 := validate.Validate(lr.Model, lr.Schema)
	if ds3.HasErrors() {
		return nil, ds3
	}

	return &CompileResult{
		Model:    lr.Model,
		Schema:   lr.Schema,
		Warnings: ds3,
	}, ds3
}
