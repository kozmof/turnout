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

// errAtBinding builds an error anchored at a binding's source position, falling
// back to a position-less diagnostic when the model carries none.
//
// Prepare and merge entries are hoisted out of the compute block during
// lowering, so by the time they are validated they name a binding without
// pointing at one. The binding's own position, carried on bindingInfo, is what
// lets these errors name the line the author actually wrote.
func errAtBinding(info bindingInfo, code diag.ErrorCode, format string, args ...any) diag.Diagnostic {
	if p := info.pos; p != nil {
		return diag.ErrorAt(p.File, int(p.Line), int(p.Col), code, format, args...)
	}
	return diag.Errorf(code, format, args...)
}

// validateActionEffects checks the prepare and merge entries hoisted from the
// action's inline IO clauses. Every entry was generated from one binding of this
// action's compute block, so what is left to check is the STATE side: the paths
// exist, and the value written matches the field's declared type.
func validateActionEffects(a *turnoutpb.ActionModel, scope map[string]bindingInfo, schema state.Schema, ds *diag.DiagSink) {
	for _, e := range a.Prepare {
		if e.FromState != nil {
			validateStatePath(*e.FromState, schema, ds)
		}
	}

	for _, e := range a.Merge {
		srcInfo, inScope := scope[e.Binding]

		if e.ToState == "" {
			ds.Append(errAtBinding(srcInfo, diag.CodeMissingStatePath,
				"action %q: merge entry for binding %q has no to_state path", a.Id, e.Binding))
		} else if !isValidStatePath(e.ToState) {
			ds.Append(errAtBinding(srcInfo, diag.CodeInvalidStatePath,
				"action %q: to_state %q is not a valid dotted path", a.Id, e.ToState))
		} else if meta, ok := schema.Get(e.ToState); !ok {
			ds.Append(errAtBinding(srcInfo, diag.CodeUnresolvedStatePath,
				"action %q: to_state %q is not declared in the state schema", a.Id, e.ToState))
		} else if inScope && srcInfo.fieldType != meta.Type {
			ds.Append(errAtBinding(srcInfo, diag.CodeStateTypeMismatch,
				"action %q: merge binding %q has type %s but STATE field %q has type %s",
				a.Id, e.Binding, srcInfo.fieldType, e.ToState, meta.Type))
		}
	}
}

func validateNextRule(nr *turnoutpb.NextRuleModel, ctx progValidateCtx, actionScope map[string]bindingInfo, ds *diag.DiagSink) {
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
			ds.Append(diag.Errorf(diag.CodeInvalidTransitionIngress,
				"transition prepare entry for %q must have exactly one of from_action, from_state, from_literal; got %d",
				e.Binding, count))
		}
		if e.FromState != nil {
			validateStatePath(*e.FromState, ctx.schema, ds)
		}
		// 3-A: verify the from_action binding exists in the source action's compute block.
		if e.FromAction != nil {
			srcName := *e.FromAction
			if _, ok := actionScope[srcName]; !ok {
				ds.Append(errAtBinding(actionScope[srcName], diag.CodeNextPrepareFromActionUnknown,
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
			ds.Append(diag.Errorf(diag.CodeNextComputeNotBool,
				"next rule condition %q is not defined in the transition compute block", cond))
		} else if info.fieldType != ast.FieldTypeBool {
			ds.Append(errAtBinding(info, diag.CodeNextComputeNotBool,
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
			ds.Append(errAtBinding(dstInfo, diag.CodeNextPrepareFromActionTypeMismatch,
				"action %q: next prepare binding %q (type %s) does not match from_action %q (type %s)",
				ctx.actionID, e.Binding, dstInfo.fieldType, srcName, srcInfo.fieldType))
		}
	}
}
