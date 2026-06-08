// Package lower lowers a parsed TurnFile AST to the canonical proto model
// (turnoutpb.TurnModel), ready for validation and emission. No text is
// produced here; the emitter (emit package) converts TurnModel to HCL text or
// JSON.
package lower

import (
	"fmt"
	"slices"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Lower — entry point
// ─────────────────────────────────────────────────────────────────────────────

// LowerResult bundles the canonical proto model, the resolved STATE schema, and
// the binding sigil sidecar. Pass Sidecar directly to validate.Validate so that
// sigil checks work correctly even on models that were not produced by this
// lowering run (e.g. loaded from disk, where Annotations would be absent).
type LowerResult struct {
	Model   *turnoutpb.TurnModel
	Schema  state.Schema
	Sidecar *Sidecar
}

// LowerResolvingState resolves the STATE schema from basePath (the directory of
// the input .turn file) and then calls Lower. Use this when the source file may
// contain a state_file directive; it avoids the two-step
// state.Resolve + Lower call sequence that callers otherwise must get right.
// Declaration order from the state source is preserved in the emitted HCL.
func LowerResolvingState(file *ast.TurnFile, basePath string) (*LowerResult, diag.Diagnostics) {
	schema, order, ds := state.ResolveWithOrder(file.StateSource, basePath)
	if ds.HasErrors() {
		return nil, ds
	}
	return lowerCore(file, schema, order)
}

// Lower converts a parsed TurnFile and resolved STATE schema to a LowerResult
// plus diagnostics. Returns a nil LowerResult when the input has errors.
// Field ordering in emitted HCL follows alphabetical order for state_file
// sources; use LowerResolvingState to preserve declaration order.
func Lower(file *ast.TurnFile, schema state.Schema) (*LowerResult, diag.Diagnostics) {
	return lowerCore(file, schema, nil)
}

func lowerCore(file *ast.TurnFile, schema state.Schema, schemaOrder []string) (*LowerResult, diag.Diagnostics) {
	var ds diag.DiagSink
	sc := newSidecar()

	stateModel := lowerStateBlock(file.StateSource, schema, schemaOrder, &ds)

	tm := &turnoutpb.TurnModel{State: stateModel}

	for _, s := range file.Scenes {
		tm.Scenes = append(tm.Scenes, lowerSceneBlock(s, schema, sc, &ds))
	}

	tm.Routes = lowerRouteBlocks(file.Routes)

	if ds.Diags.HasErrors() {
		return nil, ds.Diags
	}
	return &LowerResult{Model: tm, Schema: schema, Sidecar: sc}, ds.Diags
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversion helpers
// ─────────────────────────────────────────────────────────────────────────────

// literalToStructpb converts an ast.Literal to a structpb.Value. A nil literal
// becomes a null value.
func literalToStructpb(lit ast.Literal) *structpb.Value {
	if lit == nil {
		return structpb.NewNullValue()
	}
	switch v := lit.(type) {
	case *ast.NumberLiteral:
		return structpb.NewNumberValue(v.Value)
	case *ast.StringLiteral:
		return structpb.NewStringValue(v.Value)
	case *ast.BoolLiteral:
		return structpb.NewBoolValue(v.Value)
	case *ast.ArrayLiteral:
		vals := make([]*structpb.Value, len(v.Elements))
		for i, e := range v.Elements {
			vals[i] = literalToStructpb(e)
		}
		return structpb.NewListValue(&structpb.ListValue{Values: vals})
	}
	panic(fmt.Sprintf("literalToStructpb: unhandled Literal type %T", lit))
}

// ─────────────────────────────────────────────────────────────────────────────
// Route block lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerRouteBlocks(routes []*ast.RouteBlock) []*turnoutpb.RouteModel {
	result := make([]*turnoutpb.RouteModel, 0, len(routes))
	for _, r := range routes {
		rm := &turnoutpb.RouteModel{Id: r.ID}
		if r.EntrySceneID != "" {
			rm.EntrySceneId = proto.String(r.EntrySceneID)
		}
		if r.Match != nil {
			for _, arm := range r.Match.Arms {
				pbArm := &turnoutpb.MatchArm{Target: arm.Target}
				for _, branch := range arm.Branches {
					pbArm.Patterns = append(pbArm.Patterns, pathExprString(branch))
				}
				rm.Match = append(rm.Match, pbArm)
			}
		}
		result = append(result, rm)
	}
	return result
}

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

func lowerStateBlock(src ast.StateSource, schema state.Schema, order []string, ds *diag.DiagSink) *turnoutpb.StateModel {
	switch s := src.(type) {
	case *ast.InlineStateBlock:
		return lowerStateBlockFromAST(s)
	case *ast.StateFileDirective:
		if len(schema.Namespaces()) == 0 {
			ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct,
				"state_file %q: schema was not pre-loaded; use LowerResolvingState() or call state.Resolve() before Lower()", s.Path))
		}
		return lowerStateBlockFromSchema(schema, order, ds)
	default:
		return &turnoutpb.StateModel{}
	}
}

