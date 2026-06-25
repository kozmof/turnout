package validate

import (
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/localexpr"
	"github.com/kozmof/turnout/packages/go/converter/internal/names"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

// ─────────────────────────────────────────────────────────────────────────────
// Group B — Prog / binding validation
// ─────────────────────────────────────────────────────────────────────────────

// ── Scope lookup abstraction ─────────────────────────────────────────────────
//
// scopeLookup is a read-only view of a binding scope. It is implemented by
// mapScope (a plain map wrapper) and scopeChain (a linked-scope for #case
// var-binder arms). Using an interface avoids O(n) map copies per arm.

type scopeLookup interface {
	get(name string) (bindingInfo, bool)
}

// mapScope wraps a flat map[string]bindingInfo so it satisfies scopeLookup.
type mapScope map[string]bindingInfo

func (m mapScope) get(name string) (bindingInfo, bool) {
	v, ok := m[name]
	return v, ok
}

// scopeChain extends a parent scopeLookup with a single local binding.
// It is created by protoPatternScopeBindings for var-binder case arms.
type scopeChain struct {
	name   string
	info   bindingInfo
	parent scopeLookup
}

func (c *scopeChain) get(name string) (bindingInfo, bool) {
	if name == c.name {
		return c.info, true
	}
	return c.parent.get(name)
}

// progValidateCtx bundles the stable context fields threaded through prog
// validation: schema and scene/action identity.
type progValidateCtx struct {
	schema   state.Schema
	sceneID  string
	actionID string
}

func validateProg(prog *turnoutpb.ProgModel, ctx progValidateCtx, isTransition bool, root string, mergeNames []string, ds *diag.DiagSink) map[string]bindingInfo {
	if prog == nil {
		return map[string]bindingInfo{}
	}
	posMap := buildPosMap(prog.Bindings)
	scope, dependencies := buildBindingScope(prog, ds)
	acyclic := detectCycles(prog.Name, dependencies, prog.Bindings, posMap, ds)
	validateBindingTypes(prog, scope, isTransition, posMap, ds)
	if !isTransition && root != "" {
		detectUnusedBindings(prog.Name, root, mergeNames, prog.Bindings, dependencies, acyclic, posMap, ds)
	}
	return scope
}

// detectUnusedBindings warns about bindings that are not reachable from the
// compute root or any merge/condition exit node. It performs a DFS forward
// through the dependency graph (dependencies[b] = list of bindings that b depends on)
// starting from exit nodes, then flags any binding not reached.
// Generated internal names (prefixed with __if_ or __local_) are skipped.
// acyclic is the set of non-cyclic binding names returned by detectCycles;
// cyclic bindings are skipped here because they already carry a CodeCyclicBinding error.
func detectUnusedBindings(progName, root string, mergeNames []string, bindings []*turnoutpb.BindingModel, dependencies map[string][]string, acyclic map[string]bool, posMap map[string]ast.Pos, ds *diag.DiagSink) {
	reachable := make(map[string]bool, len(bindings))
	var mark func(string)
	mark = func(name string) {
		if reachable[name] {
			return
		}
		reachable[name] = true
		for _, dep := range dependencies[name] {
			mark(dep)
		}
	}
	mark(root)
	for _, n := range mergeNames {
		mark(n)
	}
	for _, b := range bindings {
		if reachable[b.Name] {
			continue
		}
		if !acyclic[b.Name] {
			// Already reported as a cycle error; suppress the redundant unused warning.
			continue
		}
		if names.IsGeneratedIfCondName(b.Name) || names.IsGeneratedLocalName(b.Name) {
			continue
		}
		pos := posMap[b.Name]
		ds.Append(diag.WarnAt(pos.File, pos.Line, pos.Col, diag.CodeUnusedBinding,
			"prog %q: binding %q is declared but never used", progName, b.Name))
	}
}

// buildBindingScope registers all bindings into the scope map, detects duplicate
// names, records sigils, and builds the dependency map used by detectCycles.
// dependencies[b] is the list of binding names that b directly depends on.
func buildBindingScope(prog *turnoutpb.ProgModel, ds *diag.DiagSink) (map[string]bindingInfo, map[string][]string) {
	scope := make(map[string]bindingInfo, len(prog.Bindings))
	dependencies := make(map[string][]string, len(prog.Bindings))
	seen := make(map[string]bool, len(prog.Bindings))
	for _, b := range prog.Bindings {
		if seen[b.Name] {
			ds.Append(diag.Errorf(diag.CodeDuplicateBinding,
				"duplicate binding name %q in prog %q", b.Name, prog.Name))
		} else {
			seen[b.Name] = true
		}
		ft, ftOK := ast.FieldTypeFromString(b.Type)
		if !ftOK {
			ds.Append(diag.Errorf(diag.CodeTypeMismatch,
				"binding %q: unknown type string %q", b.Name, b.Type))
			continue
		}
		sigil := ast.SigilFromInt32(prog.Sigils[b.Name])
		scope[b.Name] = bindingInfo{
			fieldType: ft,
			kind:      bindingKindFor(b),
			sigil:     sigil,
		}
		var refs []string
		if b.Expr != nil {
			collectExprBindingRefs(b.Expr, &refs)
		} else if b.ExtExpr != nil {
			collectLocalExprBindingRefs(b.ExtExpr, &refs)
		}
		// Deduplicate refs so that Kahn's dependentCount counts each dependency once,
		// regardless of how many times a binding name appears in function arguments.
		if len(refs) > 1 {
			refSeen := make(map[string]struct{}, len(refs))
			unique := make([]string, 0, len(refs))
			for _, r := range refs {
				if _, ok := refSeen[r]; !ok {
					refSeen[r] = struct{}{}
					unique = append(unique, r)
				}
			}
			refs = unique
		}
		dependencies[b.Name] = refs
	}
	return scope, dependencies
}

// validateBindingTypes runs per-binding structural and type checks against the
// already-built scope. Handles reserved names, transition sigil constraints,
// literal type conformance, and expr/ext_expr type checking.
func validateBindingTypes(prog *turnoutpb.ProgModel, scope map[string]bindingInfo, isTransition bool, posMap map[string]ast.Pos, ds *diag.DiagSink) {
	for _, b := range prog.Bindings {
		ft, ftOK := ast.FieldTypeFromString(b.Type)
		if !ftOK {
			ds.Append(diag.Errorf(diag.CodeTypeMismatch,
				"binding %q: unknown type string %q", b.Name, b.Type))
			continue
		}
		sigil := ast.SigilFromInt32(prog.Sigils[b.Name])
		pos := posMap[b.Name]

		if strings.HasPrefix(b.Name, "__") {
			if !names.IsGeneratedIfCondName(b.Name) && !names.IsGeneratedLocalName(b.Name) {
				ds.Append(diag.Errorf(diag.CodeReservedName,
					"binding %q: names starting with __ are reserved", b.Name))
			}
		}

		if isTransition && (sigil == ast.SigilEgress || sigil == ast.SigilBiDir) {
			if pos.File != "" {
				ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeTransitionOutputSigil,
					"binding %q: output sigil %s is not allowed in transition progs", b.Name, sigil))
			} else {
				ds.Append(diag.Errorf(diag.CodeTransitionOutputSigil,
					"binding %q: output sigil %s is not allowed in transition progs", b.Name, sigil))
			}
		}

		// For #if/#case/#pipe root bindings the lowerer sets both Expr (consumed
		// by the TS runtime executor) and ExtExpr (used only for HCL emission).
		// When ExtExpr is present, validate against the structured tree and skip
		// the flat-Expr path — the two encode the same semantics and would
		// produce duplicate diagnostics if both were checked.
		if b.ExtExpr != nil {
			validateNoEmptyArrayLitArgs(b, ds)
			validateExtExprProto(b, b.ExtExpr, scope, ds)
			continue
		}

		if b.Value != nil {
			if !structpbMatchesFieldType(b.Value, ft) {
				// NonIntegerValue fires when a non-numeric literal is assigned to a :number
				// binding; all other type mismatches use the generic TypeMismatch code.
				code := diag.CodeTypeMismatch
				if ft == ast.FieldTypeNumber {
					code = diag.CodeNonIntegerValue
				}
				if pos.File != "" {
					ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, code,
						"binding %q: literal value does not match declared type %s", b.Name, b.Type))
				} else {
					ds.Append(diag.Errorf(code,
						"binding %q: literal value does not match declared type %s", b.Name, b.Type))
				}
			}
			if ft.IsArray() {
				validateArrayLiteral(b.Value, ft, b.Name, ds)
			}
		}

		if b.Expr != nil {
			validateNoEmptyArrayLitArgs(b, ds)
			switch {
			case b.Expr.Combine != nil:
				validateCombine(b, b.Expr.Combine, scope, ds)
			case b.Expr.Pipe != nil:
				validatePipe(b, b.Expr.Pipe, scope, ds)
			case b.Expr.Cond != nil:
				validateCond(b, b.Expr.Cond, scope, ds)
			}
		}
	}
}

