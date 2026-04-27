// Package lower lowers a parsed TurnFile AST to the canonical proto model
// (turnoutpb.TurnModel), ready for validation and emission. No text is
// produced here; the emitter (emit package) converts TurnModel to HCL text or
// JSON.
package lower

import (
	"fmt"
	"sort"
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

// LowerResult bundles the canonical proto model with the sidecar that carries
// DSL metadata not representable in proto (sigils, view blocks, action text).
type LowerResult struct {
	Model   *turnoutpb.TurnModel
	Sidecar *Sidecar
}

// Lower converts a parsed TurnFile and resolved STATE schema to a LowerResult
// plus diagnostics. Returns a nil LowerResult when the input has errors.
func Lower(file *ast.TurnFile, schema state.Schema) (*LowerResult, diag.Diagnostics) {
	var ds diag.Diagnostics
	sc := newSidecar()

	stateModel := lowerStateBlock(file.StateSource, schema, &ds)

	tm := &turnoutpb.TurnModel{State: stateModel}

	for _, s := range file.Scenes {
		tm.Scenes = append(tm.Scenes, lowerSceneBlock(s, schema, sc, &ds))
	}

	tm.Routes = lowerRouteBlocks(file.Routes)

	if ds.HasErrors() {
		return nil, ds
	}
	return &LowerResult{Model: tm, Sidecar: sc}, ds
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
	return structpb.NewNullValue()
}

// ─────────────────────────────────────────────────────────────────────────────
// Route block lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerRouteBlocks(routes []*ast.RouteBlock) []*turnoutpb.RouteModel {
	result := make([]*turnoutpb.RouteModel, 0, len(routes))
	for _, r := range routes {
		rm := &turnoutpb.RouteModel{Id: r.ID}
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

func lowerStateBlock(src ast.StateSource, schema state.Schema, ds *diag.Diagnostics) *turnoutpb.StateModel {
	switch s := src.(type) {
	case *ast.InlineStateBlock:
		return lowerStateBlockFromAST(s)
	case *ast.StateFileDirective:
		_ = s
		return lowerStateBlockFromSchema(schema)
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

// lowerStateBlockFromSchema reconstructs a state block from the flat schema map,
// sorting namespaces and fields alphabetically for deterministic output.
func lowerStateBlockFromSchema(schema state.Schema) *turnoutpb.StateModel {
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

	sm := &turnoutpb.StateModel{Namespaces: make([]*turnoutpb.NamespaceModel, 0, len(nsNames))}
	for _, nsName := range nsNames {
		fieldNames := nsMap[nsName]
		sort.Strings(fieldNames)

		pbNS := &turnoutpb.NamespaceModel{Name: nsName, Fields: make([]*turnoutpb.FieldModel, 0, len(fieldNames))}
		for _, fieldName := range fieldNames {
			meta := schema[nsName+"."+fieldName]
			pbNS.Fields = append(pbNS.Fields, &turnoutpb.FieldModel{
				Name:  fieldName,
				Type:  meta.Type.String(),
				Value: literalToStructpb(meta.DefaultValue),
			})
		}
		sm.Namespaces = append(sm.Namespaces, pbNS)
	}
	return sm
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene / Action lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerSceneBlock(scene *ast.SceneBlock, schema state.Schema, sc *Sidecar, ds *diag.Diagnostics) *turnoutpb.SceneBlock {
	sb := &turnoutpb.SceneBlock{
		Id:           scene.ID,
		EntryActions: scene.EntryActions,
		Actions:      make([]*turnoutpb.ActionModel, 0, len(scene.Actions)),
	}
	if scene.NextPolicy != "" {
		sb.NextPolicy = proto.String(scene.NextPolicy)
	}
	if scene.View != nil {
		sc.Scenes[scene.ID] = SceneMeta{View: &ViewMeta{
			Name:    scene.View.Name,
			Flow:    scene.View.Flow,
			Enforce: scene.View.Enforce,
		}}
	}
	for _, a := range scene.Actions {
		sb.Actions = append(sb.Actions, lowerAction(a, schema, scene.ID, sc, ds))
	}
	return sb
}

func lowerAction(a *ast.ActionBlock, schema state.Schema, sceneID string, sc *Sidecar, ds *diag.Diagnostics) *turnoutpb.ActionModel {
	resolver := newActionPrepareResolver(a.Prepare, schema)

	am := &turnoutpb.ActionModel{Id: a.ID}

	// Text goes to the sidecar (HCL-only, stripped from JSON).
	if text := lowerActionText(a.Text); text != nil {
		sc.Actions[sceneID+"/"+a.ID] = ActionMeta{Text: text}
	}

	if a.Compute != nil {
		am.Compute = &turnoutpb.ComputeModel{
			Root: a.Compute.Root,
			Prog: lowerProgInner(a.Compute.Prog, resolver, sceneID, a.ID, "compute", sc, ds),
		}
	}

	am.Prepare = lowerPrepare(a.Prepare)
	am.Merge = lowerMerge(a.Merge)
	am.Publish = lowerPublish(a.Publish)

	for i, nr := range a.Next {
		am.Next = append(am.Next, lowerNextRule(nr, schema, sceneID, a.ID, fmt.Sprintf("next:%d", i), sc, ds))
	}
	return am
}

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

func lowerNextRule(nr *ast.NextRule, schema state.Schema, sceneID, actionID, scope string, sc *Sidecar, ds *diag.Diagnostics) *turnoutpb.NextRuleModel {
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

func lowerProgInner(prog *ast.ProgBlock, resolver prepareResolver, sceneID, actionID, scope string, sc *Sidecar, ds *diag.Diagnostics) *turnoutpb.ProgModel {
	if prog == nil {
		return nil
	}
	bindingTypes := make(map[string]string, len(prog.Bindings))
	for _, decl := range prog.Bindings {
		bindingTypes[decl.Name] = fieldTypeToMethodType(decl.Type)
	}
	pm := &turnoutpb.ProgModel{
		Name:     prog.Name,
		Bindings: make([]*turnoutpb.BindingModel, 0, len(prog.Bindings)),
	}
	for _, decl := range prog.Bindings {
		bindings := lowerBinding(decl, resolver, sceneID, actionID, scope, prog.Name, sc, ds, bindingTypes)
		pm.Bindings = append(pm.Bindings, bindings...)
	}
	return pm
}

// lowerBinding lowers one BindingDecl to one or more BindingModels.
// Sigils are captured in the sidecar keyed by (sceneID, actionID, progName, bindingName).
func lowerBinding(decl *ast.BindingDecl, resolver prepareResolver, sceneID, actionID, scope, progName string, sc *Sidecar, ds *diag.Diagnostics, bindingTypes map[string]string) []*turnoutpb.BindingModel {
	name := decl.Name
	ft := decl.Type

	var bindings []*turnoutpb.BindingModel
	switch rhs := decl.RHS.(type) {
	case *ast.LiteralRHS:
		bindings = []*turnoutpb.BindingModel{lowerLiteralRHS(name, ft, rhs)}
	case *ast.PlaceholderRHS:
		bindings = []*turnoutpb.BindingModel{lowerPlaceholderRHS(name, ft, decl.Pos, resolver, ds)}
	case *ast.SigilInputRHS:
		// Ingress (~>): same "resolve or error" behavior as old PlaceholderRHS.
		// Bidir (<~>): silently use zero if no prepare; validator emits the bidir-specific error.
		if decl.Sigil == ast.SigilBiDir {
			bindings = []*turnoutpb.BindingModel{lowerBiDirInputRHS(name, ft, decl.Pos, resolver)}
		} else {
			bindings = []*turnoutpb.BindingModel{lowerPlaceholderRHS(name, ft, decl.Pos, resolver, ds)}
		}
	case *ast.SingleRefRHS:
		bindings = []*turnoutpb.BindingModel{lowerSingleRefRHS(name, ft, rhs)}
	case *ast.FuncCallRHS:
		bindings = []*turnoutpb.BindingModel{lowerFuncCallRHS(name, ft, rhs, bindingTypes)}
	case *ast.InfixRHS:
		bindings = []*turnoutpb.BindingModel{lowerInfixRHS(name, ft, rhs, bindingTypes)}
	case *ast.PipeRHS:
		bindings = []*turnoutpb.BindingModel{lowerPipeRHS(name, ft, rhs, bindingTypes)}
	case *ast.CondRHS:
		bindings = []*turnoutpb.BindingModel{lowerCondRHS(name, ft, rhs)}
	case *ast.IfRHS:
		bindings = lowerIfRHS(name, ft, rhs, ds, bindingTypes)
	case *ast.IfCallRHS, *ast.CaseCallRHS, *ast.PipeCallRHS:
		c := newLocalLowerer(name, ft, bindingTypes, ds)
		bindings = c.lowerTop(rhs)
	default:
		*ds = append(*ds, diag.ErrorAt(decl.Pos.File, decl.Pos.Line, decl.Pos.Col,
			diag.CodeUnsupportedConstruct, "unsupported binding RHS for %q", name))
		bindings = []*turnoutpb.BindingModel{{Name: name, Type: ft.String(), Value: literalToStructpb(zeroLiteralFor(ft))}}
	}

	// Capture sigil for the user-declared binding (matched by name).
	// Auto-generated bindings (e.g. __if_X_cond) have different names and keep SigilNone.
	if decl.Sigil != ast.SigilNone {
		for _, b := range bindings {
			if b.Name == name {
				sc.Sigils[BindingKey{SceneID: sceneID, ActionID: actionID, Scope: scope, ProgName: progName, BindingName: name}] = decl.Sigil
			}
		}
	}
	return bindings
}

// ─────────────────────────────────────────────────────────────────────────────
// RHS-specific lowering functions
// ─────────────────────────────────────────────────────────────────────────────

func lowerLiteralRHS(name string, ft ast.FieldType, rhs *ast.LiteralRHS) *turnoutpb.BindingModel {
	return &turnoutpb.BindingModel{Name: name, Type: ft.String(), Value: literalToStructpb(rhs.Value)}
}

func lowerPlaceholderRHS(name string, ft ast.FieldType, pos ast.Pos, resolver prepareResolver, ds *diag.Diagnostics) *turnoutpb.BindingModel {
	val := resolver.resolveDefault(name, ft, pos, ds)
	return &turnoutpb.BindingModel{Name: name, Type: ft.String(), Value: literalToStructpb(val)}
}

// lowerBiDirInputRHS resolves the default value for a <~> binding silently:
// if there is no prepare entry, it emits zero value without an error so the
// validator can emit the bidir-specific CodeBidirMissingPrepareEntry instead.
func lowerBiDirInputRHS(name string, ft ast.FieldType, pos ast.Pos, resolver prepareResolver) *turnoutpb.BindingModel {
	var noDiags diag.Diagnostics
	val := resolver.resolveDefault(name, ft, pos, &noDiags)
	return &turnoutpb.BindingModel{Name: name, Type: ft.String(), Value: literalToStructpb(val)}
}

// lowerSingleRefRHS lowers `name:type = identifier` to an identity combine.
func lowerSingleRefRHS(name string, ft ast.FieldType, rhs *ast.SingleRefRHS) *turnoutpb.BindingModel {
	var fn string
	var identityArg *turnoutpb.ArgModel
	switch ft {
	case ast.FieldTypeBool:
		fn = "bool_and"
		identityArg = &turnoutpb.ArgModel{Lit: structpb.NewBoolValue(true)}
	case ast.FieldTypeNumber:
		fn = "add"
		identityArg = &turnoutpb.ArgModel{Lit: structpb.NewNumberValue(0)}
	case ast.FieldTypeStr:
		fn = "str_concat"
		identityArg = &turnoutpb.ArgModel{Lit: structpb.NewStringValue("")}
	default: // arr<number>, arr<str>, arr<bool>
		fn = "arr_concat"
		identityArg = &turnoutpb.ArgModel{Lit: structpb.NewListValue(&structpb.ListValue{})}
	}
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   fn,
			Args: []*turnoutpb.ArgModel{{Ref: proto.String(rhs.RefName)}, identityArg},
		}},
	}
}

func lowerFuncCallRHS(name string, ft ast.FieldType, rhs *ast.FuncCallRHS, bindingTypes map[string]string) *turnoutpb.BindingModel {
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   rhs.FnAlias,
			Args: lowerArgsWithTypes(rhs.Args, bindingTypes),
		}},
	}
}