func lowerStateBlockFromAST(block *ast.InlineStateBlock) *turnoutpb.StateModel {
	sm := &turnoutpb.StateModel{Namespaces: make([]*turnoutpb.NamespaceModel, 0, len(block.Namespaces))}
	for _, ns := range block.Namespaces {
		pbNS := &turnoutpb.NamespaceModel{
			Name:   ns.Name,
			Fields: make([]*turnoutpb.FieldModel, 0, len(ns.Fields)),
		}
		for _, f := range ns.Fields {
			pbNS.Fields = append(pbNS.Fields, &turnoutpb.FieldModel{
				Name:  f.Name,
				Type:  f.Type.String(),
				Value: literalToStructpb(f.Default),
			})
		}
		sm.Namespaces = append(sm.Namespaces, pbNS)
	}
	return sm
}

// lowerStateBlockFromSchema dispatches to the ordered or alphabetical variant
// based on whether declaration order was captured by the caller.
func lowerStateBlockFromSchema(schema state.Schema, order []string, ds *diag.DiagSink) *turnoutpb.StateModel {
	if len(order) > 0 {
		return lowerStateBlockFromSchemaOrdered(schema, order, ds)
	}
	return lowerStateBlockFromSchemaAlphabetical(schema)
}

// nsEntry groups a namespace name with its accumulated fields for state model construction.
type nsEntry struct {
	name   string
	fields []*turnoutpb.FieldModel
}

// appendStateField appends one field to nsList/nsIndex, creating the namespace entry when needed.
func appendStateField(nsList *[]nsEntry, nsIndex map[string]int, nsName, fieldName string, meta state.FieldMeta) {
	idx, exists := nsIndex[nsName]
	if !exists {
		idx = len(*nsList)
		*nsList = append(*nsList, nsEntry{name: nsName})
		nsIndex[nsName] = idx
	}
	(*nsList)[idx].fields = append((*nsList)[idx].fields, &turnoutpb.FieldModel{
		Name:  fieldName,
		Type:  meta.Type.String(),
		Value: literalToStructpb(meta.DefaultValue),
	})
}

// assembleStateModel converts a populated nsList into a *turnoutpb.StateModel.
func assembleStateModel(nsList []nsEntry) *turnoutpb.StateModel {
	sm := &turnoutpb.StateModel{Namespaces: make([]*turnoutpb.NamespaceModel, 0, len(nsList))}
	for _, ns := range nsList {
		sm.Namespaces = append(sm.Namespaces, &turnoutpb.NamespaceModel{Name: ns.name, Fields: ns.fields})
	}
	return sm
}

