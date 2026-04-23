// Package lower lowers a parsed TurnFile AST to the canonical proto model
// (turnoutpb.TurnModel), ready for validation and emission. No text is
// produced here; the emitter (emit package) converts TurnModel to HCL text or
// JSON.
package lower

import (
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

// Lower converts a parsed TurnFile and resolved STATE schema to a canonical
// proto model plus a sidecar that carries DSL metadata not representable in
// proto (sigils, view blocks, action text).
func Lower(file *ast.TurnFile, schema state.Schema) (*turnoutpb.TurnModel, *Sidecar, diag.Diagnostics) {
	var ds diag.Diagnostics
	sc := newSidecar()

	stateModel := lowerStateBlock(file.StateSource, schema, &ds)

	tm := &turnoutpb.TurnModel{State: stateModel}

	for _, s := range file.Scenes {
		tm.Scenes = append(tm.Scenes, lowerSceneBlock(s, schema, sc, &ds))
	}

	tm.Routes = lowerRouteBlocks(file.Routes)

	if ds.HasErrors() {
		return nil, nil, ds
	}
	return tm, sc, ds
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
			Prog: lowerProgInner(a.Compute.Prog, resolver, sceneID, a.ID, sc, ds),
		}
	}

	am.Prepare = lowerPrepare(a.Prepare)
	am.Merge = lowerMerge(a.Merge)
	am.Publish = lowerPublish(a.Publish)

	for _, nr := range a.Next {
		am.Next = append(am.Next, lowerNextRule(nr, schema, sceneID, a.ID, sc, ds))
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

func lowerNextRule(nr *ast.NextRule, schema state.Schema, sceneID, actionID string, sc *Sidecar, ds *diag.Diagnostics) *turnoutpb.NextRuleModel {
	resolver := newTransitionPrepareResolver(nr.Prepare, schema)

	pbNR := &turnoutpb.NextRuleModel{Action: nr.ActionID}

	if nr.Compute != nil {
		pbNR.Compute = &turnoutpb.NextComputeModel{
			Condition: nr.Compute.Condition,
			Prog:      lowerProgInner(nr.Compute.Prog, resolver, sceneID, actionID, sc, ds),
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

func lowerProgInner(prog *ast.ProgBlock, resolver prepareResolver, sceneID, actionID string, sc *Sidecar, ds *diag.Diagnostics) *turnoutpb.ProgModel {
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
		bindings := lowerBinding(decl, resolver, sceneID, actionID, prog.Name, sc, ds, bindingTypes)
		pm.Bindings = append(pm.Bindings, bindings...)
	}
	return pm
}

// lowerBinding lowers one BindingDecl to one or more BindingModels.
// Sigils are captured in the sidecar keyed by (sceneID, actionID, progName, bindingName).
func lowerBinding(decl *ast.BindingDecl, resolver prepareResolver, sceneID, actionID, progName string, sc *Sidecar, ds *diag.Diagnostics, bindingTypes map[string]string) []*turnoutpb.BindingModel {
	name := decl.Name
	ft := decl.Type

	var bindings []*turnoutpb.BindingModel
	switch rhs := decl.RHS.(type) {
	case *ast.LiteralRHS:
		bindings = []*turnoutpb.BindingModel{lowerLiteralRHS(name, ft, rhs)}
	case *ast.PlaceholderRHS:
		bindings = []*turnoutpb.BindingModel{lowerPlaceholderRHS(name, ft, decl.Pos, resolver, ds)}
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
				sc.Sigils[BindingKey{SceneID: sceneID, ActionID: actionID, ProgName: progName, BindingName: name}] = decl.Sigil
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
	default:
		return "array"
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