func lowerInfixRHS(name string, ft ast.FieldType, rhs *ast.InfixRHS, bindingTypes map[string]string) *turnoutpb.BindingModel {
	fn := rhs.Op.FnAlias()
	if fn == "" {
		if ft == ast.FieldTypeStr {
			fn = "str_concat"
		} else {
			fn = "add"
		}
	}
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   fn,
			Args: []*turnoutpb.ArgModel{lowerArgWithTypes(rhs.LHS, bindingTypes), lowerArgWithTypes(rhs.RHS, bindingTypes)},
		}},
	}
}

func lowerPipeRHS(name string, ft ast.FieldType, rhs *ast.PipeRHS, bindingTypes map[string]string) *turnoutpb.BindingModel {
	params := make([]*turnoutpb.PipeParam, 0, len(rhs.Params))
	for _, p := range rhs.Params {
		params = append(params, &turnoutpb.PipeParam{
			ParamName:   p.ParamName,
			SourceIdent: p.SourceIdent,
		})
	}
	steps := make([]*turnoutpb.PipeStep, 0, len(rhs.Steps))
	for _, s := range rhs.Steps {
		steps = append(steps, &turnoutpb.PipeStep{
			Fn:   s.FnAlias,
			Args: lowerArgsWithTypes(s.Args, bindingTypes),
		})
	}
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Pipe: &turnoutpb.PipeExpr{Params: params, Steps: steps}},
	}
}

