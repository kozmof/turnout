package lower

import (
	"github.com/turnout/converter/internal/ast"
	"github.com/turnout/converter/internal/diag"
	"github.com/turnout/converter/internal/state"
)

// Model is the lowered canonical HCL representation, ready for validation and emission.
// Fields will be defined in Phase 6 as the lowering rules are implemented.
type Model struct {
	// TODO: define in Phase 6
}

// Lower converts a parsed TurnFile and resolved STATE schema to a canonical HCL Model.
func Lower(file *ast.TurnFile, schema state.Schema) (*Model, diag.Diagnostics) {
	// TODO: implement in Phase 6
	panic("lower.Lower: not implemented")
}
