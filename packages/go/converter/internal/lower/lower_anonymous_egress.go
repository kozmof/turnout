package lower

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/names"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

// materializeAnonymousEgresses assigns anonymous write-only declarations the
// destination type and a deterministic compiler-reserved binding name before
// ordinary type resolution and inline-IO hoisting inspect the progs.
func materializeAnonymousEgresses(file *ast.TurnFile, schema state.Schema) {
	for _, prog := range allProgs(file) {
		counter := 0
		for _, b := range prog.Bindings {
			if !b.Anonymous {
				continue
			}
			counter++
			b.Name = names.EgressName(counter)
			if b.Egress == nil || b.Egress.Path == "" {
				continue
			}
			meta, ok := schema.Get(b.Egress.Path)
			if !ok {
				// Existing effect validation owns the unresolved-path diagnostic.
				// Use a safe type so lowering can continue without a second error.
				b.Type = ast.FieldTypeStr
				continue
			}
			b.Type = meta.Type
		}
	}
}