func lowerCondRHS(name string, ft ast.FieldType, rhs *ast.CondRHS) *turnoutpb.BindingModel {
	condRef := ""
	if ref, ok := rhs.Condition.(*ast.CondExprRef); ok {
		condRef = ref.BindingName
	}
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Cond: &turnoutpb.CondExpr{
			Condition:  &turnoutpb.ArgModel{Ref: proto.String(condRef)},
			Then:       &turnoutpb.ArgModel{FuncRef: proto.String(rhs.Then)},
			ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String(rhs.Else)},
		}},
	}
}

func lowerIfRHS(name string, ft ast.FieldType, rhs *ast.IfRHS, ds *diag.Diagnostics, bindingTypes map[string]string) []*turnoutpb.BindingModel {
	switch cond := rhs.Cond.(type) {
	case *ast.CondExprRef:
		return []*turnoutpb.BindingModel{{
			Name: name,
			Type: ft.String(),
			Expr: &turnoutpb.ExprModel{Cond: &turnoutpb.CondExpr{
				Condition:  &turnoutpb.ArgModel{Ref: proto.String(cond.BindingName)},
				Then:       &turnoutpb.ArgModel{FuncRef: proto.String(rhs.Then)},
				ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String(rhs.Else)},
			}},
		}}

	case *ast.CondExprCall:
		generatedName := "__if_" + name + "_cond"
		generatedBinding := &turnoutpb.BindingModel{
			Name: generatedName,
			Type: ast.FieldTypeBool.String(),
			Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
				Fn:   cond.FnAlias,
				Args: lowerArgsWithTypes(cond.Args, bindingTypes),
			}},
		}
		mainBinding := &turnoutpb.BindingModel{
			Name: name,
			Type: ft.String(),
			Expr: &turnoutpb.ExprModel{Cond: &turnoutpb.CondExpr{
				Condition:  &turnoutpb.ArgModel{Ref: proto.String(generatedName)},
				Then:       &turnoutpb.ArgModel{FuncRef: proto.String(rhs.Then)},
				ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String(rhs.Else)},
			}},
		}
		return []*turnoutpb.BindingModel{generatedBinding, mainBinding}

	default:
		*ds = append(*ds, diag.ErrorAt(rhs.Pos.File, rhs.Pos.Line, rhs.Pos.Col,
			diag.CodeUnsupportedConstruct, "unsupported #if condition form for binding %q", name))
		return []*turnoutpb.BindingModel{{Name: name, Type: ft.String(), Value: literalToStructpb(zeroLiteralFor(ft))}}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Local expression lowering (#if / #case / #pipe / #it)
// ─────────────────────────────────────────────────────────────────────────────

type localLowerer struct {
	target       string
	targetType   ast.FieldType
	bindingTypes map[string]string
	ds           *diag.Diagnostics
	counter      int
	bindings     []*turnoutpb.BindingModel
	itRef        string
	itType       ast.FieldType
	itAllowed    bool
}

func newLocalLowerer(target string, targetType ast.FieldType, bindingTypes map[string]string, ds *diag.Diagnostics) *localLowerer {
	return &localLowerer{target: target, targetType: targetType, bindingTypes: bindingTypes, ds: ds}
}

func (c *localLowerer) lowerTop(rhs ast.BindingRHS) []*turnoutpb.BindingModel {
	switch r := rhs.(type) {
	case *ast.IfCallRHS:
		c.lowerIfInto(c.target, c.targetType, r.Cond, r.Then, r.Else)
	case *ast.CaseCallRHS:
		c.lowerCaseInto(c.target, c.targetType, r.Subject, r.Arms)
	case *ast.PipeCallRHS:
		c.lowerPipeInto(c.target, c.targetType, r.Initial, r.Steps)
	default:
		c.emitValue(c.target, c.targetType, zeroLiteralFor(c.targetType))
	}
	if len(c.bindings) == 0 {
		c.emitValue(c.target, c.targetType, zeroLiteralFor(c.targetType))
	}
	// Attach the structured source expression to the user-declared name binding
	// so the HCL emitter can reproduce the original #if/#case/#pipe form.
	if extExpr := bindingRHSToProto(rhs); extExpr != nil {
		for _, b := range c.bindings {
			if b.Name == c.target {
				b.ExtExpr = extExpr
				break
			}
		}
	}
	return c.bindings
}

func (c *localLowerer) temp(prefix string) string {
	c.counter++
	return fmt.Sprintf("__local_%s_%s_%d", c.target, prefix, c.counter)
}

func (c *localLowerer) remember(name string, ft ast.FieldType) {
	c.bindingTypes[name] = fieldTypeToMethodType(ft)
}

func (c *localLowerer) appendBinding(b *turnoutpb.BindingModel, ft ast.FieldType) {
	c.bindings = append(c.bindings, b)
	c.remember(b.Name, ft)
}

func (c *localLowerer) emitValue(name string, ft ast.FieldType, lit ast.Literal) {
	c.appendBinding(&turnoutpb.BindingModel{Name: name, Type: ft.String(), Value: literalToStructpb(lit)}, ft)
}

func (c *localLowerer) emitIdentity(name string, ft ast.FieldType, ref string) {
	c.appendBinding(lowerSingleRefRHS(name, ft, &ast.SingleRefRHS{RefName: ref}), ft)
}

func (c *localLowerer) lowerExprInto(name string, ft ast.FieldType, e ast.LocalExpr) {
	switch x := e.(type) {
	case *ast.LocalLitExpr:
		c.emitValue(name, ft, x.Value)
	case *ast.LocalRefExpr:
		c.emitIdentity(name, ft, x.Name)
	case *ast.LocalItExpr:
		if !c.itAllowed {
			*c.ds = append(*c.ds, diag.ErrorAt(x.Pos.File, x.Pos.Line, x.Pos.Col,
				diag.CodeUnsupportedConstruct, "#it is only valid inside #pipe step expressions"))
			c.emitValue(name, ft, zeroLiteralFor(ft))
			return
		}
		c.emitIdentity(name, ft, c.itRef)
	case *ast.LocalCallExpr:
		c.lowerCallInto(name, ft, x)
	case *ast.LocalInfixExpr:
		c.lowerInfixInto(name, ft, x)
	case *ast.LocalIfExpr:
		c.lowerIfInto(name, ft, x.Cond, x.Then, x.Else)
	case *ast.LocalCaseExpr:
		c.lowerCaseInto(name, ft, x.Subject, x.Arms)
	case *ast.LocalPipeExpr:
		c.lowerPipeInto(name, ft, x.Initial, x.Steps)
	default:
		c.emitValue(name, ft, zeroLiteralFor(ft))
	}
}

func (c *localLowerer) lowerExprTemp(e ast.LocalExpr, hint string, ft ast.FieldType) (string, ast.FieldType) {
	name := c.temp(hint)
	c.lowerExprInto(name, ft, e)
	return name, ft
}

func (c *localLowerer) lowerFuncTemp(e ast.LocalExpr, hint string, ft ast.FieldType) string {
	ref, _ := c.lowerExprTemp(e, hint+"_value", ft)
	fnName := c.temp(hint + "_fn")
	c.emitIdentity(fnName, ft, ref)
	return fnName
}

func (c *localLowerer) lowerCallInto(name string, ft ast.FieldType, call *ast.LocalCallExpr) {
	args := make([]*turnoutpb.ArgModel, 0, len(call.Args))
	for i, arg := range call.Args {
		argType := c.inferLocalType(arg, ft)
		ref, _ := c.lowerExprTemp(arg, fmt.Sprintf("arg%d", i), argType)
		args = append(args, &turnoutpb.ArgModel{Ref: proto.String(ref)})
	}
	c.appendBinding(&turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   call.FnAlias,
			Args: args,
		}},
	}, ft)
}

