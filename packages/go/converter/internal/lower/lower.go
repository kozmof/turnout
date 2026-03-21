// Package lower lowers a parsed TurnFile AST to the canonical HCL model (Model),
// ready for validation and emission. No text is produced here; the emitter (Phase 8)
// converts Model to HCL text.
package lower

import (
	"sort"
	"strings"

	"github.com/turnout/converter/internal/ast"
	"github.com/turnout/converter/internal/diag"
	"github.com/turnout/converter/internal/state"
)

// ─────────────────────────────────────────────────────────────────────────────
// Model — top-level canonical HCL representation
// ─────────────────────────────────────────────────────────────────────────────

// Model is the lowered canonical HCL representation, ready for validation and emission.
type Model struct {
	State  *HCLStateBlock
	Scene  *HCLSceneBlock
	Routes []*HCLRouteBlock
}

// ─────────────────────────────────────────────────────────────────────────────
// Route block types
// ─────────────────────────────────────────────────────────────────────────────

// HCLRouteBlock corresponds to `route "<id>" { match { ... } }`.
type HCLRouteBlock struct {
	ID   string
	Arms []*HCLMatchArm
}

// HCLMatchArm is one arm of a match block.
// Patterns holds the string representation of each OR-branch ("_" for fallback).
type HCLMatchArm struct {
	Patterns []string
	Target   string
}

// ─────────────────────────────────────────────────────────────────────────────
// State block types
// ─────────────────────────────────────────────────────────────────────────────

// HCLStateBlock corresponds to the top-level `state { ... }` HCL block.
type HCLStateBlock struct {
	Namespaces []*HCLNamespace
}

// HCLNamespace corresponds to `namespace "<name>" { ... }` inside a state block.
type HCLNamespace struct {
	Name   string
	Fields []*HCLStateField
}

