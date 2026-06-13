package lower

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

// LowerCoreForTest exposes lowerCore for white-box tests that need to supply
// a hand-crafted schema and declaration order.
func LowerCoreForTest(file *ast.TurnFile, schema state.Schema, order []string) (*LowerResult, diag.Diagnostics) {
	return lowerCore(file, schema, order)
}
