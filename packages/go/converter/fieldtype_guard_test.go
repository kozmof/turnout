package converter_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

// The two invariants below used to be enforced by `pnpm run check:fieldtype`, a
// pair of greps in package.json. They are properties of Go source, so they are
// checked here instead: `go test ./...` runs them, the failure names a file and
// a line, and a contributor who never installs pnpm still cannot break them.
//
// Both are about ast.FieldType, which carries its canonical spelling and
// nothing else. That makes it cheap to compare and impossible to validate after
// the fact, so the two ways of producing a non-canonical one are closed off at
// the source.

// moduleFiles parses every non-vendor Go file in the module, returning the file
// set alongside the parsed files keyed by path relative to the module root.
func moduleFiles(t *testing.T) (*token.FileSet, map[string]*ast.File) {
	t.Helper()
	fset := token.NewFileSet()
	files := make(map[string]*ast.File)
	root := "."
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == "vendor" || entry.Name() == "testdata" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		parsed, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(path)] = parsed
		return nil
	})
	if err != nil {
		t.Fatalf("walking module: %v", err)
	}
	if len(files) == 0 {
		t.Fatal("no Go files found; the guard would pass vacuously")
	}
	return fset, files
}

// isFieldTypeExpr reports whether expr names ast.FieldType, written either
// qualified (outside package ast) or bare (inside it).
func isFieldTypeExpr(expr ast.Expr) bool {
	switch typed := expr.(type) {
	case *ast.Ident:
		return typed.Name == "FieldType"
	case *ast.SelectorExpr:
		pkg, ok := typed.X.(*ast.Ident)
		return ok && pkg.Name == "ast" && typed.Sel.Name == "FieldType"
	}
	return false
}

// TestNoBareFieldTypeDeclaration rejects `var ft ast.FieldType` with no
// initialiser. The zero value of a FieldType is FieldTypeInvalid, which names
// no type, so a bare declaration is a value that will compare unequal to every
// real type until something assigns to it — and the compiler cannot tell
// whether something did.
func TestNoBareFieldTypeDeclaration(t *testing.T) {
	fset, files := moduleFiles(t)
	for _, file := range files {
		ast.Inspect(file, func(node ast.Node) bool {
			decl, ok := node.(*ast.GenDecl)
			if !ok || decl.Tok != token.VAR {
				return true
			}
			for _, spec := range decl.Specs {
				value, ok := spec.(*ast.ValueSpec)
				if !ok || len(value.Values) > 0 || value.Type == nil {
					continue
				}
				if !isFieldTypeExpr(value.Type) {
					continue
				}
				names := make([]string, 0, len(value.Names))
				for _, name := range value.Names {
					names = append(names, name.Name)
				}
				t.Errorf(
					"%s: bare FieldType declaration %q — the zero value names no type; "+
						"initialise it to ast.FieldTypeInvalid to say so explicitly",
					fset.Position(value.Pos()), strings.Join(names, ", "),
				)
			}
			return true
		})
	}
}

// TestNoFieldTypeConversionOutsideASTPackage rejects `ast.FieldType(s)` outside
// internal/ast. The conversion produces a FieldType from an arbitrary string
// without canonicalising its spelling, and a FieldType *is* its spelling: one
// built that way may not compare equal to the same type written properly.
// ast.FieldTypeFromString is the constructor that canonicalises.
func TestNoFieldTypeConversionOutsideASTPackage(t *testing.T) {
	fset, files := moduleFiles(t)
	for path, file := range files {
		if strings.HasPrefix(path, "internal/ast/") {
			continue
		}
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			// Only the qualified spelling can appear here: a bare `FieldType(x)`
			// outside package ast would not compile.
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || !isFieldTypeExpr(selector) {
				return true
			}
			t.Errorf(
				"%s: ast.FieldType(...) conversion outside internal/ast — it bypasses "+
					"canonicalisation; build types with ast.FieldTypeFromString",
				fset.Position(call.Pos()),
			)
			return true
		})
	}
}