func posFromProto(sp *turnoutpb.SourcePos) ast.Pos {
	if sp == nil {
		return ast.Pos{}
	}
	return ast.Pos{File: sp.File, Line: int(sp.Line), Col: int(sp.Col)}
}

func buildPosMap(bindings []*turnoutpb.BindingModel) map[string]ast.Pos {
	m := make(map[string]ast.Pos, len(bindings))
	for _, b := range bindings {
		if b.SourcePos != nil {
			m[b.Name] = posFromProto(b.SourcePos)
		}
	}
	return m
}

// ─────────────────────────────────────────────────────────────────────────────
// Binding cycle detection
// ─────────────────────────────────────────────────────────────────────────────

// detectCycles reports a CodeCyclicBinding diagnostic for each binding that
// participates in a reference cycle. Cycles cause infinite recursion in the
// TypeScript runtime's buildExecutionTree and must be caught at validation time.
//
// Returns the set of acyclic binding names (those successfully processed by
// Kahn's algorithm). Callers can use this set to skip cyclic bindings in
// subsequent passes (e.g. detectUnusedBindings) without repeating the topology work.
//
// Algorithm: Kahn's topological sort on the dependency graph.
// dependencies[b] = bindings that b depends on, so dependentCount tracks how
// many bindings depend on each node. Nodes with dependentCount 0 have no
// consumers and are dequeued first (consumer-first order — reverse of execution order).
// This direction is non-standard but cycle detection is direction-agnostic:
// a cycle in the dependency graph is the same cycle in its reverse.
// Nodes never dequeued are in cycles. A secondary targeted DFS over those
// nodes extracts one example cycle path for the error message.
func detectCycles(progName string, dependencies map[string][]string, bindings []*turnoutpb.BindingModel, posMap map[string]ast.Pos, ds *diag.DiagSink) map[string]bool {
	// --- Phase 1: Kahn's algorithm ---
	dependentCount := make(map[string]int, len(bindings))
	for _, b := range bindings {
		if _, ok := dependentCount[b.Name]; !ok {
			dependentCount[b.Name] = 0
		}
		for _, dep := range dependencies[b.Name] {
			dependentCount[dep]++
		}
	}

	queue := make([]string, 0, len(bindings))
	for _, b := range bindings {
		if dependentCount[b.Name] == 0 {
			queue = append(queue, b.Name)
		}
	}

	processed := make(map[string]bool, len(bindings))
	for head := 0; head < len(queue); head++ {
		n := queue[head]
		processed[n] = true
		for _, dep := range dependencies[n] {
			dependentCount[dep]--
			if dependentCount[dep] == 0 {
				queue = append(queue, dep)
			}
		}
	}

	// Nodes not processed are in cycles.
	cyclic := make(map[string]bool)
	for _, b := range bindings {
		if !processed[b.Name] {
			cyclic[b.Name] = true
		}
	}
	if len(cyclic) == 0 {
		return processed
	}

	// --- Phase 2: extract one example cycle path per cycle via iterative DFS ---
	//
	// Each frame tracks the node being visited and the index of the next dependency
	// to explore. On first visit (depIdx == 0) the node is pushed onto pathStack and
	// coloured inStack. When all deps are exhausted the node is coloured done and
	// popped from pathStack. A back-edge (dep already inStack) identifies the cycle
	// entry point; we extract the cycle segment from pathStack at that point.
	type dfsFrame struct {
		name   string
		depIdx int
	}

	reported := make(map[string]bool)
	color := make(map[string]int) // 0=unvisited 1=inStack 2=done
	pathStack := make([]string, 0, len(cyclic))
	frameStack := make([]dfsFrame, 0, len(cyclic))

	for _, b := range bindings {
		if !cyclic[b.Name] || color[b.Name] != 0 {
			continue
		}
		frameStack = append(frameStack, dfsFrame{name: b.Name, depIdx: 0})
		for len(frameStack) > 0 {
			top := &frameStack[len(frameStack)-1]
			name := top.name
			if top.depIdx == 0 {
				// First visit: mark inStack and push onto path.
				color[name] = 1
				pathStack = append(pathStack, name)
			}
			deps := dependencies[name]
			advanced := false
			for top.depIdx < len(deps) {
				dep := deps[top.depIdx]
				top.depIdx++
				if !cyclic[dep] {
					continue
				}
				if color[dep] == 0 {
					// Unvisited cyclic node — push and recurse.
					frameStack = append(frameStack, dfsFrame{name: dep, depIdx: 0})
					advanced = true
					break
				}
				if color[dep] == 1 && !reported[dep] {
					// Back edge: dep is already on the path — emit cycle.
					reported[dep] = true
					start := 0
					for i, n := range pathStack {
						if n == dep {
							start = i
							break
						}
					}
					cycleLen := len(pathStack) - start
					path := make([]string, cycleLen+1)
					copy(path, pathStack[start:])
					path[cycleLen] = dep
					msg := strings.Join(path, " → ")
					pos := posMap[dep]
					if pos.File != "" {
						ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeCyclicBinding,
							"prog %q: binding cycle: %s", progName, msg))
					} else {
						ds.Append(diag.Errorf(diag.CodeCyclicBinding,
							"prog %q: binding cycle: %s", progName, msg))
					}
				}
			}
			if !advanced {
				// All deps exhausted: mark done, pop from path and frame stack.
				color[name] = 2
				pathStack = pathStack[:len(pathStack)-1]
				frameStack = frameStack[:len(frameStack)-1]
			}
		}
	}
	return processed
}

