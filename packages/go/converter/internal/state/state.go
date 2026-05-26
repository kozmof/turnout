package state

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
)

// FieldMeta holds the resolved type and default value for a single STATE field.
type FieldMeta struct {
	Type         ast.FieldType
	DefaultValue ast.Literal
}

// Schema is the resolved STATE schema: a nested map from namespace → field → FieldMeta.
// Use Get("ns.field") for point lookups and Flat() when a dotted-path map is needed.
type Schema map[string]map[string]FieldMeta

// Get looks up a dotted path "ns.field" in the nested schema.
func (s Schema) Get(path string) (FieldMeta, bool) {
	dot := strings.IndexByte(path, '.')
	if dot < 0 {
		return FieldMeta{}, false
	}
	ns, field := path[:dot], path[dot+1:]
	fields, ok := s[ns]
	if !ok {
		return FieldMeta{}, false
	}
	meta, ok := fields[field]
	return meta, ok
}

// Flat returns a flat map[string]FieldMeta keyed by "ns.field" dotted paths.
// Use sparingly — it allocates a new map each call.
func (s Schema) Flat() map[string]FieldMeta {
	out := make(map[string]FieldMeta)
	for ns, fields := range s {
		for field, meta := range fields {
			out[ns+"."+field] = meta
		}
	}
	return out
}

// Resolve builds a Schema from a StateSource.
// basePath is the directory of the input .turn file, used to resolve relative state_file paths.
func Resolve(source ast.StateSource, basePath string) (Schema, diag.Diagnostics) {
	schema, _, ds := ResolveWithOrder(source, basePath)
	return schema, ds
}

// ResolveWithOrder is like Resolve but also returns the dotted field keys in
// declaration order (namespace order, then field order within each namespace).
// The lower package uses the order to preserve field sequence in emitted HCL
// when the source uses state_file. Callers that do not need ordering can
// ignore the second return value.
func ResolveWithOrder(source ast.StateSource, basePath string) (Schema, []string, diag.Diagnostics) {
	switch s := source.(type) {
	case *ast.InlineStateBlock:
		schema, ds := resolveInline(s)
		return schema, inlineOrder(s), ds
	case *ast.StateFileDirective:
		schema, order, ds := resolveStateFileWithOrder(s, basePath)
		return schema, order, ds
	default:
		return nil, nil, diag.Diagnostics{diag.Errorf(diag.CodeMissingStateSource, "no state source")}
	}
}

// inlineOrder returns the dotted keys for block in declaration order.
func inlineOrder(block *ast.InlineStateBlock) []string {
	var keys []string
	for _, ns := range block.Namespaces {
		for _, f := range ns.Fields {
			keys = append(keys, ns.Name+"."+f.Name)
		}
	}
	return keys
}

// resolveStateFile loads and parses an external state file, then resolves it.
func resolveStateFile(d *ast.StateFileDirective, basePath string) (Schema, diag.Diagnostics) {
	schema, _, ds := resolveStateFileWithOrder(d, basePath)
	return schema, ds
}

// resolveStateFileWithOrder is like resolveStateFile but also returns ordered keys.
func resolveStateFileWithOrder(d *ast.StateFileDirective, basePath string) (Schema, []string, diag.Diagnostics) {
	path := d.Path
	if !filepath.IsAbs(path) {
		path = filepath.Join(basePath, path)
	}

	src, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, diag.Diagnostics{diag.Errorf(diag.CodeStateFileMissing, "cannot read state file %q: %v", path, err)}
	}

	inline, parseDiags := parser.ParseStateFile(path, string(src))
	if parseDiags.HasErrors() {
		var ds diag.Diagnostics
		for _, pd := range parseDiags {
			code := diag.CodeStateFileParseError
			if pd.Code == "MissingStateBlock" {
				code = diag.CodeMissingStateBlock
			}
			ds = append(ds, diag.Errorf(code, "%s", pd.Message))
		}
		return nil, nil, ds
	}

	schema, ds := resolveInline(inline)
	return schema, inlineOrder(inline), ds
}

// resolveInline builds a Schema from an InlineStateBlock.
func resolveInline(block *ast.InlineStateBlock) (Schema, diag.Diagnostics) {
	schema := make(Schema)
	var ds diag.Diagnostics

	seenNS := make(map[string]bool)
	for _, ns := range block.Namespaces {
		if seenNS[ns.Name] {
			ds = append(ds, diag.ErrorAt(ns.Pos.File, ns.Pos.Line, ns.Pos.Col,
				diag.CodeDuplicateStateNamespace,
				"duplicate namespace %q", ns.Name))
			continue
		}
		seenNS[ns.Name] = true
		schema[ns.Name] = make(map[string]FieldMeta)

		seenField := make(map[string]bool)
		for _, f := range ns.Fields {
			if seenField[f.Name] {
				ds = append(ds, diag.ErrorAt(f.Pos.File, f.Pos.Line, f.Pos.Col,
					diag.CodeDuplicateStateField,
					"duplicate field %q in namespace %q", f.Name, ns.Name))
				continue
			}
			seenField[f.Name] = true

			if f.Default == nil {
				ds = append(ds, diag.ErrorAt(f.Pos.File, f.Pos.Line, f.Pos.Col,
					diag.CodeMissingStateFieldAttr,
					"field %q.%q has no default value", ns.Name, f.Name))
				continue
			}

			if !literalMatchesType(f.Default, f.Type) {
				ds = append(ds, diag.ErrorAt(f.Pos.File, f.Pos.Line, f.Pos.Col,
					diag.CodeStateFieldDefaultTypeMismatch,
					"field %q.%q: default value does not match declared type %s", ns.Name, f.Name, f.Type))
				continue
			}

			schema[ns.Name][f.Name] = FieldMeta{Type: f.Type, DefaultValue: f.Default}
		}
	}

	return schema, ds
}

// literalMatchesType reports whether lit is compatible with the declared FieldType.
func literalMatchesType(lit ast.Literal, ft ast.FieldType) bool {
	switch ft {
	case ast.FieldTypeNumber:
		_, ok := lit.(*ast.NumberLiteral)
		return ok
	case ast.FieldTypeStr:
		_, ok := lit.(*ast.StringLiteral)
		return ok
	case ast.FieldTypeBool:
		_, ok := lit.(*ast.BoolLiteral)
		return ok
	case ast.FieldTypeArrNumber, ast.FieldTypeArrStr, ast.FieldTypeArrBool:
		arr, ok := lit.(*ast.ArrayLiteral)
		if !ok {
			return false
		}
		elemFT := ft.ElemType()
		for _, e := range arr.Elements {
			if !literalMatchesType(e, elemFT) {
				return false
			}
		}
		return true
	}
	return false
}
