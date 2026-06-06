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
// Returns (nil, errors) when any stage produces errors. On success returns
// (*CompileResult, nil); non-fatal diagnostics are in CompileResult.Warnings.
func Compile(inputPath, stateBasePath string) (*CompileResult, Diagnostics) {
	src, err := os.ReadFile(inputPath)
	if err != nil {
		return nil, Diagnostics{diag.Errorf("IOError", "cannot read %s: %v", inputPath, err)}
	}
	return compileBytes(inputPath, src, stateBasePath)
}

// CompileSource runs parse → state-resolve → lower → validate for an in-memory
// source string. name is used for error messages and to derive the default
// stateBasePath (via filepath.Dir(name)); pass a non-empty stateBasePath to
// override it. Unlike Compile, no file I/O is performed.
func CompileSource(name, src, stateBasePath string) (*CompileResult, Diagnostics) {
	return compileBytes(name, []byte(src), stateBasePath)
}

func compileBytes(name string, src []byte, stateBasePath string) (*CompileResult, Diagnostics) {
	base := stateBasePath
	if base == "" {
		base = filepath.Dir(name)
	}

	turnFile, ds1 := parser.ParseFile(name, string(src))
	if ds1.HasErrors() {
		return nil, ds1
	}

	lr, ds2 := lower.LowerResolvingState(turnFile, base)
	if ds2.HasErrors() {
		return nil, ds2
	}

	ds3 := validate.Validate(lr.Model, lr.Schema, lr.Sidecar)
	if ds3.HasErrors() {
		return nil, ds3
	}

	return &CompileResult{
		Model:    lr.Model,
		Schema:   lr.Schema,
		Warnings: ds3,
	}, nil
}