// HCLStateField corresponds to `field "<name>" { type = "..." value = ... }`.
type HCLStateField struct {
	Name    string
	Type    ast.FieldType
	Default ast.Literal
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene / Action types
// ─────────────────────────────────────────────────────────────────────────────

// HCLSceneBlock corresponds to `scene "<id>" { ... }`.
type HCLSceneBlock struct {
	ID           string
	EntryActions []string
	NextPolicy   string // "" means omit from output
	Actions      []*HCLAction
}

// HCLAction corresponds to `action "<id>" { ... }` inside a scene.
type HCLAction struct {
	ID      string
	Text    *string      // nil = omit; emitter renders as text = <<-EOT ... EOT
	Compute *HCLCompute
	Prepare *HCLPrepare  // nil = omit
	Merge   *HCLMerge    // nil = omit
	Publish *HCLPublish  // nil = omit
	Next    []*HCLNextRule
}

// HCLCompute corresponds to `compute { root = "..." prog "..." { ... } }`.
type HCLCompute struct {
	Root string
	Prog *HCLProg
}

// HCLProg corresponds to `prog "<name>" { ... }` containing binding blocks.
type HCLProg struct {
	Name     string
	Bindings []*HCLBinding
}

// ─────────────────────────────────────────────────────────────────────────────
// Binding types
// ─────────────────────────────────────────────────────────────────────────────

// HCLBinding corresponds to `binding "<name>" { type = "..." value/expr = ... }`.
// Exactly one of Value or Expr is non-nil.
// Sigil carries the original DSL direction marker for validator use; the emitter ignores it.
type HCLBinding struct {
	Name  string
	Type  ast.FieldType
	Sigil ast.Sigil   // SigilNone for plain bindings; validator uses this for prepare/merge checks
	Value ast.Literal // non-nil for value bindings
	Expr  *HCLExpr    // non-nil for function bindings
}

// HCLExpr is the `expr = { ... }` block. Exactly one inner field is non-nil.
type HCLExpr struct {
	Combine *HCLCombine
	Pipe    *HCLPipe
	Cond    *HCLCond
}

// HCLCombine corresponds to `combine = { fn = "..." args = [...] }`.
type HCLCombine struct {
	Fn   string
	Args []*HCLArg
}

// HCLPipe corresponds to `pipe = { args = { ... } steps = [...] }`.
type HCLPipe struct {
	Params []*HCLPipeParam
	Steps  []*HCLPipeStep
}

// HCLPipeParam is one `paramName = ref(sourceIdent)` entry in the pipe args object.
type HCLPipeParam struct {
	ParamName   string
	SourceIdent string
}

// HCLPipeStep is one step inside a pipe step list.
type HCLPipeStep struct {
	Fn   string
	Args []*HCLArg
}

// HCLCond corresponds to `cond = { condition = {...} then = {...} else = {...} }`.
type HCLCond struct {
	Condition *HCLArg
	Then      *HCLArg
	Else      *HCLArg
}

// HCLArg is a discriminated-union argument value. Exactly one field is non-zero.
// IsStepRef distinguishes StepRef=0 (valid) from "no step ref" (zero value).
type HCLArg struct {
	Ref       string       // { ref = "name" }
	Lit       ast.Literal  // { lit = <literal> }
	FuncRef   string       // { func_ref = "name" }
	StepRef   int          // { step_ref = N }
	IsStepRef bool         // true when StepRef form is used (disambiguates N=0)
	Transform *HCLTransform // { transform = { ref fn } }
}

// HCLTransform corresponds to `transform = { ref = "v" fn = "transformFn..." }`.
type HCLTransform struct {
	Ref string
	Fn  string
}

// ─────────────────────────────────────────────────────────────────────────────
// Prepare / Merge / Publish types
// ─────────────────────────────────────────────────────────────────────────────

// HCLPrepare corresponds to the action-level `prepare { ... }` block.
type HCLPrepare struct {
	Entries []*HCLPrepareEntry
}

// HCLPrepareEntry is one binding entry inside an action-level prepare block.
// Exactly one of FromState / FromHook is non-empty.
type HCLPrepareEntry struct {
	BindingName string
	FromState   string // dotted path; "" if not used
	FromHook    string // hook name; "" if not used
}

// HCLMerge corresponds to the `merge { ... }` block.
type HCLMerge struct {
	Entries []*HCLMergeEntry
}

// HCLMergeEntry is one binding entry inside a merge block.
type HCLMergeEntry struct {
	BindingName string
	ToState     string
}

// HCLPublish corresponds to the `publish { hook = "..." ... }` block.
type HCLPublish struct {
	Hooks []string
}

// ─────────────────────────────────────────────────────────────────────────────
// Next rule types
// ─────────────────────────────────────────────────────────────────────────────

// HCLNextRule corresponds to a `next { ... }` block inside an action.
type HCLNextRule struct {
	Compute *HCLNextCompute
	Prepare *HCLNextPrepare // nil = omit
	Action  string
}

// HCLNextCompute corresponds to `compute { condition = "..." prog "..." { ... } }` inside next.
type HCLNextCompute struct {
	Condition string
	Prog      *HCLProg
}

// HCLNextPrepare corresponds to the `prepare { ... }` block inside a next rule.
type HCLNextPrepare struct {
	Entries []*HCLNextPrepareEntry
}

// HCLNextPrepareEntry is one binding entry inside a transition prepare block.
// Exactly one of FromAction / FromState / FromLiteral is non-zero.
type HCLNextPrepareEntry struct {
	BindingName string
	FromAction  string      // source binding name; "" if not used
	FromState   string      // dotted path; "" if not used
	FromLiteral ast.Literal // non-nil if from_literal form used
}

// ─────────────────────────────────────────────────────────────────────────────
// Lower — entry point
// ─────────────────────────────────────────────────────────────────────────────

// Lower converts a parsed TurnFile and resolved STATE schema to a canonical HCL Model.
func Lower(file *ast.TurnFile, schema state.Schema) (*Model, diag.Diagnostics) {
	var ds diag.Diagnostics

	stateBlock := lowerStateBlock(file.StateSource, schema, &ds)

	var sceneBlock *HCLSceneBlock
	if file.Scene != nil {
		sceneBlock = lowerSceneBlock(file.Scene, schema, &ds)
	}

	routes := lowerRouteBlocks(file.Routes)

	if ds.HasErrors() {
		return nil, ds
	}
	return &Model{State: stateBlock, Scene: sceneBlock, Routes: routes}, ds
}

// ─────────────────────────────────────────────────────────────────────────────
// Route block lowering
// ─────────────────────────────────────────────────────────────────────────────

// lowerRouteBlocks lowers all route blocks to canonical HCL model form.
func lowerRouteBlocks(routes []*ast.RouteBlock) []*HCLRouteBlock {
	result := make([]*HCLRouteBlock, 0, len(routes))
	for _, r := range routes {
		hclr := &HCLRouteBlock{ID: r.ID}
		if r.Match != nil {
			for _, arm := range r.Match.Arms {
				hclArm := &HCLMatchArm{Target: arm.Target}
				for _, branch := range arm.Branches {
					hclArm.Patterns = append(hclArm.Patterns, pathExprString(branch))
				}
				hclr.Arms = append(hclr.Arms, hclArm)
			}
		}
		result = append(result, hclr)
	}
	return result
}

// pathExprString converts a PathExpr to its canonical string form.
func pathExprString(pe *ast.PathExpr) string {
	if pe.Fallback {
		return "_"
	}
	parts := make([]string, 0, 1+len(pe.Segments))
	parts = append(parts, pe.SceneID)
	parts = append(parts, pe.Segments...)
	return strings.Join(parts, ".")
}

// ─────────────────────────────────────────────────────────────────────────────
// State block lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerStateBlock(src ast.StateSource, schema state.Schema, ds *diag.Diagnostics) *HCLStateBlock {
	switch s := src.(type) {
	case *ast.InlineStateBlock:
		return lowerStateBlockFromAST(s)
	case *ast.StateFileDirective:
		_ = s
		return lowerStateBlockFromSchema(schema)
	default:
		return &HCLStateBlock{}
	}
}

