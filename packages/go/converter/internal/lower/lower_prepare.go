// lower_prepare.go resolves sigil-input placeholder defaults via a prepareResolver interface.
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
	resolveDefault(bindingName string, ft ast.FieldType, pos ast.Pos, missingPrepareCode string, ds *diag.DiagSink) ast.Literal
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

func (r *actionPrepareResolver) resolveDefault(name string, ft ast.FieldType, pos ast.Pos, missingPrepareCode string, ds *diag.DiagSink) ast.Literal {
	src, ok := r.index[name]
	if !ok {
		ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col,
			missingPrepareCode,
			"binding %q uses placeholder _ but has no prepare entry", name))
		return zeroLiteralFor(ft)
	}
	switch s := src.(type) {
	case *ast.FromState:
		return resolveFromState(s.Path, r.schema, ft, pos, ds)
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

func (r *transitionPrepareResolver) resolveDefault(name string, ft ast.FieldType, pos ast.Pos, missingPrepareCode string, ds *diag.DiagSink) ast.Literal {
	src, ok := r.index[name]
	if !ok {
		ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col,
			missingPrepareCode,
			"binding %q uses placeholder _ but has no transition prepare entry", name))
		return zeroLiteralFor(ft)
	}
	switch s := src.(type) {
	case *ast.FromState:
		return resolveFromState(s.Path, r.schema, ft, pos, ds)
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

// resolveFromState looks up path in schema and returns its default value.
// Emits CodeUnresolvedStatePath and returns a zero literal when path is absent.
func resolveFromState(path string, schema state.Schema, ft ast.FieldType, pos ast.Pos, ds *diag.DiagSink) ast.Literal {
	meta, found := schema.Get(path)
	if !found {
		ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col,
			diag.CodeUnresolvedStatePath,
			"from_state path %q is not declared in the state schema", path))
		return zeroLiteralFor(ft)
	}
	return meta.DefaultValue
}

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
