// sidecar.go carries per-binding source-position metadata outside the proto IR.
// Sigils are stored directly in ProgModel.Sigils (the proto); positions cannot
// live in the proto and are held here for use by the validator when emitting
// positioned diagnostics.
package lower

import (
	"fmt"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
)

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar — metadata that cannot live in the proto IR
// ─────────────────────────────────────────────────────────────────────────────

// ProgScope is a self-describing key that identifies which prog within an action
// a binding belongs to. The string form is human-readable and stable across
// rule reorderings, making it safe to use as a map key.
//
// Valid forms (produced only by the two factory functions below):
//
//	"compute"   — from ComputeScope()
//	"next:<N>"  — from NextScope(N), where N is a non-negative integer
//
// The unexported field prevents arbitrary ProgScope values from being constructed
// outside this package; all callers must use ComputeScope() or NextScope(i).
type ProgScope struct{ s string }

// ComputeScope returns the ProgScope for the action's main compute prog.
func ComputeScope() ProgScope { return ProgScope{"compute"} }

// NextScope returns the ProgScope for the i-th (0-based) next-rule prog.
func NextScope(i int) ProgScope { return ProgScope{fmt.Sprintf("next:%d", i)} }

func (s ProgScope) String() string { return s.s }

// ParseProgScope validates and parses a ProgScope from a raw string (e.g. from
// a serialised proto annotation). Returns (scope, true) for the two valid forms;
// returns (ProgScope{}, false) for any unrecognised string.
func ParseProgScope(raw string) (ProgScope, bool) {
	if raw == "compute" {
		return ProgScope{raw}, true
	}
	if strings.HasPrefix(raw, "next:") {
		rest := raw[len("next:"):]
		if len(rest) == 0 {
			return ProgScope{}, false
		}
		for _, ch := range rest {
			if ch < '0' || ch > '9' {
				return ProgScope{}, false
			}
		}
		return ProgScope{raw}, true
	}
	return ProgScope{}, false
}

// BindingKey uniquely identifies a binding within the model.
// Scope distinguishes the action's main compute prog from each transition prog.
type BindingKey struct {
	SceneID, ActionID string
	Scope             ProgScope
	ProgName          string
	BindingName       string
}

// bindingKeyString encodes a BindingKey as a flat string map key.
// Format: "sceneID:actionID:scope:progName:bindingName".
// The `:` separator is safe because DSL identifiers are restricted to
// [A-Za-z_][A-Za-z0-9_]* and cannot contain `:`, so keys never collide.
func bindingKeyString(k BindingKey) string {
	return fmt.Sprintf("%s:%s:%s:%s:%s", k.SceneID, k.ActionID, k.Scope, k.ProgName, k.BindingName)
}

// Sidecar carries DSL metadata that cannot live in the proto IR.
// Currently: source positions per binding, used by the validator to emit
// positioned diagnostics for sigil-related errors.
// Sigils are stored directly in ProgModel.Sigils (proto field).
type Sidecar struct {
	positions map[BindingKey]ast.Pos
}

// NewSidecar returns an empty, non-nil Sidecar.
func NewSidecar() *Sidecar {
	return &Sidecar{positions: make(map[BindingKey]ast.Pos)}
}

// newSidecar is the package-internal alias used by Lower().
func newSidecar() *Sidecar { return NewSidecar() }

// SetPos records the source position for the given binding key.
func (s *Sidecar) SetPos(key BindingKey, pos ast.Pos) {
	s.positions[key] = pos
}

// Merge copies all position entries from other into s.
func (s *Sidecar) Merge(other *Sidecar) {
	if other == nil {
		return
	}
	for k, v := range other.positions {
		s.positions[k] = v
	}
}

// PositionIndex is a read-only view of source positions keyed by binding
// identity. It is produced by Sidecar.ToPositionIndex() and consumed by the
// validator to look up positions for positioned diagnostic messages.
type PositionIndex struct {
	m map[string]ast.Pos
}

// EmptyPositionIndex returns a PositionIndex with no entries.
func EmptyPositionIndex() PositionIndex {
	return PositionIndex{m: map[string]ast.Pos{}}
}

// Get returns the source position for the binding identified by the five key
// components. Returns the zero Pos if no position is recorded for that binding.
func (idx PositionIndex) Get(sceneID, actionID string, scope ProgScope, progName, bindingName string) ast.Pos {
	return idx.m[bindingKeyString(BindingKey{
		SceneID:     sceneID,
		ActionID:    actionID,
		Scope:       scope,
		ProgName:    progName,
		BindingName: bindingName,
	})]
}

// ToPositionIndex converts the sidecar into a PositionIndex for O(1) lookup
// during validation.
func (s *Sidecar) ToPositionIndex() PositionIndex {
	if s == nil || len(s.positions) == 0 {
		return EmptyPositionIndex()
	}
	idx := make(map[string]ast.Pos, len(s.positions))
	for k, v := range s.positions {
		idx[bindingKeyString(k)] = v
	}
	return PositionIndex{m: idx}
}
