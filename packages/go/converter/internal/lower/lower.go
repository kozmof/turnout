// Package lower lowers a parsed TurnFile AST to the canonical proto model
// (turnoutpb.TurnModel), ready for validation and emission. No text is
// produced here; the emitter (emit package) converts TurnModel to HCL text or
// JSON.
package lower

import (
	"fmt"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"google.golang.org/protobuf/proto"
)

// ─────────────────────────────────────────────────────────────────────────────
// Lower — entry point
// ─────────────────────────────────────────────────────────────────────────────

// LowerResult bundles the canonical proto model and the resolved STATE schema.
// The model has NOT been validated — use converter.Compile / CompileSource for
// the full pipeline including validation, or converter.CompileToModel for
// tooling paths that skip validation intentionally.
type LowerResult struct {
	Model  *turnoutpb.TurnModel
	Schema state.Schema
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

// Lower lowers file using a pre-resolved schema and its declaration order.
// Use this when the caller has already resolved the schema (e.g. from a prior
// CompileSource call) and wants to avoid re-reading state_file from disk.
// schemaOrder must be the ordered dotted-path keys returned by
// state.ResolveWithOrder or converter.ResolveSchema.
func Lower(file *ast.TurnFile, schema state.Schema, schemaOrder []string) (*LowerResult, diag.Diagnostics) {
	return lowerCore(file, schema, schemaOrder)
}

func lowerCore(file *ast.TurnFile, schema state.Schema, schemaOrder []string) (*LowerResult, diag.Diagnostics) {
	var ds diag.DiagSink

	stateModel := lowerStateBlock(file.StateSource, schema, schemaOrder, &ds)
	if stateModel == nil {
		return nil, ds.Flush()
	}

	tm := &turnoutpb.TurnModel{State: stateModel}

	for _, s := range file.Scenes {
		tm.Scenes = append(tm.Scenes, lowerSceneBlock(s, schema, &ds))
	}

	tm.Routes = lowerRouteBlocks(file.Routes)

	if ds.HasErrors() {
		return nil, ds.Flush()
	}
	return &LowerResult{Model: tm, Schema: schema}, ds.Flush()
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversion helpers
// ─────────────────────────────────────────────────────────────────────────────

func astPosToProto(p ast.Pos) *turnoutpb.SourcePos {
	if p.File == "" {
		return nil
	}
	return &turnoutpb.SourcePos{File: p.File, Line: int32(p.Line), Col: int32(p.Col)}
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
	if pe.SceneID == "" {
		// Parser invariant: non-fallback PathExprs always have a SceneID.
		panic("pathExprString: non-fallback PathExpr has empty SceneID — parser bug")
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
				"state_file %q: schema was not pre-loaded; use LowerResolvingState()", s.Path))
		} else if len(order) == 0 {
			ds.Append(diag.Errorf(diag.CodeDeclarationOrderLost,
				"state_file %q: field declaration order cannot be preserved; use LowerResolvingState()", s.Path))
		}
		return lowerStateBlockFromSchema(schema, order, ds)
	case nil:
		ds.Append(diag.Errorf(diag.CodeMissingStateSource,
			"lowerStateBlock: nil StateSource — this is a compiler bug; please report the source file"))
		return nil
	default:
		panic(fmt.Sprintf("lowerStateBlock: unhandled StateSource type %T — this is a compiler bug", src))
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
				Type:  f.Type.ProtoString(),
				Value: ast.LiteralToStructpb(f.Default),
			})
		}
		sm.Namespaces = append(sm.Namespaces, pbNS)
	}
	return sm
}


// orderedNsMap accumulates namespace→field entries in insertion order.
// It replaces the previous dual-variable pattern (nsList + nsIndex).
type orderedNsMap struct {
	list  []struct {
		name   string
		fields []*turnoutpb.FieldModel
	}
	index map[string]int
}

