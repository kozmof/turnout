package validate

import (
	"github.com/turnout/converter/internal/diag"
	"github.com/turnout/converter/internal/lower"
	"github.com/turnout/converter/internal/state"
)

// Validate runs all structural and type validation rules against the lowered Model.
// Returns diagnostics; callers must check HasErrors() before proceeding to emission.
func Validate(model *lower.Model, schema state.Schema) diag.Diagnostics {
	// TODO: implement in Phase 7
	panic("validate.Validate: not implemented")
}
