package parser

import (
	"github.com/turnout/converter/internal/ast"
	"github.com/turnout/converter/internal/diag"
	"github.com/turnout/converter/internal/lexer"
)

// ParseFile parses Turn DSL source src into a TurnFile AST.
// file is the source path used in diagnostic positions.
func ParseFile(file, src string) (*ast.TurnFile, diag.Diagnostics) {
	tokens, ld := lexer.Tokenize(file, src)
	if ld.HasErrors() {
		return nil, ld
	}
	_ = tokens
	// TODO: implement recursive descent parser in Phase 4
	panic("parser.ParseFile: not implemented")
}
