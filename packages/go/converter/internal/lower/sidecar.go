package lower

import "github.com/kozmof/turnout/packages/go/converter/internal/ast"

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar — metadata that cannot live in the proto IR
// ─────────────────────────────────────────────────────────────────────────────

// BindingKey uniquely identifies a binding within the model.
type BindingKey struct {
	SceneID, ActionID, ProgName, BindingName string
}

// ViewMeta carries the view block data for a scene (HCL authoring-time only,
// never in JSON output).
type ViewMeta struct {
	Name    string
	Flow    string
	Enforce string
}

// ActionMeta carries per-action metadata that is HCL-only (text is stripped
// before JSON emission).
type ActionMeta struct {
	Text *string
}

// SceneMeta carries per-scene metadata that is HCL-only.
type SceneMeta struct {
	View *ViewMeta
}

// Sidecar carries DSL metadata that is not part of the proto IR:
//   - Sigil per binding (validator-only)
//   - View per scene (HCL authoring-time annotation, validator-only)
//   - Text per action (HCL-only, stripped from JSON)
//   - Extended expression trees for #if, #case, #pipe (HCL-only, not in proto)
type Sidecar struct {
	Sigils   map[BindingKey]ast.Sigil
	Actions  map[string]ActionMeta  // key: sceneID + "/" + actionID
	Scenes   map[string]SceneMeta   // key: sceneID
	ExtExprs map[BindingKey]ast.BindingRHS // IfCallRHS | CaseCallRHS | PipeCallRHS
}

// newSidecar returns an empty, non-nil Sidecar.
func newSidecar() *Sidecar {
	return &Sidecar{
		Sigils:   make(map[BindingKey]ast.Sigil),
		Actions:  make(map[string]ActionMeta),
		Scenes:   make(map[string]SceneMeta),
		ExtExprs: make(map[BindingKey]ast.BindingRHS),
	}
}