func (c *localLowerer) lowerInfixInto(name string, ft ast.FieldType, infix *ast.LocalInfixExpr) {
	fn := infix.Op.FnAlias()
	if fn == "" {
		if ft == ast.FieldTypeStr {
			fn = "str_concat"
		} else {
			fn = "add"
		}
	}
	leftType, rightType := localOperandTypes(fn, ft)
	leftRef, _ := c.lowerExprTemp(infix.LHS, "lhs", leftType)
	rightRef, _ := c.lowerExprTemp(infix.RHS, "rhs", rightType)
	c.appendBinding(&turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   fn,
			Args: []*turnoutpb.ArgModel{{Ref: proto.String(leftRef)}, {Ref: proto.String(rightRef)}},
		}},
	}, ft)
}

func (c *localLowerer) lowerIfInto(name string, ft ast.FieldType, cond, thenExpr, elseExpr ast.LocalExpr) {
	condRef, _ := c.lowerExprTemp(cond, "cond", ast.FieldTypeBool)
	thenFn := c.lowerFuncTemp(thenExpr, "then", ft)
	elseFn := c.lowerFuncTemp(elseExpr, "else", ft)
	c.appendBinding(&turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Cond: &turnoutpb.CondExpr{
			Condition:  &turnoutpb.ArgModel{Ref: proto.String(condRef)},
			Then:       &turnoutpb.ArgModel{FuncRef: proto.String(thenFn)},
			ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String(elseFn)},
		}},
	}, ft)
}

