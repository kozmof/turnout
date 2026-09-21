// AUTO-GENERATED. DO NOT EDIT.
// Source of truth: spec/limits.json
// Regenerate: node --experimental-strip-types scripts/gen-limits.ts

// Package limits holds the bounds the compiler and the engine both have to
// agree on. A limit one side chose alone is how a model the compiler accepted
// became one the engine refused to load; spec/limits.json is where they are chosen.
package limits

const (
	// How many nodes a STATE field type may be built from: one per `arr<`,
	// one per `rec<`, and one for the primitive at the bottom.
	//
	// This is the bound both languages hold, and the reason the rest are
	// written down beside it. The engine parses a type into a pool of this
	// many nodes; the compiler refuses a deeper type against the source file
	// it parsed, so the error arrives with a line and column instead of as a
	// model that will not load.
	StateTypeNodes = 128

	// How deeply expressions may nest in source. Unlike the others this
	// bounds a recursive descent rather than a data structure: past it the
	// parser overflows the stack, which is not recoverable into a diagnostic.
	SourceExpressionDepth = 256

	// How deeply a loaded model's JSON may nest.
	ModelNesting = 128

	// How deeply JSON handed across the WASM ABI may nest.
	InputNesting = 128

	// How deeply an authoring compute graph may nest.
	GraphDepth = 256

	// How deeply return-type inference may recurse.
	InferenceDepth = 256
)
