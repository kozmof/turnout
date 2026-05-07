package lower

import (
	"fmt"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
)

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar — metadata that cannot live in the proto IR
// ─────────────────────────────────────────────────────────────────────────────

// ProgScope distinguishes the action's main compute prog from each transition prog.
type ProgScope struct {
	IsNext    bool
	NextIndex int // meaningful only when IsNext == true
}

// ComputeScope returns the ProgScope for a compute prog.
func ComputeScope() ProgScope { return ProgScope{} }

// NextScope returns the ProgScope for the i-th next-rule prog.
func NextScope(i int) ProgScope { return ProgScope{IsNext: true, NextIndex: i} }

func (s ProgScope) String() string {
	if !s.IsNext {
		return "compute"
	}
	return fmt.Sprintf("next:%d", s.NextIndex)
}

// BindingKey uniquely identifies a binding within the model.
// Scope distinguishes the action's main compute prog from each transition prog.
type BindingKey struct {
	SceneID, ActionID string
	Scope             ProgScope
	ProgName          string
	BindingName       string
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
