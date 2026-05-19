package lower

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

// ─────────────────────────────────────────────────────────────────────────────
// prepareResolver — abstracts placeholder default resolution
// ─────────────────────────────────────────────────────────────────────────────

type prepareResolver interface {
	resolveDefault(bindingName string, ft ast.FieldType, pos ast.Pos, missingPrepareCode string, ds *diag.Diagnostics) ast.Literal
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

func (r *actionPrepareResolver) resolveDefault(name string, ft ast.FieldType, pos ast.Pos, missingPrepareCode string, ds *diag.Diagnostics) ast.Literal {
	src, ok := r.index[name]
	if !ok {
		*ds = append(*ds, diag.ErrorAt(pos.File, pos.Line, pos.Col,
			missingPrepareCode,
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

func (r *transitionPrepareResolver) resolveDefault(name string, ft ast.FieldType, pos ast.Pos, missingPrepareCode string, ds *diag.Diagnostics) ast.Literal {
	src, ok := r.index[name]
	if !ok {
		*ds = append(*ds, diag.ErrorAt(pos.File, pos.Line, pos.Col,
			missingPrepareCode,
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