// lowerCaseInto emits bindings in reverse arm order (last arm first). This is
// required to produce topologically sorted output: each CondExpr binding
// references the next arm's binding as its else-branch, so inner arms must be
// defined before the outer ones that reference them. The user's declared name
// is assigned to the outermost arm (i == 0) and is therefore emitted last.
func (c *localLowerer) lowerCaseInto(name string, ft ast.FieldType, subject ast.LocalExpr, arms []ast.LocalCaseArm) {
	subjectType := c.inferLocalType(subject, ft)
	subjectRef, _ := c.lowerExprTemp(subject, "subject", subjectType)
	fallbackFn := ""
	conditionalArms := make([]ast.LocalCaseArm, 0, len(arms))
	for _, arm := range arms {
		if _, ok := arm.Pattern.(*ast.WildcardCasePattern); ok {
			fallbackFn = c.lowerFuncTemp(arm.Expr, "case_default", ft)
			break
		}
		conditionalArms = append(conditionalArms, arm)
	}
	if fallbackFn == "" {
		fallbackFn = c.lowerFuncTemp(&ast.LocalLitExpr{Value: zeroLiteralFor(ft)}, "case_default", ft)
	}
	nextFn := fallbackFn
	for i := len(conditionalArms) - 1; i >= 0; i-- {
		arm := conditionalArms[i]
		condRef := c.lowerCasePatternCond(subjectRef, subjectType, arm)
		thenFn := c.lowerFuncTemp(arm.Expr, "case_then", ft)
		condName := c.temp("case_cond")
		if i == 0 {
			condName = name
		}
		c.appendBinding(&turnoutpb.BindingModel{
			Name: condName,
			Type: ft.String(),
			Expr: &turnoutpb.ExprModel{Cond: &turnoutpb.CondExpr{
				Condition:  &turnoutpb.ArgModel{Ref: proto.String(condRef)},
				Then:       &turnoutpb.ArgModel{FuncRef: proto.String(thenFn)},
				ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String(nextFn)},
			}},
		}, ft)
		nextFn = condName
	}
	if len(conditionalArms) == 0 {
		c.emitIdentity(name, ft, nextFn)
	}
}