func (m *orderedNsMap) appendField(nsName, fieldName string, meta state.FieldMeta) {
	if m.index == nil {
		m.index = make(map[string]int)
	}
	idx, exists := m.index[nsName]
	if !exists {
		idx = len(m.list)
		m.list = append(m.list, struct {
			name   string
			fields []*turnoutpb.FieldModel
		}{name: nsName})
		m.index[nsName] = idx
	}
	m.list[idx].fields = append(m.list[idx].fields, &turnoutpb.FieldModel{
		Name:  fieldName,
		Type:  meta.Type.ProtoString(),
		Value: meta.DefaultValue,
	})
}

func (m *orderedNsMap) toStateModel() *turnoutpb.StateModel {
	sm := &turnoutpb.StateModel{Namespaces: make([]*turnoutpb.NamespaceModel, 0, len(m.list))}
	for _, ns := range m.list {
		sm.Namespaces = append(sm.Namespaces, &turnoutpb.NamespaceModel{Name: ns.name, Fields: ns.fields})
	}
	return sm
}

// lowerStateBlockFromSchema reconstructs a state block preserving the
// declaration order supplied by the caller (dotted "ns.field" keys).
func lowerStateBlockFromSchema(schema state.Schema, order []string, ds *diag.DiagSink) *turnoutpb.StateModel {
	var m orderedNsMap
	for _, key := range order {
		meta, ok := schema.Get(key)
		if !ok {
			ds.Append(diag.Errorf(diag.CodeStaleDeclarationOrder,
				"lowerStateBlockFromSchema: state key %q in declaration order not found in schema (internal error — schema and order are out of sync)", key))
			continue
		}
		ns, field, ok := strings.Cut(key, ".")
		if !ok {
			ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct,
				"lowerStateBlockFromSchema: state key %q has no namespace separator (internal error)", key))
			continue
		}
		m.appendField(ns, field, meta)
	}
	// Do not assemble a partial model when errors were collected; returning nil
	// causes lowerCore's nil-guard to halt compilation cleanly rather than
	// allowing downstream stages (validate, emit) to operate on incomplete state.
	if ds.HasErrors() {
		return nil
	}
	return m.toStateModel()
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene / Action lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerSceneBlock(scene *ast.SceneBlock, schema state.Schema, ds *diag.DiagSink) *turnoutpb.SceneBlock {
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
		sb.Actions = append(sb.Actions, lowerAction(a, schema, ds))
	}
	return sb
}

func lowerAction(a *ast.ActionBlock, schema state.Schema, ds *diag.DiagSink) *turnoutpb.ActionModel {
	resolver := newActionPrepareResolver(a.Prepare, schema)

	am := &turnoutpb.ActionModel{Id: a.ID}

	if text := trimActionText(a.Text); text != nil {
		am.Text = text
	}

	if a.Compute != nil {
		am.Compute = &turnoutpb.ComputeModel{
			Root: a.Compute.Root,
			Prog: lowerProgInner(a.Compute.Prog, resolver, ds),
		}
	}

	am.Prepare = lowerPrepare(a.Prepare)
	am.Merge = lowerMerge(a.Merge)
	am.Publish = lowerPublish(a.Publish)

	for _, nr := range a.Next {
		am.Next = append(am.Next, lowerNextRule(nr, schema, ds))
	}
	return am
}

// trimActionText strips one trailing newline from the raw string captured from
// a triple-quoted text literal or heredoc body.
//
// Scanner invariants (see lexer.scanTripleQuote / lexer.scanHeredoc):
//   - heredoc (<<-): body is the joined rawLines with no leading or trailing \n.
//   - triple-quote ("""): the scanner strips one leading \n and one trailing \n
//     at scan time, but if the content itself ends with \n a second one remains.
//
// This function removes that second trailing \n for triple-quote action text.
// A leading \n is NOT stripped here — doing so would silently eat a genuine
// blank first line written by the author.
func trimActionText(raw *string) *string {
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
	return pub.Hooks
}

