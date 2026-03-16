package emit

import (
	"io"

	"github.com/turnout/converter/internal/diag"
	"github.com/turnout/converter/internal/lower"
)

// Emit writes canonical plain HCL to w from the validated lowered Model.
func Emit(w io.Writer, model *lower.Model) diag.Diagnostics {
	// TODO: implement in Phase 8
	panic("emit.Emit: not implemented")
}
