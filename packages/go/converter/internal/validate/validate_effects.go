package validate

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

// ─────────────────────────────────────────────────────────────────────────────
// Group C — Effect DSL / sigil validation
// ─────────────────────────────────────────────────────────────────────────────

func validateActionEffects(a *turnoutpb.ActionModel, scope map[string]bindingInfo, schema state.Schema, ds *diag.Diagnostics) {
	preparedNames := map[string]bool{}
	mergedNames := map[string]bool{}

	seen := map[string]bool{}
	for _, e := range a.Prepare {
		if seen[e.Binding] {
			*ds = append(*ds, diag.Errorf(diag.CodeDuplicatePrepareEntry,
				"action %q: duplicate prepare entry for binding %q", a.Id, e.Binding))
			continue
		}
		seen[e.Binding] = true
		preparedNames[e.Binding] = true

		if _, ok := scope[e.Binding]; !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedPrepareBinding,
				"action %q: prepare binding %q not found in prog", a.Id, e.Binding))
		}

		if e.FromState != nil {
			validateStatePath(*e.FromState, schema, ds)
		}
	}

	seen = map[string]bool{}
	for _, e := range a.Merge {
		if seen[e.Binding] {
			*ds = append(*ds, diag.Errorf(diag.CodeDuplicateMergeEntry,
				"action %q: duplicate merge entry for binding %q", a.Id, e.Binding))
			continue
		}
		seen[e.Binding] = true
		mergedNames[e.Binding] = true

		srcInfo, inScope := scope[e.Binding]
		if !inScope {
			*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedMergeBinding,
				"action %q: merge binding %q not found in prog", a.Id, e.Binding))
		}

		if e.ToState != "" {
			if !isValidStatePath(e.ToState) {
				*ds = append(*ds, diag.Errorf(diag.CodeInvalidStatePath,
					"action %q: to_state %q is not a valid dotted path", a.Id, e.ToState))
			} else if meta, ok := schema.Get(e.ToState); !ok {
				*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedStatePath,
					"action %q: to_state %q is not declared in the state schema", a.Id, e.ToState))
			} else if inScope && srcInfo.fieldType != meta.Type {
				*ds = append(*ds, diag.Errorf(diag.CodeStateTypeMismatch,
					"action %q: merge binding %q has type %s but STATE field %q has type %s",
					a.Id, e.Binding, srcInfo.fieldType, e.ToState, meta.Type))
			}
		}
	}

	for name, info := range scope {
		switch info.sigil {
		case ast.SigilIngress:
			if !preparedNames[name] {
				*ds = append(*ds, diag.Errorf(diag.CodeMissingPrepareEntry,
					"action %q: binding %q has ~> sigil but no prepare entry", a.Id, name))
			}
		case ast.SigilEgress:
			if !mergedNames[name] {
				*ds = append(*ds, diag.Errorf(diag.CodeMissingMergeEntry,
					"action %q: binding %q has <~ sigil but no merge entry", a.Id, name))
			}
		case ast.SigilBiDir:
			inPrepare := preparedNames[name]
			inMerge := mergedNames[name]
			if !inPrepare && !inMerge {
				*ds = append(*ds, diag.Errorf(diag.CodeMissingPrepareEntry,
					"action %q: binding %q has <~> sigil but no prepare entry", a.Id, name))
				*ds = append(*ds, diag.Errorf(diag.CodeMissingMergeEntry,
					"action %q: binding %q has <~> sigil but no merge entry", a.Id, name))
			} else if inPrepare && !inMerge {
				*ds = append(*ds, diag.Errorf(diag.CodeBidirMissingMergeEntry,
					"action %q: binding %q has <~> sigil: appears in prepare but not in merge", a.Id, name))
			} else if !inPrepare && inMerge {
				*ds = append(*ds, diag.Errorf(diag.CodeBidirMissingPrepareEntry,
					"action %q: binding %q has <~> sigil: appears in merge but not in prepare", a.Id, name))
			}
		}
	}

	for name := range preparedNames {
		info, ok := scope[name]
		if !ok {
			continue
		}
		if info.sigil != ast.SigilIngress && info.sigil != ast.SigilBiDir {
			*ds = append(*ds, diag.Errorf(diag.CodeSpuriousPrepareEntry,
				"action %q: prepare entry for %q has no corresponding ~> or <~> sigil in prog", a.Id, name))
		}
	}
	for name := range mergedNames {
		info, ok := scope[name]
		if !ok {
			continue
		}
		if info.sigil != ast.SigilEgress && info.sigil != ast.SigilBiDir {
			*ds = append(*ds, diag.Errorf(diag.CodeSpuriousMergeEntry,
				"action %q: merge entry for %q has no corresponding <~ or <~> sigil in prog", a.Id, name))
		}
	}
}

func validateNextRule(nr *turnoutpb.NextRuleModel, ctx progValidateCtx, actionScope map[string]bindingInfo, ds *diag.Diagnostics) {
	for _, e := range nr.Prepare {
		count := 0
		if e.FromAction != nil {
			count++
		}
		if e.FromState != nil {
			count++
		}
		if e.FromLiteral != nil {
			count++
		}
		if count != 1 {
			*ds = append(*ds, diag.Errorf(diag.CodeInvalidTransitionIngress,
				"transition prepare entry for %q must have exactly one of from_action, from_state, from_literal; got %d",
				e.Binding, count))
		}
		if e.FromState != nil {
			validateStatePath(*e.FromState, ctx.schema, ds)
		}
		// 3-A: verify the from_action binding exists in the source action's compute prog.
		if e.FromAction != nil {
			srcName := *e.FromAction
			if _, ok := actionScope[srcName]; !ok {
				*ds = append(*ds, diag.Errorf(diag.CodeNextPrepareFromActionUnknown,
					"action %q: next prepare binding %q references from_action %q which does not exist in this action's compute prog",
					ctx.actionID, e.Binding, srcName))
			}
		}
	}

	if nr.Compute == nil {
		return
	}

	nextScope := validateProg(nr.Compute.Prog, ctx, true, "", nil, ds)

	if cond := nr.Compute.Condition; cond != "" {
		info, ok := nextScope[cond]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeSCNNextComputeNotBool,
				"next rule condition %q is not defined in prog", cond))
		} else if info.fieldType != ast.FieldTypeBool {
			*ds = append(*ds, diag.Errorf(diag.CodeSCNNextComputeNotBool,
				"next rule condition %q has type %s; bool required", cond, info.fieldType))
		}
	}

	// 3-B: verify type consistency between from_action source and target binding.
	for _, e := range nr.Prepare {
		if e.FromAction == nil {
			continue
		}
		srcName := *e.FromAction
		srcInfo, srcOK := actionScope[srcName]
		dstInfo, dstOK := nextScope[e.Binding]
		if srcOK && dstOK && srcInfo.fieldType != dstInfo.fieldType {
			*ds = append(*ds, diag.Errorf(diag.CodeNextPrepareFromActionTypeMismatch,
				"action %q: next prepare binding %q (type %s) does not match from_action %q (type %s)",
				ctx.actionID, e.Binding, dstInfo.fieldType, srcName, srcInfo.fieldType))
		}
	}
}