// lowerStateBlockFromAST lowers an inline state block, preserving declaration order.
func lowerStateBlockFromAST(block *ast.InlineStateBlock) *HCLStateBlock {
	result := &HCLStateBlock{Namespaces: make([]*HCLNamespace, 0, len(block.Namespaces))}
	for _, ns := range block.Namespaces {
		hclNS := &HCLNamespace{
			Name:   ns.Name,
			Fields: make([]*HCLStateField, 0, len(ns.Fields)),
		}
		for _, f := range ns.Fields {
			hclNS.Fields = append(hclNS.Fields, &HCLStateField{
				Name:    f.Name,
				Type:    f.Type,
				Default: f.Default,
			})
		}
		result.Namespaces = append(result.Namespaces, hclNS)
	}
	return result
}

// lowerStateBlockFromSchema reconstructs a state block from the flat schema map,
// sorting namespaces and fields alphabetically for deterministic output.
// Used when the source is a state_file directive (AST order is unavailable).
func lowerStateBlockFromSchema(schema state.Schema) *HCLStateBlock {
	// Group field names by namespace.
	nsMap := make(map[string][]string)
	for key := range schema {
		parts := strings.SplitN(key, ".", 2)
		if len(parts) != 2 {
			continue
		}
		nsMap[parts[0]] = append(nsMap[parts[0]], parts[1])
	}

	nsNames := make([]string, 0, len(nsMap))
	for ns := range nsMap {
		nsNames = append(nsNames, ns)
	}
	sort.Strings(nsNames)

	result := &HCLStateBlock{Namespaces: make([]*HCLNamespace, 0, len(nsNames))}
	for _, nsName := range nsNames {
		fieldNames := nsMap[nsName]
		sort.Strings(fieldNames)

		hclNS := &HCLNamespace{Name: nsName, Fields: make([]*HCLStateField, 0, len(fieldNames))}
		for _, fieldName := range fieldNames {
			meta := schema[nsName+"."+fieldName]
			hclNS.Fields = append(hclNS.Fields, &HCLStateField{
				Name:    fieldName,
				Type:    meta.Type,
				Default: meta.DefaultValue,
			})
		}
		result.Namespaces = append(result.Namespaces, hclNS)
	}
	return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene / Action lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerSceneBlock(scene *ast.SceneBlock, schema state.Schema, ds *diag.Diagnostics) *HCLSceneBlock {
	result := &HCLSceneBlock{
		ID:           scene.ID,
		EntryActions: scene.EntryActions,
		NextPolicy:   scene.NextPolicy,
		Actions:      make([]*HCLAction, 0, len(scene.Actions)),
	}
	for _, a := range scene.Actions {
		result.Actions = append(result.Actions, lowerAction(a, schema, ds))
	}
	return result
}

func lowerAction(a *ast.ActionBlock, schema state.Schema, ds *diag.Diagnostics) *HCLAction {
	resolver := newActionPrepareResolver(a.Prepare, schema)

	var compute *HCLCompute
	if a.Compute != nil {
		compute = &HCLCompute{
			Root: a.Compute.Root,
			Prog: lowerProgInner(a.Compute.Prog, resolver, ds),
		}
	}

	nexts := make([]*HCLNextRule, 0, len(a.Next))
	for _, nr := range a.Next {
		nexts = append(nexts, lowerNextRule(nr, schema, ds))
	}

	return &HCLAction{
		ID:      a.ID,
		Text:    lowerActionText(a.Text),
		Compute: compute,
		Prepare: lowerPrepare(a.Prepare),
		Merge:   lowerMerge(a.Merge),
		Publish: lowerPublish(a.Publish),
		Next:    nexts,
	}
}

// lowerActionText trims one leading and one trailing newline from the raw docstring,
// per scene-graph.md §5.1.
func lowerActionText(raw *string) *string {
	if raw == nil {
		return nil
	}
	s := *raw
	if len(s) > 0 && s[0] == '\n' {
		s = s[1:]
	}
	if len(s) > 0 && s[len(s)-1] == '\n' {
		s = s[:len(s)-1]
	}
	return &s
}

// ─────────────────────────────────────────────────────────────────────────────
// Prepare / Merge / Publish lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerPrepare(prepare *ast.PrepareBlock) *HCLPrepare {
	if prepare == nil {
		return nil
	}
	result := &HCLPrepare{Entries: make([]*HCLPrepareEntry, 0, len(prepare.Entries))}
	for _, e := range prepare.Entries {
		entry := &HCLPrepareEntry{BindingName: e.BindingName}
		switch s := e.Source.(type) {
		case *ast.FromState:
			entry.FromState = s.Path
		case *ast.FromHook:
			entry.FromHook = s.HookName
		}
		result.Entries = append(result.Entries, entry)
	}
	return result
}

