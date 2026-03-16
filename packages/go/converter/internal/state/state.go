package state

import (
	"github.com/turnout/converter/internal/ast"
	"github.com/turnout/converter/internal/diag"
)

// FieldMeta holds the resolved type and default value for a single STATE field.
type FieldMeta struct {
	Type         ast.FieldType
	DefaultValue ast.Literal
}

// Schema is the resolved STATE schema: a flat map from dotted path to FieldMeta.
// Example key: "applicant.income"
type Schema map[string]FieldMeta

// Resolve builds a Schema from a StateSource.
// basePath is the directory of the input .turn file, used to resolve relative state_file paths.
func Resolve(source ast.StateSource, basePath string) (Schema, diag.Diagnostics) {
	// TODO: implement in Phase 5
	panic("state.Resolve: not implemented")
}