// lowerStateBlockFromSchemaOrdered reconstructs a state block preserving the
// declaration order supplied by the caller (dotted "ns.field" keys).
func lowerStateBlockFromSchemaOrdered(schema state.Schema, order []string, ds *diag.DiagSink) *turnoutpb.StateModel {
	var nsList []nsEntry
	nsIndex := make(map[string]int)
	for _, key := range order {
		meta, ok := schema.Get(key)
		if !ok {
			ds.Append(diag.Warnf(diag.CodeUnsupportedConstruct,
				"lowerStateBlockFromSchemaOrdered: state key %q in declaration order not found in schema (stale order?)", key))
			continue
		}
		dot := strings.IndexByte(key, '.')
		if dot < 0 {
			ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct,
				"lowerStateBlockFromSchemaOrdered: state key %q has no namespace separator (internal error)", key))
			continue
		}
		appendStateField(&nsList, nsIndex, key[:dot], key[dot+1:], meta)
	}
	return assembleStateModel(nsList)
}

// lowerStateBlockFromSchemaAlphabetical reconstructs a state block from the
// flat schema map with namespaces and fields sorted alphabetically for
// deterministic output when no declaration order is available.
func lowerStateBlockFromSchemaAlphabetical(schema state.Schema) *turnoutpb.StateModel {
	nsNames := schema.Namespaces()
	slices.Sort(nsNames)

	var nsList []nsEntry
	for _, nsName := range nsNames {
		fields, _ := schema.FieldsOf(nsName)
		if len(fields) == 0 {
			continue
		}
		fieldNames := make([]string, 0, len(fields))
		for fieldName := range fields {
			fieldNames = append(fieldNames, fieldName)
		}
		slices.Sort(fieldNames)

		entry := nsEntry{name: nsName, fields: make([]*turnoutpb.FieldModel, 0, len(fieldNames))}
		for _, fieldName := range fieldNames {
			meta := fields[fieldName]
			entry.fields = append(entry.fields, &turnoutpb.FieldModel{
				Name:  fieldName,
				Type:  meta.Type.String(),
				Value: literalToStructpb(meta.DefaultValue),
			})
		}
		nsList = append(nsList, entry)
	}
	return assembleStateModel(nsList)
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene / Action lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerSceneBlock(scene *ast.SceneBlock, schema state.Schema, sc *Sidecar, ds *diag.DiagSink) *turnoutpb.SceneBlock {
	sb := &turnoutpb.SceneBlock{
		Id:           scene.ID,
		EntryActions: scene.EntryActions,
		Actions:      make([]*turnoutpb.ActionModel, 0, len(scene.Actions)),
	}
	if scene.NextPolicy != "" {
		sb.NextPolicy = proto.String(scene.NextPolicy)
	}
	if scene.View != nil {
		vb := &turnoutpb.ViewBlock{
			Name: scene.View.Name,
			Flow: scene.View.Flow,
		}
		if scene.View.Enforce != "" {
			vb.Enforce = proto.String(scene.View.Enforce)
		}
		sb.View = vb
	}
	for _, a := range scene.Actions {
		sb.Actions = append(sb.Actions, lowerAction(a, schema, scene.ID, sc, ds))
	}
	return sb
}

func lowerAction(a *ast.ActionBlock, schema state.Schema, sceneID string, sc *Sidecar, ds *diag.DiagSink) *turnoutpb.ActionModel {
	resolver := newActionPrepareResolver(a.Prepare, schema)

	am := &turnoutpb.ActionModel{Id: a.ID}

	if text := lowerActionText(a.Text); text != nil {
		am.Text = text
	}

	if a.Compute != nil {
		am.Compute = &turnoutpb.ComputeModel{
			Root: a.Compute.Root,
			Prog: lowerProgInner(a.Compute.Prog, resolver, sceneID, a.ID, ComputeScope(), sc, ds),
		}
	}

	am.Prepare = lowerPrepare(a.Prepare)
	am.Merge = lowerMerge(a.Merge)
	am.Publish = lowerPublish(a.Publish)

	for i, nr := range a.Next {
		am.Next = append(am.Next, lowerNextRule(nr, schema, sceneID, a.ID, NextScope(i), sc, ds))
	}
	return am
}

// lowerActionText trims a single trailing newline from the raw string captured
// from a triple-quoted text literal or heredoc body.
//
// Scanner invariants:
//   - heredoc (<<-): body is the joined rawLines with no leading or trailing \n.
//   - triple-quote ("""): the scanner strips one leading \n and one trailing \n
//     at scan time, but if the content itself ends with \n a second one remains.
//
// A leading \n is NOT stripped here — doing so would silently eat a genuine
// blank first line written by the author.
func lowerActionText(raw *string) *string {
	if raw == nil {
		return nil
	}
	s := *raw
	if len(s) > 0 && s[len(s)-1] == '\n' {
		s = s[:len(s)-1]
	}
	return &s
}

// ─────────────────────────────────────────────────────────────────────────────
// Prepare / Merge / Publish lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerPrepare(prepare *ast.PrepareBlock) []*turnoutpb.PrepareEntry {
	if prepare == nil {
		return nil
	}
	entries := make([]*turnoutpb.PrepareEntry, 0, len(prepare.Entries))
	for _, e := range prepare.Entries {
		pe := &turnoutpb.PrepareEntry{Binding: e.BindingName}
		switch s := e.Source.(type) {
		case *ast.FromState:
			pe.FromState = proto.String(s.Path)
		case *ast.FromHook:
			pe.FromHook = proto.String(s.HookName)
		}
		entries = append(entries, pe)
	}
	return entries
}

