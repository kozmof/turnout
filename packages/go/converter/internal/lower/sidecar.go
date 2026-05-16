package lower

import (
	"fmt"
	"sort"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar — metadata that cannot live in the proto IR
// ─────────────────────────────────────────────────────────────────────────────

// ProgScope is a self-describing key that identifies which prog within an action
// a binding belongs to. The string form is human-readable and stable across
// rule reorderings, making it safe to use as a map key.
type ProgScope string

// ComputeScope returns the ProgScope for the action's main compute prog.
func ComputeScope() ProgScope { return "compute" }

// NextScope returns the ProgScope for the i-th (0-based) next-rule prog.
func NextScope(i int) ProgScope { return ProgScope(fmt.Sprintf("next:%d", i)) }

func (s ProgScope) String() string { return string(s) }

// BindingKey uniquely identifies a binding within the model.
// Scope distinguishes the action's main compute prog from each transition prog.
type BindingKey struct {
	SceneID, ActionID string
	Scope             ProgScope
	ProgName          string
	BindingName       string
}

// sigilAnnotationKey encodes a BindingKey as the canonical map key used in
// TurnModel.Annotations.Sigils.
func sigilAnnotationKey(k BindingKey) string {
	return fmt.Sprintf("%s:%s:%s:%s:%s", k.SceneID, k.ActionID, k.Scope, k.ProgName, k.BindingName)
}

// SigilAnnotationKey is the exported form used by the validate package.
func SigilAnnotationKey(sceneID, actionID string, scope ProgScope, progName, bindingName string) string {
	return sigilAnnotationKey(BindingKey{
		SceneID: sceneID, ActionID: actionID,
		Scope: scope, ProgName: progName, BindingName: bindingName,
	})
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

// ToAnnotations converts the sidecar into a SigilAnnotations proto message
// suitable for embedding in TurnModel.Annotations. Returns nil when empty.
func (s *Sidecar) ToAnnotations() *turnoutpb.SigilAnnotations {
	if len(s.sigils) == 0 {
		return nil
	}
	keys := make([]BindingKey, 0, len(s.sigils))
	for k := range s.sigils {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		return sigilAnnotationKey(keys[i]) < sigilAnnotationKey(keys[j])
	})

	entries := make([]*turnoutpb.SigilAnnotation, 0, len(keys))
	for _, k := range keys {
		entries = append(entries, &turnoutpb.SigilAnnotation{
			SceneId:     k.SceneID,
			ActionId:    k.ActionID,
			Scope:       k.Scope.String(),
			ProgName:    k.ProgName,
			BindingName: k.BindingName,
			Sigil:       int32(s.sigils[k]),
		})
	}
	return &turnoutpb.SigilAnnotations{Entries: entries}
}