// ─────────────────────────────────────────────────────────────────────────────
// Next rule lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerNextRule(nr *ast.NextRule, schema state.Schema, ds *diag.DiagSink) *turnoutpb.NextRuleModel {
	resolver := newTransitionPrepareResolver(nr.Prepare, schema)

	pbNR := &turnoutpb.NextRuleModel{Action: nr.ActionID}

	if nr.Compute != nil {
		pbNR.Compute = &turnoutpb.NextComputeModel{
			Condition: nr.Compute.Condition,
			Prog:      lowerProgInner(nr.Compute.Prog, resolver, ds),
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
			entry.FromLiteral = ast.LiteralToStructpb(s.Value)
		}
		entries = append(entries, entry)
	}
	return entries
}

// ─────────────────────────────────────────────────────────────────────────────
// Prog / Binding lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerProgInner(prog *ast.ProgBlock, resolver prepareResolver, ds *diag.DiagSink) *turnoutpb.ProgModel {
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
		bindings := lowerBinding(decl, resolver, pm, ds, bindingTypes, &localCounter)
		pm.Bindings = append(pm.Bindings, bindings...)
	}
	return pm
}

// lowerBinding lowers one BindingDecl to one or more BindingModels.
// Sigils are written directly into pm.Sigils; source positions are set on the binding.
func lowerBinding(decl *ast.BindingDecl, resolver prepareResolver, pm *turnoutpb.ProgModel, ds *diag.DiagSink, bindingTypes map[string]ast.FieldType, localCounter *int) []*turnoutpb.BindingModel {
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
		bm := lowerSingleRefRHS(name, ft, rhs)
		if bm == nil {
			ds.Append(diag.ErrorAt(decl.Pos.File, decl.Pos.Line, decl.Pos.Col,
				diag.CodeTypeMismatch,
				"binding %q: type %s is not valid for a single-reference binding — this is a compiler bug; please report the source file", name, ft))
			return nil
		}
		bindings = []*turnoutpb.BindingModel{bm}
	case *ast.FuncCallRHS:
		bm := lowerFuncCallRHS(name, ft, rhs, decl.Pos, bindingTypes, ds)
		if bm == nil {
			return nil // diagnostic already emitted by lowerFuncCallRHS (operator-only check)
		}
		bindings = []*turnoutpb.BindingModel{bm}
	case *ast.InfixRHS:
		bm := lowerInfixRHS(name, ft, rhs, bindingTypes, ds)
		if bm == nil {
			return nil // diagnostic already emitted by lowerInfixRHS (invalid infix expr)
		}
		bindings = []*turnoutpb.BindingModel{bm}
	case *ast.IfCallRHS, *ast.CaseCallRHS, *ast.PipeCallRHS:
		bindings = lowerLocalRHS(name, ft, rhs, bindingTypes, ds, localCounter)
	case *ast.ErrorRHS:
		// Parser failed to parse this binding's RHS; a diagnostic was already recorded.
		return nil
	case nil:
		// Compiler-bug sentinel: the parser always sets a non-nil RHS (even ErrorRHS
		// for parse failures). A nil here means the caller constructed a BindingDecl
		// incorrectly. CodeUnsupportedConstruct is intentional — there is no
		// user-authored construct that produces this path.
		ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q has nil RHS — this is a compiler bug; please report the source file", name))
		return nil
	default:
		panic(fmt.Sprintf("lowerBinding: unhandled RHS type %T for binding %q — this is a compiler bug", rhs, name))
	}

	// Record sigil in proto for sigil bindings.
	if decl.Sigil != ast.SigilNone {
		pm.Sigils[name] = decl.Sigil.ToInt32()
	}
	// Record source position on every binding produced from this decl so the
	// validator can emit file:line:col diagnostics for all nodes, including
	// synthetic bindings (__if_N, __local_N, …) generated by lowerLocalRHS.
	pos := astPosToProto(decl.Pos)
	for _, b := range bindings {
		if b.SourcePos == nil {
			b.SourcePos = pos
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