func lowerMerge(merge *ast.MergeBlock) *HCLMerge {
	if merge == nil {
		return nil
	}
	result := &HCLMerge{Entries: make([]*HCLMergeEntry, 0, len(merge.Entries))}
	for _, e := range merge.Entries {
		result.Entries = append(result.Entries, &HCLMergeEntry{
			BindingName: e.BindingName,
			ToState:     e.ToState,
		})
	}
	return result
}

func lowerPublish(pub *ast.PublishBlock) *HCLPublish {
	if pub == nil {
		return nil
	}
	hooks := make([]string, len(pub.Hooks))
	copy(hooks, pub.Hooks)
	return &HCLPublish{Hooks: hooks}
}

// ─────────────────────────────────────────────────────────────────────────────
// Next rule lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerNextRule(nr *ast.NextRule, schema state.Schema, ds *diag.Diagnostics) *HCLNextRule {
	resolver := newTransitionPrepareResolver(nr.Prepare, schema)

	var compute *HCLNextCompute
	if nr.Compute != nil {
		compute = &HCLNextCompute{
			Condition: nr.Compute.Condition,
			Prog:      lowerProgInner(nr.Compute.Prog, resolver, ds),
		}
	}

	return &HCLNextRule{
		Compute: compute,
		Prepare: lowerNextPrepare(nr.Prepare),
		Action:  nr.ActionID,
	}
}

