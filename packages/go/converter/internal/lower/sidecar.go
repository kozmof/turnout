package lower

import "github.com/kozmof/turnout/packages/go/converter/internal/ast"

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar — metadata that cannot live in the proto IR
// ─────────────────────────────────────────────────────────────────────────────

// BindingKey uniquely identifies a binding within the model.
// Scope distinguishes the action's main compute prog ("compute") from each
// transition prog ("next:<index>") under the same action.
type BindingKey struct {
	SceneID, ActionID, Scope, ProgName, BindingName string
}

// Sidecar carries DSL metadata that is not part of the proto IR:
//   - Sigil per binding (validator-only)
type Sidecar struct {
	Sigils map[BindingKey]ast.Sigil
}

// newSidecar returns an empty, non-nil Sidecar.
func newSidecar() *Sidecar {
	return &Sidecar{
		Sigils: make(map[BindingKey]ast.Sigil),
	}
}