func lowerMerge(merge *ast.MergeBlock) []*turnoutpb.MergeEntry {
	if merge == nil {
		return nil
	}
	entries := make([]*turnoutpb.MergeEntry, 0, len(merge.Entries))
	for _, e := range merge.Entries {
		entries = append(entries, &turnoutpb.MergeEntry{
			Binding: e.BindingName,
			ToState: e.ToState,
		})
	}
	return entries
}

func lowerPublish(pub *ast.PublishBlock) []string {
	if pub == nil {
		return nil
	}
	hooks := make([]string, len(pub.Hooks))
	copy(hooks, pub.Hooks)
	return hooks
}

// ─────────────────────────────────────────────────────────────────────────────
// Next rule lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerNextRule(nr *ast.NextRule, schema state.Schema, sceneID, actionID string, scope ProgScope, sc *Sidecar, ds *diag.DiagSink) *turnoutpb.NextRuleModel {
	resolver := newTransitionPrepareResolver(nr.Prepare, schema)

	pbNR := &turnoutpb.NextRuleModel{Action: nr.ActionID}

	if nr.Compute != nil {
		pbNR.Compute = &turnoutpb.NextComputeModel{
			Condition: nr.Compute.Condition,
			Prog:      lowerProgInner(nr.Compute.Prog, resolver, sceneID, actionID, scope, sc, ds),
		}
	}

	pbNR.Prepare = lowerNextPrepare(nr.Prepare)
	return pbNR
}

func lowerNextPrepare(np *ast.NextPrepareBlock) []*turnoutpb.NextPrepareEntry {
	if np == nil {
		return nil
	}
	entries := make([]*turnoutpb.NextPrepareEntry, 0, len(np.Entries))
	for _, e := range np.Entries {
		entry := &turnoutpb.NextPrepareEntry{Binding: e.BindingName}
		switch s := e.Source.(type) {
		case *ast.FromAction:
			entry.FromAction = proto.String(s.BindingName)
		case *ast.FromState:
			entry.FromState = proto.String(s.Path)
		case *ast.FromLiteral:
			entry.FromLiteral = literalToStructpb(s.Value)
		}
		entries = append(entries, entry)
	}
	return entries
}

// ─────────────────────────────────────────────────────────────────────────────
// Prog / Binding lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerProgInner(prog *ast.ProgBlock, resolver prepareResolver, sceneID, actionID string, scope ProgScope, sc *Sidecar, ds *diag.DiagSink) *turnoutpb.ProgModel {
	if prog == nil {
		return nil
	}
	bindingTypes := make(map[string]ast.FieldType, len(prog.Bindings))
	for _, decl := range prog.Bindings {
		bindingTypes[decl.Name] = decl.Type
	}
	pm := &turnoutpb.ProgModel{
		Name:     prog.Name,
		Bindings: make([]*turnoutpb.BindingModel, 0, len(prog.Bindings)),
		Sigils:   make(map[string]int32),
	}
	var localCounter int
	for _, decl := range prog.Bindings {
		bindings := lowerBinding(decl, resolver, sceneID, actionID, scope, pm, sc, ds, bindingTypes, &localCounter)
		pm.Bindings = append(pm.Bindings, bindings...)
	}
	return pm
}

