package state

import (
	"os"
	"path/filepath"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
)

// FieldMeta holds the resolved type and default value for a single STATE field.
type FieldMeta struct {
	Type         ast.FieldType
	DefaultValue ast.Literal
}

// Schema is the resolved STATE schema: a flat map from dotted path to FieldMeta.
// Example key: "applicant.income"
type Schema map[string]FieldMeta

// Resolve builds a Schema from a StateSource.
// basePath is the directory of the input .turn file, used to resolve relative state_file paths.
func Resolve(source ast.StateSource, basePath string) (Schema, diag.Diagnostics) {
	switch s := source.(type) {
	case *ast.InlineStateBlock:
		return resolveInline(s)
	case *ast.StateFileDirective:
		return resolveStateFile(s, basePath)
	default:
		return nil, diag.Diagnostics{diag.Errorf(diag.CodeMissingStateSource, "no state source")}
	}
}

// resolveStateFile loads and parses an external state file, then resolves it.
func resolveStateFile(d *ast.StateFileDirective, basePath string) (Schema, diag.Diagnostics) {
	path := d.Path
	if !filepath.IsAbs(path) {
		path = filepath.Join(basePath, path)
	}

	src, err := os.ReadFile(path)
	if err != nil {
		return nil, diag.Diagnostics{diag.Errorf(diag.CodeStateFileMissing, "cannot read state file %q: %v", path, err)}
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
		return nil, ds
	}

	return resolveInline(inline)
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

			key := ns.Name + "." + f.Name
			schema[key] = FieldMeta{Type: f.Type, DefaultValue: f.Default}
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