func lowerNextPrepare(np *ast.NextPrepareBlock) *HCLNextPrepare {
	if np == nil {
		return nil
	}
	result := &HCLNextPrepare{Entries: make([]*HCLNextPrepareEntry, 0, len(np.Entries))}
	for _, e := range np.Entries {
		entry := &HCLNextPrepareEntry{BindingName: e.BindingName}
		switch s := e.Source.(type) {
		case *ast.FromAction:
			entry.FromAction = s.BindingName
		case *ast.FromState:
			entry.FromState = s.Path
		case *ast.FromLiteral:
			entry.FromLiteral = s.Value
		}
		result.Entries = append(result.Entries, entry)
	}
	return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Prog / Binding lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerProgInner(prog *ast.ProgBlock, resolver prepareResolver, ds *diag.Diagnostics) *HCLProg {
	if prog == nil {
		return nil
	}
	result := &HCLProg{
		Name:     prog.Name,
		Bindings: make([]*HCLBinding, 0, len(prog.Bindings)),
	}
	for _, decl := range prog.Bindings {
		bindings := lowerBinding(decl, resolver, ds)
		result.Bindings = append(result.Bindings, bindings...)
	}
	return result
}

// lowerBinding lowers one BindingDecl to one or more HCLBindings.
// Returns two bindings for #if with an inline CondExprCall (auto-generated
// __if_<name>_cond binding is inserted before the main binding).
// Sigil is carried through to HCLBinding so the validator can check sigil rules.
func lowerBinding(decl *ast.BindingDecl, resolver prepareResolver, ds *diag.Diagnostics) []*HCLBinding {
	name := decl.Name // sigil already stripped by parser
	ft := decl.Type

	var bindings []*HCLBinding
	switch rhs := decl.RHS.(type) {
	case *ast.LiteralRHS:
		bindings = []*HCLBinding{lowerLiteralRHS(name, ft, rhs)}
	case *ast.PlaceholderRHS:
		bindings = []*HCLBinding{lowerPlaceholderRHS(name, ft, decl.Pos, resolver, ds)}
	case *ast.SingleRefRHS:
		bindings = []*HCLBinding{lowerSingleRefRHS(name, ft, rhs)}
	case *ast.FuncCallRHS:
		bindings = []*HCLBinding{lowerFuncCallRHS(name, ft, rhs)}
	case *ast.InfixRHS:
		bindings = []*HCLBinding{lowerInfixRHS(name, ft, rhs)}
	case *ast.PipeRHS:
		bindings = []*HCLBinding{lowerPipeRHS(name, ft, rhs)}
	case *ast.CondRHS:
		bindings = []*HCLBinding{lowerCondRHS(name, ft, rhs)}
	case *ast.IfRHS:
		bindings = lowerIfRHS(name, ft, rhs, ds)
	default:
		*ds = append(*ds, diag.ErrorAt(decl.Pos.File, decl.Pos.Line, decl.Pos.Col,
			diag.CodeUnsupportedConstruct, "unsupported binding RHS for %q", name))
		bindings = []*HCLBinding{{Name: name, Type: ft, Value: zeroLiteralFor(ft)}}
	}

	// Populate Sigil on the user-declared binding (matched by name).
	// Auto-generated bindings (e.g. __if_X_cond) have different names and keep SigilNone.
	for _, b := range bindings {
		if b.Name == name {
			b.Sigil = decl.Sigil
		}
	}
	return bindings
}

// ─────────────────────────────────────────────────────────────────────────────
// RHS-specific lowering functions
// ─────────────────────────────────────────────────────────────────────────────

func lowerLiteralRHS(name string, ft ast.FieldType, rhs *ast.LiteralRHS) *HCLBinding {
	return &HCLBinding{Name: name, Type: ft, Value: rhs.Value}
}

func lowerPlaceholderRHS(name string, ft ast.FieldType, pos ast.Pos, resolver prepareResolver, ds *diag.Diagnostics) *HCLBinding {
	val := resolver.resolveDefault(name, ft, pos, ds)
	return &HCLBinding{Name: name, Type: ft, Value: val}
}

// lowerSingleRefRHS lowers `name:type = identifier` to an identity combine,
// per hcl-context-spec.md identity-combine table.
func lowerSingleRefRHS(name string, ft ast.FieldType, rhs *ast.SingleRefRHS) *HCLBinding {
	var fn string
	var identityArg *HCLArg
	switch ft {
	case ast.FieldTypeBool:
		fn = "bool_and"
		identityArg = &HCLArg{Lit: &ast.BoolLiteral{Value: true}}
	case ast.FieldTypeNumber:
		fn = "add"
		identityArg = &HCLArg{Lit: &ast.NumberLiteral{Value: 0}}
	case ast.FieldTypeStr:
		fn = "str_concat"
		identityArg = &HCLArg{Lit: &ast.StringLiteral{Value: ""}}
	default: // arr<number>, arr<str>, arr<bool>
		fn = "arr_concat"
		identityArg = &HCLArg{Lit: &ast.ArrayLiteral{}}
	}
	return &HCLBinding{
		Name: name,
		Type: ft,
		Expr: &HCLExpr{Combine: &HCLCombine{
			Fn:   fn,
			Args: []*HCLArg{{Ref: rhs.RefName}, identityArg},
		}},
	}
}

func lowerFuncCallRHS(name string, ft ast.FieldType, rhs *ast.FuncCallRHS) *HCLBinding {
	return &HCLBinding{
		Name: name,
		Type: ft,
		Expr: &HCLExpr{Combine: &HCLCombine{
			Fn:   rhs.FnAlias,
			Args: lowerArgs(rhs.Args),
		}},
	}
}

// lowerInfixRHS lowers `name:type = lhs OP rhs` to a combine.
// InfixPlus is type-dispatched: number → "add", str → "str_concat".
func lowerInfixRHS(name string, ft ast.FieldType, rhs *ast.InfixRHS) *HCLBinding {
	fn := rhs.Op.FnAlias()
	if fn == "" { // InfixPlus
		if ft == ast.FieldTypeStr {
			fn = "str_concat"
		} else {
			fn = "add"
		}
	}
	return &HCLBinding{
		Name: name,
		Type: ft,
		Expr: &HCLExpr{Combine: &HCLCombine{
			Fn:   fn,
			Args: []*HCLArg{lowerArg(rhs.LHS), lowerArg(rhs.RHS)},
		}},
	}
}

func lowerPipeRHS(name string, ft ast.FieldType, rhs *ast.PipeRHS) *HCLBinding {
	params := make([]*HCLPipeParam, 0, len(rhs.Params))
	for _, p := range rhs.Params {
		params = append(params, &HCLPipeParam{
			ParamName:   p.ParamName,
			SourceIdent: p.SourceIdent,
		})
	}
	steps := make([]*HCLPipeStep, 0, len(rhs.Steps))
	for _, s := range rhs.Steps {
		steps = append(steps, &HCLPipeStep{
			Fn:   s.FnAlias,
			Args: lowerArgs(s.Args),
		})
	}
	return &HCLBinding{
		Name: name,
		Type: ft,
		Expr: &HCLExpr{Pipe: &HCLPipe{Params: params, Steps: steps}},
	}
}

func lowerCondRHS(name string, ft ast.FieldType, rhs *ast.CondRHS) *HCLBinding {
	condRef := ""
	if ref, ok := rhs.Condition.(*ast.CondExprRef); ok {
		condRef = ref.BindingName
	}
	return &HCLBinding{
		Name: name,
		Type: ft,
		Expr: &HCLExpr{Cond: &HCLCond{
			Condition: &HCLArg{Ref: condRef},
			Then:      &HCLArg{FuncRef: rhs.Then},
			Else:      &HCLArg{FuncRef: rhs.Else},
		}},
	}
}

// lowerIfRHS lowers an #if form.
//   - CondExprRef: equivalent to CondRHS (one binding returned).
//   - CondExprCall: auto-generates __if_<name>_cond binding (two bindings returned,
//     generated binding first so it precedes the cond in the prog).
func lowerIfRHS(name string, ft ast.FieldType, rhs *ast.IfRHS, ds *diag.Diagnostics) []*HCLBinding {
	switch cond := rhs.Cond.(type) {
	case *ast.CondExprRef:
		return []*HCLBinding{{
			Name: name,
			Type: ft,
			Expr: &HCLExpr{Cond: &HCLCond{
				Condition: &HCLArg{Ref: cond.BindingName},
				Then:      &HCLArg{FuncRef: rhs.Then},
				Else:      &HCLArg{FuncRef: rhs.Else},
			}},
		}}

	case *ast.CondExprCall:
		generatedName := "__if_" + name + "_cond"
		generatedBinding := &HCLBinding{
			Name: generatedName,
			Type: ast.FieldTypeBool,
			Expr: &HCLExpr{Combine: &HCLCombine{
				Fn:   cond.FnAlias,
				Args: lowerArgs(cond.Args),
			}},
		}
		mainBinding := &HCLBinding{
			Name: name,
			Type: ft,
			Expr: &HCLExpr{Cond: &HCLCond{
				Condition: &HCLArg{Ref: generatedName},
				Then:      &HCLArg{FuncRef: rhs.Then},
				Else:      &HCLArg{FuncRef: rhs.Else},
			}},
		}
		return []*HCLBinding{generatedBinding, mainBinding}

	default:
		*ds = append(*ds, diag.ErrorAt(rhs.Pos.File, rhs.Pos.Line, rhs.Pos.Col,
			diag.CodeUnsupportedConstruct, "unsupported #if condition form for binding %q", name))
		return []*HCLBinding{{Name: name, Type: ft, Value: zeroLiteralFor(ft)}}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Arg lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerArg(arg ast.Arg) *HCLArg {
	switch a := arg.(type) {
	case *ast.RefArg:
		return &HCLArg{Ref: a.Name}
	case *ast.LitArg:
		return &HCLArg{Lit: a.Value}
	case *ast.FuncRefArg:
		return &HCLArg{FuncRef: a.FnName}
	case *ast.StepRefArg:
		return &HCLArg{StepRef: a.Index, IsStepRef: true}
	case *ast.TransformArg:
		return &HCLArg{Transform: &HCLTransform{Ref: a.Ref, Fn: a.Fn}}
	default:
		return &HCLArg{}
	}
}

func lowerArgs(args []ast.Arg) []*HCLArg {
	result := make([]*HCLArg, len(args))
	for i, a := range args {
		result[i] = lowerArg(a)
	}
	return result
}

// ─────────────────────────────────────────────────────────────────────────────
// prepareResolver — abstracts placeholder default resolution
// ─────────────────────────────────────────────────────────────────────────────

// prepareResolver resolves the default value for a PlaceholderRHS ("_") binding.
// Two implementations exist: one for action-level progs and one for transition progs.
type prepareResolver interface {
	resolveDefault(bindingName string, ft ast.FieldType, pos ast.Pos, ds *diag.Diagnostics) ast.Literal
}

// ── Action-level resolver ──

type actionPrepareResolver struct {
	index  map[string]ast.PrepareSource
	schema state.Schema
}

func newActionPrepareResolver(prepare *ast.PrepareBlock, schema state.Schema) prepareResolver {
	index := make(map[string]ast.PrepareSource)
	if prepare != nil {
		for _, e := range prepare.Entries {
			index[e.BindingName] = e.Source
		}
	}
	return &actionPrepareResolver{index: index, schema: schema}
}

func (r *actionPrepareResolver) resolveDefault(name string, ft ast.FieldType, pos ast.Pos, ds *diag.Diagnostics) ast.Literal {
	src, ok := r.index[name]
	if !ok {
		*ds = append(*ds, diag.ErrorAt(pos.File, pos.Line, pos.Col,
			diag.CodeMissingPrepareEntry,
			"binding %q uses placeholder _ but has no prepare entry", name))
		return zeroLiteralFor(ft)
	}
	switch s := src.(type) {
	case *ast.FromState:
		meta, found := r.schema[s.Path]
		if !found {
			*ds = append(*ds, diag.ErrorAt(pos.File, pos.Line, pos.Col,
				diag.CodeUnresolvedStatePath,
				"from_state path %q is not declared in the state schema", s.Path))
			return zeroLiteralFor(ft)
		}
		return meta.DefaultValue
	case *ast.FromHook:
		// Hook source: no schema default exists; emit zero literal so the
		// compute graph is well-typed. The runtime will override via the hook.
		return zeroLiteralFor(ft)
	default:
		return zeroLiteralFor(ft)
	}
}

// ── Transition-level resolver ──

type transitionPrepareResolver struct {
	index  map[string]ast.NextPrepareSource
	schema state.Schema
}

func newTransitionPrepareResolver(prepare *ast.NextPrepareBlock, schema state.Schema) prepareResolver {
	index := make(map[string]ast.NextPrepareSource)
	if prepare != nil {
		for _, e := range prepare.Entries {
			index[e.BindingName] = e.Source
		}
	}
	return &transitionPrepareResolver{index: index, schema: schema}
}

func (r *transitionPrepareResolver) resolveDefault(name string, ft ast.FieldType, pos ast.Pos, ds *diag.Diagnostics) ast.Literal {
	src, ok := r.index[name]
	if !ok {
		*ds = append(*ds, diag.ErrorAt(pos.File, pos.Line, pos.Col,
			diag.CodeMissingPrepareEntry,
			"binding %q uses placeholder _ but has no transition prepare entry", name))
		return zeroLiteralFor(ft)
	}
	switch s := src.(type) {
	case *ast.FromState:
		meta, found := r.schema[s.Path]
		if !found {
			*ds = append(*ds, diag.ErrorAt(pos.File, pos.Line, pos.Col,
				diag.CodeUnresolvedStatePath,
				"from_state path %q is not declared in the state schema", s.Path))
			return zeroLiteralFor(ft)
		}
		return meta.DefaultValue
	case *ast.FromAction:
		// Value comes from action result at runtime; emit zero literal for type safety.
		return zeroLiteralFor(ft)
	case *ast.FromLiteral:
		return s.Value
	default:
		return zeroLiteralFor(ft)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// zeroLiteralFor returns the zero-value literal for a given FieldType.
// Used when no schema default is available (e.g. FromHook, FromAction).
func zeroLiteralFor(ft ast.FieldType) ast.Literal {
	switch ft {
	case ast.FieldTypeNumber:
		return &ast.NumberLiteral{Value: 0}
	case ast.FieldTypeStr:
		return &ast.StringLiteral{Value: ""}
	case ast.FieldTypeBool:
		return &ast.BoolLiteral{Value: false}
	default: // arr<number>, arr<str>, arr<bool>
		return &ast.ArrayLiteral{}
	}
}
