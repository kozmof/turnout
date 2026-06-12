// lower_prepare.go resolves sigil-input placeholder defaults via a prepareResolver interface.
package lower

import (
	"fmt"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// prepareResolver — abstracts placeholder default resolution
// ─────────────────────────────────────────────────────────────────────────────

type prepareResolver interface {
	resolveDefault(bindingName string, ft ast.FieldType, pos ast.Pos, missingPrepareCode string, ds *diag.DiagSink) *structpb.Value
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

func (r *actionPrepareResolver) resolveDefault(name string, ft ast.FieldType, pos ast.Pos, missingPrepareCode string, ds *diag.DiagSink) *structpb.Value {
	src, ok := r.index[name]
	if !ok {
		return emitMissingPrepare(name, ft, pos, missingPrepareCode, "has no prepare entry", ds)
	}
	switch s := src.(type) {
	case *ast.FromState:
		return resolveFromState(s.Path, r.schema, ft, pos, ds)
	case *ast.FromHook:
		return zeroStructpbFor(ft)
	default:
		panic(fmt.Sprintf(
			"actionPrepareResolver.resolveDefault: unhandled ActionPrepareSource type %T for binding %q — compiler bug", s, name))
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

func (r *transitionPrepareResolver) resolveDefault(name string, ft ast.FieldType, pos ast.Pos, missingPrepareCode string, ds *diag.DiagSink) *structpb.Value {
	src, ok := r.index[name]
	if !ok {
		return emitMissingPrepare(name, ft, pos, missingPrepareCode, "has no transition prepare entry", ds)
	}
	switch s := src.(type) {
	case *ast.FromState:
		return resolveFromState(s.Path, r.schema, ft, pos, ds)
	case *ast.FromAction:
		return zeroStructpbFor(ft)
	case *ast.FromLiteral:
		return ast.LiteralToStructpb(s.Value)
	default:
		panic(fmt.Sprintf(
			"transitionPrepareResolver.resolveDefault: unhandled NextPrepareSource type %T for binding %q — compiler bug", s, name))
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// emitMissingPrepare records a diagnostic for a sigil binding with no prepare
// entry and returns a zero value. The detail string distinguishes action-level
// from transition-level prepare blocks in the error message.
func emitMissingPrepare(name string, ft ast.FieldType, pos ast.Pos, code, detail string, ds *diag.DiagSink) *structpb.Value {
	ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col,
		code,
		"binding %q uses an ingress sigil (~> or <~>) but %s", name, detail))
	return zeroStructpbFor(ft)
}

// resolveFromState looks up path in schema and returns its default value.
// Emits CodeUnresolvedStatePath and returns a zero value when path is absent.
func resolveFromState(path string, schema state.Schema, ft ast.FieldType, pos ast.Pos, ds *diag.DiagSink) *structpb.Value {
	meta, found := schema.Get(path)
	if !found {
		ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col,
			diag.CodeUnresolvedStatePath,
			"from_state path %q is not declared in the state schema", path))
		return zeroStructpbFor(ft)
	}
	return meta.DefaultValue
}

func zeroStructpbFor(ft ast.FieldType) *structpb.Value {
	switch ft {
	case ast.FieldTypeNumber:
		return structpb.NewNumberValue(0)
	case ast.FieldTypeStr:
		return structpb.NewStringValue("")
	case ast.FieldTypeBool:
		return structpb.NewBoolValue(false)
	case ast.FieldTypeArrNumber, ast.FieldTypeArrStr, ast.FieldTypeArrBool:
		return structpb.NewListValue(&structpb.ListValue{})
	default:
		panic(fmt.Sprintf("zeroStructpbFor: unhandled FieldType %v — add a case when adding new FieldType constants", ft))
	}
}

func zeroLiteralFor(ft ast.FieldType) ast.Literal {
	switch ft {
	case ast.FieldTypeNumber:
		return &ast.NumberLiteral{Value: 0}
	case ast.FieldTypeStr:
		return &ast.StringLiteral{Value: ""}
	case ast.FieldTypeBool:
		return &ast.BoolLiteral{Value: false}
	case ast.FieldTypeArrNumber, ast.FieldTypeArrStr, ast.FieldTypeArrBool:
		return &ast.ArrayLiteral{}
	default:
		panic(fmt.Sprintf("zeroLiteralFor: unhandled FieldType %v — add a case when adding new FieldType constants", ft))
	}
}