func (c *localLowerer) lowerCasePatternCond(subjectRef string, subjectType ast.FieldType, arm ast.LocalCaseArm) string {
	var condRef string
	switch p := arm.Pattern.(type) {
	case *ast.LiteralCasePattern:
		litName := c.temp("case_lit")
		c.emitValue(litName, subjectType, p.Value)
		condRef = c.temp("case_match")
		c.appendBinding(&turnoutpb.BindingModel{
			Name: condRef,
			Type: ast.FieldTypeBool.String(),
			Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
				Fn:   "eq",
				Args: []*turnoutpb.ArgModel{{Ref: proto.String(subjectRef)}, {Ref: proto.String(litName)}},
			}},
		}, ast.FieldTypeBool)
	case *ast.VarBinderPattern:
		condRef = c.temp("case_bind")
		c.emitValue(condRef, ast.FieldTypeBool, &ast.BoolLiteral{Value: true})
	case *ast.TupleCasePattern:
		*c.ds = append(*c.ds, diag.ErrorAt(p.Pos.File, p.Pos.Line, p.Pos.Col,
			diag.CodeUnsupportedConstruct, "#case tuple patterns are not yet supported by runtime lowering"))
		condRef = c.temp("case_tuple_unsupported")
		c.emitValue(condRef, ast.FieldTypeBool, &ast.BoolLiteral{Value: false})
	default:
		condRef = c.temp("case_unsupported")
		c.emitValue(condRef, ast.FieldTypeBool, &ast.BoolLiteral{Value: false})
	}
	if arm.Guard == nil {
		return condRef
	}
	guardRef, _ := c.lowerExprTemp(arm.Guard, "case_guard", ast.FieldTypeBool)
	combined := c.temp("case_guarded")
	c.appendBinding(&turnoutpb.BindingModel{
		Name: combined,
		Type: ast.FieldTypeBool.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   "bool_and",
			Args: []*turnoutpb.ArgModel{{Ref: proto.String(condRef)}, {Ref: proto.String(guardRef)}},
		}},
	}, ast.FieldTypeBool)
	return combined
}

func (c *localLowerer) lowerPipeInto(name string, ft ast.FieldType, initial ast.LocalExpr, steps []ast.LocalExpr) {
	currentType := c.inferLocalType(initial, ft)
	currentRef, _ := c.lowerExprTemp(initial, "pipe_initial", currentType)
	prevItRef, prevItType, prevItAllowed := c.itRef, c.itType, c.itAllowed
	for i, step := range steps {
		stepName := name
		if i < len(steps)-1 {
			stepName = c.temp("pipe_step")
		}
		c.itRef, c.itType, c.itAllowed = currentRef, currentType, true
		stepType := ft
		if i < len(steps)-1 {
			stepType = c.inferLocalType(step, ft)
		}
		c.lowerExprInto(stepName, stepType, step)
		currentRef, currentType = stepName, stepType
	}
	c.itRef, c.itType, c.itAllowed = prevItRef, prevItType, prevItAllowed
	if len(steps) == 0 {
		c.emitIdentity(name, ft, currentRef)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// AST → proto LocalExprModel converters (for ext_expr population)
// ─────────────────────────────────────────────────────────────────────────────

func bindingRHSToProto(rhs ast.BindingRHS) *turnoutpb.LocalExprModel {
	switch r := rhs.(type) {
	case *ast.IfCallRHS:
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_IfExpr{IfExpr: &turnoutpb.LocalIfExprModel{
			Cond:       localExprToProto(r.Cond),
			Then:       localExprToProto(r.Then),
			ElseBranch: localExprToProto(r.Else),
		}}}
	case *ast.CaseCallRHS:
		arms := make([]*turnoutpb.LocalCaseArmModel, len(r.Arms))
		for i, arm := range r.Arms {
			a := &turnoutpb.LocalCaseArmModel{
				Pattern: localCasePatternToProto(arm.Pattern),
				Expr:    localExprToProto(arm.Expr),
			}
			if arm.Guard != nil {
				a.Guard = localExprToProto(arm.Guard)
			}
			arms[i] = a
		}
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_CaseExpr{CaseExpr: &turnoutpb.LocalCaseExprModel{
			Subject: localExprToProto(r.Subject),
			Arms:    arms,
		}}}
	case *ast.PipeCallRHS:
		steps := make([]*turnoutpb.LocalExprModel, len(r.Steps))
		for i, s := range r.Steps {
			steps[i] = localExprToProto(s)
		}
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_PipeExpr{PipeExpr: &turnoutpb.LocalPipeExprModel{
			Initial: localExprToProto(r.Initial),
			Steps:   steps,
		}}}
	default:
		return nil
	}
}

func localExprToProto(e ast.LocalExpr) *turnoutpb.LocalExprModel {
	if e == nil {
		return nil
	}
	switch x := e.(type) {
	case *ast.LocalRefExpr:
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Ref{Ref: &turnoutpb.LocalRefExprModel{Name: x.Name}}}
	case *ast.LocalLitExpr:
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Lit{Lit: &turnoutpb.LocalLitExprModel{Value: literalToStructpb(x.Value)}}}
	case *ast.LocalItExpr:
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_It{It: &turnoutpb.LocalItExprModel{}}}
	case *ast.LocalCallExpr:
		args := make([]*turnoutpb.LocalExprModel, len(x.Args))
		for i, a := range x.Args {
			args[i] = localExprToProto(a)
		}
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Call{Call: &turnoutpb.LocalCallExprModel{Fn: x.FnAlias, Args: args}}}
	case *ast.LocalInfixExpr:
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Infix{Infix: &turnoutpb.LocalInfixExprModel{
			Op:  int32(x.Op),
			Lhs: localExprToProto(x.LHS),
			Rhs: localExprToProto(x.RHS),
		}}}
	case *ast.LocalIfExpr:
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_IfExpr{IfExpr: &turnoutpb.LocalIfExprModel{
			Cond:       localExprToProto(x.Cond),
			Then:       localExprToProto(x.Then),
			ElseBranch: localExprToProto(x.Else),
		}}}
	case *ast.LocalCaseExpr:
		arms := make([]*turnoutpb.LocalCaseArmModel, len(x.Arms))
		for i, arm := range x.Arms {
			a := &turnoutpb.LocalCaseArmModel{
				Pattern: localCasePatternToProto(arm.Pattern),
				Expr:    localExprToProto(arm.Expr),
			}
			if arm.Guard != nil {
				a.Guard = localExprToProto(arm.Guard)
			}
			arms[i] = a
		}
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_CaseExpr{CaseExpr: &turnoutpb.LocalCaseExprModel{
			Subject: localExprToProto(x.Subject),
			Arms:    arms,
		}}}
	case *ast.LocalPipeExpr:
		steps := make([]*turnoutpb.LocalExprModel, len(x.Steps))
		for i, s := range x.Steps {
			steps[i] = localExprToProto(s)
		}
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_PipeExpr{PipeExpr: &turnoutpb.LocalPipeExprModel{
			Initial: localExprToProto(x.Initial),
			Steps:   steps,
		}}}
	default:
		return nil
	}
}

