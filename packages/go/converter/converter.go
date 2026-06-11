// Package converter provides the public entry point for the Turn DSL compiler.
// It chains the internal pipeline stages — parse → state-resolve → lower → validate —
// into a single Compile function that callers can use without importing internal packages.
package converter

import (
	"io"
	"os"
	"path/filepath"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit"
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

// Schema and FieldMeta are re-exported so callers can use CompileResult.Schema
// without importing the internal state package.
type Schema = state.Schema
type FieldMeta = state.FieldMeta

// LowerResult is re-exported from the internal lower package so callers can
// use CompileToModel without importing internal paths.
type LowerResult = lower.LowerResult

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

// CompileToModel runs parse → state-resolve → lower for an in-memory source
// string, stopping before the validate and emit stages. This is the entry point
// for tooling (LSP, incremental checkers) that needs the lowered proto model
// without the cost of full validation. name and stateBasePath follow the same
// conventions as CompileSource.
//
// Returns (nil, errors) when parse or lower fails. On success the returned
// *LowerResult contains Model and Schema; non-fatal diagnostics (e.g. unused
// bindings surfaced by the lowerer) are not included since validation is skipped.
func CompileToModel(name, src, stateBasePath string) (*LowerResult, Diagnostics) {
	base := stateBasePath
	if base == "" {
		base = filepath.Dir(name)
	}
	turnFile, ds1 := parser.ParseFile(name, src)
	if ds1.HasErrors() {
		return nil, ds1
	}
	lr, ds2 := lower.LowerResolvingState(turnFile, base)
	if ds2.HasErrors() {
		return nil, ds2
	}
	return lr, nil
}

// CompileToHCL runs the full pipeline and writes canonical HCL to w.
// On success it returns the CompileResult alongside any warnings; on error it
// returns nil and the error diagnostics without writing to w.
func CompileToHCL(w io.Writer, inputPath, stateBasePath string) (*CompileResult, Diagnostics) {
	result, ds := Compile(inputPath, stateBasePath)
	return compileAndWrite(w, result, ds, emitHCLFn)
}

// CompileToJSON runs the full pipeline and writes JSON to w.
// On success it returns the CompileResult alongside any warnings; on error it
// returns nil and the error diagnostics without writing to w.
func CompileToJSON(w io.Writer, inputPath, stateBasePath string) (*CompileResult, Diagnostics) {
	result, ds := Compile(inputPath, stateBasePath)
	return compileAndWrite(w, result, ds, emitJSONFn)
}

// CompileSourceToHCL is the in-memory equivalent of CompileToHCL.
func CompileSourceToHCL(w io.Writer, name, src, stateBasePath string) (*CompileResult, Diagnostics) {
	result, ds := CompileSource(name, src, stateBasePath)
	return compileAndWrite(w, result, ds, emitHCLFn)
}

// CompileSourceToJSON is the in-memory equivalent of CompileToJSON.
func CompileSourceToJSON(w io.Writer, name, src, stateBasePath string) (*CompileResult, Diagnostics) {
	result, ds := CompileSource(name, src, stateBasePath)
	return compileAndWrite(w, result, ds, emitJSONFn)
}

type emitFn func(io.Writer, *turnoutpb.TurnModel) Diagnostics

func compileAndWrite(w io.Writer, result *CompileResult, ds Diagnostics, fn emitFn) (*CompileResult, Diagnostics) {
	if ds.HasErrors() {
		return nil, ds
	}
	emitDs := fn(w, result.Model)
	return result, append(ds, emitDs...)
}

func emitHCLFn(w io.Writer, m *turnoutpb.TurnModel) Diagnostics {
	return emit.Emit(w, m)
}

func emitJSONFn(w io.Writer, m *turnoutpb.TurnModel) Diagnostics {
	if err := emit.EmitJSON(w, m); err != nil {
		return Diagnostics{diag.Errorf(diag.CodeEmitIOError, "json emit failed: %v", err)}
	}
	return nil
}

func compileBytes(name string, src []byte, stateBasePath string) (*CompileResult, Diagnostics) {
	base := stateBasePath
	if base == "" {
		base = filepath.Dir(name)
	}

	var accumulated Diagnostics

	turnFile, ds1 := parser.ParseFile(name, string(src))
	accumulated = append(accumulated, ds1.Warnings()...)
	if ds1.HasErrors() {
		return nil, append(accumulated, ds1.Errors()...)
	}

	lr, ds2 := lower.LowerResolvingState(turnFile, base)
	accumulated = append(accumulated, ds2.Warnings()...)
	if ds2.HasErrors() {
		return nil, append(accumulated, ds2.Errors()...)
	}

	ds3 := validate.Validate(validate.ValidateInput{Model: lr.Model, Schema: lr.Schema})
	if ds3.HasErrors() {
		return nil, append(accumulated, ds3...)
	}

	return &CompileResult{
		Model:    lr.Model,
		Schema:   lr.Schema,
		Warnings: append(accumulated, ds3...),
	}, nil
}
