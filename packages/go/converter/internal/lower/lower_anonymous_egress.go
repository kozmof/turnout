package lower

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/names"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

// materializeAnonymousEgresses assigns anonymous write-only declarations the
// destination type and a deterministic compiler-reserved binding name before
// ordinary type resolution and inline-IO hoisting inspect the progs.
//
// A trailing anonymous egress the parser promoted to the compute result arrives
// already named (names.GeneratedResultName): compute.root is derived from a name
// at parse time, so that one cannot wait until here. It still needs its
// destination type, and it stays out of the positional __egress_N sequence — it is
// always last, so skipping it shifts none of the other numbers.
func materializeAnonymousEgresses(file *ast.TurnFile, schema state.Schema) {
	for _, prog := range allProgs(file) {
		counter := 0
		for _, b := range prog.Bindings {
			if !b.Anonymous {
				continue
			}
			if b.Marker == ast.MarkerNone {
				counter++
				b.Name = names.EgressName(counter)
			}
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
