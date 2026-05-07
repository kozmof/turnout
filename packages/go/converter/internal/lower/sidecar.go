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
	sigils map[BindingKey]ast.Sigil
}

// NewSidecar returns an empty, non-nil Sidecar.
func NewSidecar() *Sidecar {
	return &Sidecar{sigils: make(map[BindingKey]ast.Sigil)}
}

// newSidecar is the package-internal alias used by Lower().
func newSidecar() *Sidecar { return NewSidecar() }

// Set records the sigil for the given binding key.
func (s *Sidecar) Set(key BindingKey, sigil ast.Sigil) {
	s.sigils[key] = sigil
}

// Get returns the sigil for the given binding key, or SigilNone if absent.
func (s *Sidecar) Get(key BindingKey) (ast.Sigil, bool) {
	v, ok := s.sigils[key]
	return v, ok
}

// Merge copies all entries from other into s.
func (s *Sidecar) Merge(other *Sidecar) {
	if other == nil {
		return
	}
	for k, v := range other.sigils {
		s.sigils[k] = v
	}
}