func localCasePatternToProto(p ast.LocalCasePattern) *turnoutpb.LocalCasePatternModel {
	if p == nil {
		return &turnoutpb.LocalCasePatternModel{Pattern: &turnoutpb.LocalCasePatternModel_Wildcard{Wildcard: &turnoutpb.LocalWildcardPatternModel{}}}
	}
	switch x := p.(type) {
	case *ast.WildcardCasePattern:
		return &turnoutpb.LocalCasePatternModel{Pattern: &turnoutpb.LocalCasePatternModel_Wildcard{Wildcard: &turnoutpb.LocalWildcardPatternModel{}}}
	case *ast.LiteralCasePattern:
		return &turnoutpb.LocalCasePatternModel{Pattern: &turnoutpb.LocalCasePatternModel_Lit{Lit: &turnoutpb.LocalLitPatternModel{Value: literalToStructpb(x.Value)}}}
	case *ast.VarBinderPattern:
		return &turnoutpb.LocalCasePatternModel{Pattern: &turnoutpb.LocalCasePatternModel_VarBinder{VarBinder: &turnoutpb.LocalVarBinderPatternModel{Name: x.Name}}}
	case *ast.TupleCasePattern:
		elems := make([]*turnoutpb.LocalCasePatternModel, len(x.Elems))
		for i, elem := range x.Elems {
			elems[i] = localCasePatternToProto(elem)
		}
		return &turnoutpb.LocalCasePatternModel{Pattern: &turnoutpb.LocalCasePatternModel_Tuple{Tuple: &turnoutpb.LocalTuplePatternModel{Elems: elems}}}
	default:
		return &turnoutpb.LocalCasePatternModel{Pattern: &turnoutpb.LocalCasePatternModel_Wildcard{Wildcard: &turnoutpb.LocalWildcardPatternModel{}}}
	}
}

func (c *localLowerer) inferLocalType(e ast.LocalExpr, fallback ast.FieldType) ast.FieldType {
	switch x := e.(type) {
	case *ast.LocalLitExpr:
		if ft, ok := ast.LiteralFieldType(x.Value); ok {
			return ft
		}
	case *ast.LocalRefExpr:
		if s, ok := c.bindingTypes[x.Name]; ok {
			if ft, ok := methodTypeToFieldType(s); ok {
				return ft
			}
		}
	case *ast.LocalItExpr:
		if c.itAllowed {
			return c.itType
		}
	case *ast.LocalCallExpr:
		return localFnReturnType(x.FnAlias, fallback)
	case *ast.LocalInfixExpr:
		fn := x.Op.FnAlias()
		if fn == "" {
			return fallback
		}
		return localFnReturnType(fn, fallback)
	case *ast.LocalIfExpr:
		return c.inferLocalType(x.Then, fallback)
	case *ast.LocalCaseExpr:
		for _, arm := range x.Arms {
			return c.inferLocalType(arm.Expr, fallback)
		}
	case *ast.LocalPipeExpr:
		if len(x.Steps) > 0 {
			return c.inferLocalType(x.Steps[len(x.Steps)-1], fallback)
		}
		return c.inferLocalType(x.Initial, fallback)
	}
	return fallback
}

func methodTypeToFieldType(s string) (ast.FieldType, bool) {
	switch s {
	case "number":
		return ast.FieldTypeNumber, true
	case "string":
		return ast.FieldTypeStr, true
	case "boolean":
		return ast.FieldTypeBool, true
	case "arr<number>":
		return ast.FieldTypeArrNumber, true
	case "arr<str>":
		return ast.FieldTypeArrStr, true
	case "arr<bool>":
		return ast.FieldTypeArrBool, true
	default:
		return 0, false
	}
}

func localFnReturnType(fn string, fallback ast.FieldType) ast.FieldType {
	switch fn {
	case "gt", "gte", "lt", "lte", "eq", "neq", "bool_and", "bool_or", "bool_xor", "str_includes", "str_starts", "str_ends", "arr_includes":
		return ast.FieldTypeBool
	case "str_concat":
		return ast.FieldTypeStr
	case "arr_concat", "arr_get":
		return fallback
	default:
		return ast.FieldTypeNumber
	}
}

