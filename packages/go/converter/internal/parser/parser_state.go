package parser

import (
	"strconv"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lexer"
)

// ─── parseFieldType ──────────────────────────────────────────────────────────

// parseFieldType consumes a type token (TokIdent for scalar types, TokType for
// arr<T>) and returns the corresponding FieldType. typeErrCode is used when the
// token is syntactically a type position but the value is not a recognised type
// string — pass CodeInvalidStateFieldType for state field declarations and
// CodeParseSyntaxError for binding declarations.
func (p *parser) parseFieldType(typeErrCode diag.ErrorCode) (ast.FieldType, bool) {
	t := p.peek()
	switch t.Kind {
	case lexer.TokType:
		p.advance()
		ft, ok := ast.FieldTypeFromString(t.Value)
		if !ok {
			p.errorWithCode(t, typeErrCode, "unknown array type %q", t.Value)
			return 0, false
		}
		return ft, true
	case lexer.TokIdent:
		ft, ok := ast.FieldTypeFromString(t.Value)
		if !ok {
			p.errorWithCode(t, typeErrCode, "unknown type %q; expected number, str, bool, or arr<T>", t.Value)
			return 0, false
		}
		p.advance()
		return ft, true
	default:
		p.errorf(t, "expected type, got %s %q", kindName(t.Kind), t.Value)
		return 0, false
	}
}

// ─── parseLiteral ─────────────────────────────────────────────────────────────

func (p *parser) parseLiteral() ast.Literal {
	t := p.peek()
	switch t.Kind {
	case lexer.TokBoolLit:
		p.advance()
		return ast.NewBoolLiteral(p.posOf(t), t.Value == "true")

	case lexer.TokNumberLit:
		p.advance()
		v, err := strconv.ParseFloat(t.Value, 64)
		if err != nil {
			p.errorf(t, "invalid number literal %q: %v", t.Value, err)
			return ast.NewNumberLiteral(p.posOf(t), 0)
		}
		return ast.NewNumberLiteral(p.posOf(t), v)

	case lexer.TokStringLit:
		p.advance()
		return ast.NewStringLiteral(p.posOf(t), t.Value)

	case lexer.TokHeredoc, lexer.TokTripleQuote:
		p.advance()
		return ast.NewStringLiteral(p.posOf(t), t.Value)

	case lexer.TokMinus:
		p.advance() // consume '-'
		numTok := p.peek()
		if numTok.Kind != lexer.TokNumberLit {
			p.errorf(numTok, "expected number after '-', got %s", kindName(numTok.Kind))
			return ast.NewNumberLiteral(p.posOf(t), 0)
		}
		p.advance()
		v, err := strconv.ParseFloat(numTok.Value, 64)
		if err != nil {
			p.errorf(numTok, "invalid number literal %q: %v", numTok.Value, err)
			return ast.NewNumberLiteral(p.posOf(t), 0)
		}
		return ast.NewNumberLiteral(p.posOf(t), -v)

	case lexer.TokLBracket:
		return p.parseArrayLiteral()

	default:
		p.errorf(t, "expected literal value, got %s %q", kindName(t.Kind), t.Value)
		return ast.NewBoolLiteral(p.posOf(t), false)
	}
}

func (p *parser) parseArrayLiteral() *ast.ArrayLiteral {
	open := p.peek()
	p.advance() // consume [
	pos := p.posOf(open)

	var elems []ast.Literal
	for p.peek().Kind != lexer.TokRBracket && p.peek().Kind != lexer.TokEOF {
		elems = append(elems, p.parseLiteral())
		if p.peek().Kind == lexer.TokComma {
			p.advance()
		} else {
			break
		}
	}
	p.expect(lexer.TokRBracket)
	return ast.NewArrayLiteral(pos, elems)
}

// ─── parseStateBlock / parseNamespace / parseField ──────────────────────────

func (p *parser) parseInlineStateBlock() *ast.InlineStateBlock {
	kwTok, _ := p.expect(lexer.TokKwState)
	pos := p.posOf(kwTok)
	p.expect(lexer.TokLBrace)

	var ns []*ast.NamespaceDecl
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		if t.Kind != lexer.TokIdent {
			p.errorf(t, "expected namespace identifier in state block, got %s", kindName(t.Kind))
			p.advance()
			continue
		}
		ns = append(ns, p.parseNamespaceDecl())
	}
	p.expect(lexer.TokRBrace)
	return &ast.InlineStateBlock{Pos: pos, Namespaces: ns}
}

func (p *parser) parseNamespaceDecl() *ast.NamespaceDecl {
	nameTok := p.advance() // ident
	pos := p.posOf(nameTok)
	p.expect(lexer.TokLBrace)

	var fields []*ast.FieldDecl
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		if t.Kind != lexer.TokIdent {
			p.errorf(t, "expected field name in namespace, got %s", kindName(t.Kind))
			p.advance()
			continue
		}
		fields = append(fields, p.parseFieldDecl())
	}
	p.expect(lexer.TokRBrace)
	return &ast.NamespaceDecl{Pos: pos, Name: nameTok.Value, Fields: fields}
}

func (p *parser) parseFieldDecl() *ast.FieldDecl {
	nameTok := p.advance() // ident
	pos := p.posOf(nameTok)
	p.expect(lexer.TokColon)
	ft, _ := p.parseFieldType(diag.CodeInvalidStateFieldType)
	p.expect(lexer.TokEquals)
	lit := p.parseLiteral()
	return &ast.FieldDecl{Pos: pos, Name: nameTok.Value, Type: ft, Default: lit}
}
