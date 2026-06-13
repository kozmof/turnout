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

// WriteHCL writes canonical HCL to w and returns any emit diagnostics.
func (r *CompileResult) WriteHCL(w io.Writer) Diagnostics {
	return emit.Emit(w, r.Model)
}

// WriteJSON writes JSON to w and returns any emit diagnostics.
// Returns a non-nil Diagnostics slice on failure, matching the WriteHCL contract.
func (r *CompileResult) WriteJSON(w io.Writer) Diagnostics {
	if err := emit.EmitJSON(w, r.Model); err != nil {
		return Diagnostics{diag.Errorf(diag.CodeEmitIOError, "JSON emit failed: %v", err)}
	}
	return nil
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
	return lr, ds2
}

// ResolveSchema parses name/src and resolves the STATE schema, returning it
// alongside its declaration order. The order slice can be passed directly to
// CompileToModelWithSchema, allowing callers (e.g. LSP, incremental checkers)
// to resolve the schema once and re-use it across many compile calls without
// paying the state_file I/O cost each time.
//
// name and stateBasePath follow the same conventions as CompileSource.
func ResolveSchema(name, src, stateBasePath string) (Schema, []string, Diagnostics) {
	base := stateBasePath
	if base == "" {
		base = filepath.Dir(name)
	}
	turnFile, ds1 := parser.ParseFile(name, src)
	if ds1.HasErrors() {
		return Schema{}, nil, ds1
	}
	schema, order, ds2 := state.ResolveWithOrder(turnFile.StateSource, base)
	return schema, order, ds2
}

// CompileToModelWithSchema is like CompileToModel but accepts a pre-resolved
// schema and its declaration order (from ResolveSchema or a prior CompileSource
// call), skipping state_file I/O entirely. Useful for LSP and incremental
// tooling that compiles the same file repeatedly as the user edits.
//
// schema and order must have been produced from the same state source as the
// STATE block in src; passing a stale or mismatched schema yields incorrect
// lowering without an error.
func CompileToModelWithSchema(name, src string, schema Schema, order []string) (*LowerResult, Diagnostics) {
	turnFile, ds1 := parser.ParseFile(name, src)
	if ds1.HasErrors() {
		return nil, ds1
	}
	lr, ds2 := lower.Lower(turnFile, schema, order)
	if ds2.HasErrors() {
		return nil, ds2
	}
	return lr, ds2
}

// runStage appends warnings from ds into acc and reports whether the stage
// succeeded (no errors). On failure it appends the errors too and returns false,
// signalling compileBytes to short-circuit with the accumulated slice.
func runStage(acc Diagnostics, ds Diagnostics) (Diagnostics, bool) {
	acc = append(acc, ds.Warnings()...)
	if ds.HasErrors() {
		return append(acc, ds.Errors()...), false
	}
	return acc, true
}

func compileBytes(name string, src []byte, stateBasePath string) (*CompileResult, Diagnostics) {
	base := stateBasePath
	if base == "" {
		base = filepath.Dir(name)
	}

	var accumulated Diagnostics
	var ok bool

	turnFile, ds1 := parser.ParseFile(name, string(src))
	if accumulated, ok = runStage(accumulated, ds1); !ok {
		return nil, accumulated
	}

	lr, ds2 := lower.LowerResolvingState(turnFile, base)
	if accumulated, ok = runStage(accumulated, ds2); !ok {
		return nil, accumulated
	}

	ds3 := validate.Validate(validate.ValidateInput{Model: lr.Model, Schema: lr.Schema})
	if accumulated, ok = runStage(accumulated, ds3); !ok {
		return nil, accumulated
	}

	lr.Validated = true
	return &CompileResult{
		Model:    lr.Model,
		Schema:   lr.Schema,
		Warnings: accumulated,
	}, nil
}