// lowerBinding lowers one BindingDecl to one or more BindingModels.
// Sigils are written directly into pm.Sigils; source positions go into the sidecar.
func lowerBinding(decl *ast.BindingDecl, resolver prepareResolver, sceneID, actionID string, scope ProgScope, pm *turnoutpb.ProgModel, sc *Sidecar, ds *diag.DiagSink, bindingTypes map[string]ast.FieldType, localCounter *int) []*turnoutpb.BindingModel {
	name := decl.Name
	ft := decl.Type

	var bindings []*turnoutpb.BindingModel
	switch rhs := decl.RHS.(type) {
	case *ast.LiteralRHS:
		bindings = []*turnoutpb.BindingModel{lowerLiteralRHS(name, ft, rhs)}
	case *ast.SigilInputRHS:
		// Ingress (~>): same "resolve or error" behavior as old PlaceholderRHS.
		// Bidir (<~>): use the bidirectional-specific missing-prepare diagnostic.
		if decl.Sigil == ast.SigilBiDir {
			bindings = []*turnoutpb.BindingModel{lowerBiDirInputRHS(name, ft, decl.Pos, resolver, ds)}
		} else {
			bindings = []*turnoutpb.BindingModel{lowerPlaceholderRHS(name, ft, decl.Pos, resolver, ds)}
		}
	case *ast.SingleRefRHS:
		bindings = []*turnoutpb.BindingModel{lowerSingleRefRHS(name, ft, rhs)}
	case *ast.FuncCallRHS:
		if bm := lowerFuncCallRHS(name, ft, rhs, decl.Pos, bindingTypes, ds); bm != nil {
			bindings = []*turnoutpb.BindingModel{bm}
		} else {
			return nil
		}
	case *ast.InfixRHS:
		bindings = []*turnoutpb.BindingModel{lowerInfixRHS(name, ft, rhs, bindingTypes, ds)}
	case *ast.IfCallRHS, *ast.CaseCallRHS, *ast.PipeCallRHS:
		bindings = lowerLocalRHS(name, ft, rhs, bindingTypes, ds, localCounter)
	case *ast.ErrorRHS:
		// Parser failed to parse this binding's RHS; a diagnostic was already recorded.
		return nil
	case nil:
		// Defensive: should not be reachable via the normal parse path.
		ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct, "binding %q has no RHS", name))
		return nil
	default:
		ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q: unhandled RHS type %T — this is a compiler bug; please report it", name, rhs))
		return nil
	}

	// Record sigil in proto and source position in sidecar for the user-declared
	// binding (matched by name). Auto-generated bindings keep SigilNone.
	if decl.Sigil != ast.SigilNone {
		for _, b := range bindings {
			if b.Name == name {
				pm.Sigils[name] = decl.Sigil.ToInt32()
				key := BindingKey{SceneID: sceneID, ActionID: actionID, Scope: scope, ProgName: pm.Name, BindingName: name}
				sc.SetPos(key, decl.Pos)
			}
		}
	}
	return bindings
}

// lowerLocalRHS delegates IfCallRHS / CaseCallRHS / PipeCallRHS to the
// localLowerer, making the abstraction boundary explicit in the lowerBinding switch.
func lowerLocalRHS(name string, ft ast.FieldType, rhs ast.BindingRHS, bindingTypes map[string]ast.FieldType, ds *diag.DiagSink, counter *int) []*turnoutpb.BindingModel {
	c := newLocalLowerer(name, ft, bindingTypes, ds, counter)
	return c.lowerTop(rhs)
}