func localOperandTypes(fn string, fallback ast.FieldType) (ast.FieldType, ast.FieldType) {
	switch fn {
	case "str_concat", "str_includes", "str_starts", "str_ends":
		return ast.FieldTypeStr, ast.FieldTypeStr
	case "bool_and", "bool_or", "bool_xor":
		return ast.FieldTypeBool, ast.FieldTypeBool
	case "eq", "neq":
		return fallback, fallback
	default:
		return ast.FieldTypeNumber, ast.FieldTypeNumber
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Arg lowering
// ─────────────────────────────────────────────────────────────────────────────

func fieldTypeToMethodType(ft ast.FieldType) string {
	switch ft {
	case ast.FieldTypeNumber:
		return "number"
	case ast.FieldTypeStr:
		return "string"
	case ast.FieldTypeBool:
		return "boolean"
	case ast.FieldTypeArrNumber:
		return "arr<number>"
	case ast.FieldTypeArrStr:
		return "arr<str>"
	case ast.FieldTypeArrBool:
		return "arr<bool>"
	default:
		return "number"
	}
}

type methodEntry struct {
	inputType  string
	outputType string
	qualName   string
}

var methodTable = []methodEntry{
	{"number", "string", "transformFnNumber::toStr"},
	{"number", "number", "transformFnNumber::abs"},
	{"number", "number", "transformFnNumber::floor"},
	{"number", "number", "transformFnNumber::ceil"},
	{"number", "number", "transformFnNumber::round"},
	{"number", "number", "transformFnNumber::negate"},
	{"string", "number", "transformFnString::toNumber"},
	{"string", "string", "transformFnString::trim"},
	{"string", "string", "transformFnString::toLowerCase"},
	{"string", "string", "transformFnString::toUpperCase"},
	{"string", "number", "transformFnString::length"},
	{"boolean", "boolean", "transformFnBoolean::not"},
	{"boolean", "string", "transformFnBoolean::toStr"},
	{"array", "number", "transformFnArray::length"},
	{"array", "boolean", "transformFnArray::isEmpty"},
}

func lookupMethod(method, inputType string) (qualName, outputType string, ok bool) {
	for _, e := range methodTable {
		if e.inputType == inputType && methodBaseName(e.qualName) == method {
			return e.qualName, e.outputType, true
		}
	}
	return "", "", false
}

func methodBaseName(qualName string) string {
	if i := strings.Index(qualName, "::"); i >= 0 {
		return qualName[i+2:]
	}
	return qualName
}

func lowerMethodCallArg(a *ast.MethodCallArg, bindingTypes map[string]string) *turnoutpb.ArgModel {
	receiverType, ok := bindingTypes[a.Receiver]
	if !ok {
		return &turnoutpb.ArgModel{Ref: proto.String(a.Receiver)}
	}

	fns := make([]string, 0, len(a.Methods))
	currentType := receiverType
	for _, method := range a.Methods {
		qual, outType, found := lookupMethod(method, currentType)
		if !found {
			return &turnoutpb.ArgModel{Ref: proto.String(a.Receiver)}
		}
		fns = append(fns, qual)
		currentType = outType
	}
	return &turnoutpb.ArgModel{Transform: &turnoutpb.TransformArg{Ref: a.Receiver, Fn: fns}}
}

func lowerArgWithTypes(arg ast.Arg, bindingTypes map[string]string) *turnoutpb.ArgModel {
	switch a := arg.(type) {
	case *ast.RefArg:
		return &turnoutpb.ArgModel{Ref: proto.String(a.Name)}
	case *ast.LitArg:
		return &turnoutpb.ArgModel{Lit: literalToStructpb(a.Value)}
	case *ast.FuncRefArg:
		return &turnoutpb.ArgModel{FuncRef: proto.String(a.FnName)}
	case *ast.StepRefArg:
		return &turnoutpb.ArgModel{StepRef: proto.Int32(int32(a.Index))}
	case *ast.TransformArg:
		return &turnoutpb.ArgModel{Transform: &turnoutpb.TransformArg{Ref: a.Ref, Fn: a.Fn}}
	case *ast.MethodCallArg:
		return lowerMethodCallArg(a, bindingTypes)
	default:
		return &turnoutpb.ArgModel{}
	}
}

func lowerArgsWithTypes(args []ast.Arg, bindingTypes map[string]string) []*turnoutpb.ArgModel {
	result := make([]*turnoutpb.ArgModel, len(args))
	for i, a := range args {
		result[i] = lowerArgWithTypes(a, bindingTypes)
	}
	return result
}

// ─────────────────────────────────────────────────────────────────────────────
// prepareResolver — abstracts placeholder default resolution
// ─────────────────────────────────────────────────────────────────────────────

type prepareResolver interface {
	resolveDefault(bindingName string, ft ast.FieldType, pos ast.Pos, ds *diag.Diagnostics) ast.Literal
}

// ── Action-level resolver ──

type actionPrepareResolver struct {
	index  map[string]ast.ActionPrepareSource
	schema state.Schema
}

func newActionPrepareResolver(prepare *ast.PrepareBlock, schema state.Schema) prepareResolver {
	index := make(map[string]ast.ActionPrepareSource)
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

func zeroLiteralFor(ft ast.FieldType) ast.Literal {
	switch ft {
	case ast.FieldTypeNumber:
		return &ast.NumberLiteral{Value: 0}
	case ast.FieldTypeStr:
		return &ast.StringLiteral{Value: ""}
	case ast.FieldTypeBool:
		return &ast.BoolLiteral{Value: false}
	default:
		return &ast.ArrayLiteral{}
	}
}
