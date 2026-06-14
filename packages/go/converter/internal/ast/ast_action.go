package ast

// ────────────────────────────────────────────────────────────
// Action
// ────────────────────────────────────────────────────────────

// ActionBlock is an `action "<id>" { ... }` block within a scene.
type ActionBlock struct {
	Pos     Pos
	ID      string
	Text    *string      // from triple-quoted docstring or explicit text = "..."
	Compute *ComputeBlock
	Prepare *PrepareBlock
	Merge   *MergeBlock
	Publish *PublishBlock
	Next    []*NextRule
}

// ComputeBlock is the `compute { root = <id> prog "<name>" { ... } }` block.
type ComputeBlock struct {
	Pos  Pos
	Root string
	Prog *ProgBlock
}

// ProgBlock is a `prog "<name>" { ... }` block containing binding declarations.
type ProgBlock struct {
	Pos      Pos
	Name     string
	Bindings []*BindingDecl
}

// BindingDecl is a single binding declaration within a prog block.
// Sigil is SigilNone for plain compute bindings.
type BindingDecl struct {
	Pos   Pos
	Sigil Sigil
	Name  string
	Type  FieldType
	RHS   BindingRHS
}

// ────────────────────────────────────────────────────────────
// Prepare / Merge / Publish
// ────────────────────────────────────────────────────────────

// PrepareBlock is the `prepare { ... }` block of an action.
type PrepareBlock struct {
	Pos     Pos
	Entries []*PrepareEntry
}

// PrepareSource is the common parent of ActionPrepareSource and NextPrepareSource.
// It marks a value as a concrete ingress source of some kind.
// The unexported marker prevents external implementations.
type PrepareSource interface{ prepareSource() }

// ActionPrepareSource is implemented by *FromState and *FromHook.
// *FromLiteral is excluded by design: it is only valid in transition prepare blocks.
// This makes the constraint a compile-time guarantee rather than a runtime check.
type ActionPrepareSource interface {
	PrepareSource
	actionPrepareSource()
}

// PrepareEntry binds a prog binding name to a concrete ingress source.
type PrepareEntry struct {
	Pos         Pos
	BindingName string
	Source      ActionPrepareSource
}

// MergeBlock is the `merge { ... }` block of an action.
type MergeBlock struct {
	Pos     Pos
	Entries []*MergeEntry
}

// MergeEntry maps a prog binding name to a STATE write-back path.
type MergeEntry struct {
	Pos         Pos
	BindingName string
	ToState     string
}

// PublishBlock is the `publish { hook = "<name>" ... }` block of an action.
type PublishBlock struct {
	Pos   Pos
	Hooks []string
}

// ────────────────────────────────────────────────────────────
// Next rules (transitions)
// ────────────────────────────────────────────────────────────

// NextRule is one `next { ... }` block within an action.
type NextRule struct {
	Pos      Pos
	Compute  *NextComputeBlock
	Prepare  *NextPrepareBlock
	ActionID string
}

// NextComputeBlock is the `compute { condition = <id> prog "<name>" { ... } }` inside a next block.
type NextComputeBlock struct {
	Pos       Pos
	Condition string
	Prog      *ProgBlock
}

// NextPrepareBlock is the `prepare { ... }` inside a next block.
type NextPrepareBlock struct {
	Pos     Pos
	Entries []*NextPrepareEntry
}

// NextPrepareSource is implemented by *FromAction, *FromState, and *FromLiteral.
type NextPrepareSource interface {
	PrepareSource
	nextPrepareSource()
}

// NextPrepareEntry binds a binding name to a transition ingress source.
type NextPrepareEntry struct {
	Pos         Pos
	BindingName string
	Source      NextPrepareSource
}

// ────────────────────────────────────────────────────────────
// Shared ingress/egress source types
//
// ActionPrepareSource: *FromState, *FromHook — valid in action-level prepare.
// NextPrepareSource: *FromAction, *FromState, *FromLiteral — valid in transitions.
// FromHook is forbidden in transitions; FromAction and FromLiteral are forbidden
// at action level. These exclusions are enforced by the type system.
// ────────────────────────────────────────────────────────────

// FromState is `from_state = <dotted.path>` — reads a value from STATE.
// Valid in both action-level and transition prepare blocks.
type FromState struct {
	Pos  Pos
	Path string
}

func (*FromState) prepareSource()       {}
func (*FromState) actionPrepareSource() {}
func (*FromState) nextPrepareSource()   {}

// FromHook is `from_hook = "<hookName>"` — reads from a hook result.
// Valid only in action-level prepare (not in transitions).
type FromHook struct {
	Pos      Pos
	HookName string
}

func (*FromHook) prepareSource()       {}
func (*FromHook) actionPrepareSource() {}

// FromLiteral is `from_literal = <value>` — injects a literal value.
// Valid only in transition prepare (not in action-level prepare).
type FromLiteral struct {
	Pos   Pos
	Value Literal
}

func (*FromLiteral) prepareSource()     {}
func (*FromLiteral) nextPrepareSource() {}

// FromAction is `from_action = <binding>` — reads from the action result's binding.
// Valid only in transition prepare.
type FromAction struct {
	Pos         Pos
	BindingName string
}

func (*FromAction) prepareSource()     {}
func (*FromAction) nextPrepareSource() {}