func collectExprBindingRefs(expr *turnoutpb.ExprModel, refs *[]string) {
	if expr == nil {
		return
	}
	if expr.Combine != nil {
		for _, arg := range expr.Combine.Args {
			collectArgBindingRefs(arg, refs)
		}
	}
	if expr.Pipe != nil {
		for _, p := range expr.Pipe.Params {
			if p.SourceIdent != "" {
				*refs = append(*refs, p.SourceIdent)
			}
		}
		for _, step := range expr.Pipe.Steps {
			for _, arg := range step.Args {
				collectArgBindingRefs(arg, refs)
			}
		}
	}
	if expr.Cond != nil {
		collectArgBindingRefs(expr.Cond.Condition, refs)
		collectArgBindingRefs(expr.Cond.Then, refs)
		collectArgBindingRefs(expr.Cond.ElseBranch, refs)
	}
}

func collectArgBindingRefs(arg *turnoutpb.ArgModel, refs *[]string) {
	if arg == nil {
		return
	}
	if arg.Ref != nil && *arg.Ref != "" {
		*refs = append(*refs, *arg.Ref)
	}
	if arg.FuncRef != nil && *arg.FuncRef != "" {
		*refs = append(*refs, *arg.FuncRef)
	}
	if arg.Transform != nil && arg.Transform.Ref != "" {
		*refs = append(*refs, arg.Transform.Ref)
	}
	// step_ref is a numeric pipe-step index, not a binding name — skip.
}

// collectLocalExprBindingRefs extracts binding name references from a LocalExprModel
// for cycle detection. Used for ext_expr bindings that have no Expr counterpart.
func collectLocalExprBindingRefs(e *turnoutpb.LocalExprModel, refs *[]string) {
	localexpr.WalkProto(e, func(node *turnoutpb.LocalExprModel) {
		if ref, ok := node.Expr.(*turnoutpb.LocalExprModel_Ref); ok {
			*refs = append(*refs, ref.Ref.GetName())
		}
	})
}
