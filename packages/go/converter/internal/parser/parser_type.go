package parser

import (
	"strconv"
	"strings"
	"unicode"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lexer"
)

// ─── Top-level type declarations ────────────────────────────────────────────
//
// TypeDecl      = 'type' Ident '=' TypeExpr
// TypeExpr      = TypeAtom { '|' TypeAtom }          (union when >1 member)
// TypeAtom      = StringLit | NumberLit | '-' NumberLit | BoolLit
//               | Ident                               (primitive or named ref)
//
// A string-literal atom that contains a '{' is a template literal type; its
// contents are parsed into text/capture segments by parseTemplateString.

// parseTypeDecl parses a `type Name = TypeExpr` declaration.
func (p *parser) parseTypeDecl() *ast.TypeDecl {
	kwTok, _ := p.expect(lexer.TokKwType)
	pos := p.posOf(kwTok)

	nameTok := p.peek()
	if nameTok.Kind != lexer.TokIdent {
		p.errorf(nameTok, "expected type name after 'type', got %s %q", kindName(nameTok.Kind), nameTok.Value)
		return nil
	}
	p.advance()

	if _, ok := p.expect(lexer.TokEquals); !ok {
		return nil
	}

	typ := p.parseTypeExpr()
	if typ == nil {
		return nil
	}
	return &ast.TypeDecl{Pos: pos, Name: nameTok.Value, Type: typ}
}

// parseTemplateConstruction parses `TypeName { field = value ... }`. The type
// name identifier has already been consumed. Fields may be separated by
// newlines or commas.
func (p *parser) parseTemplateConstruction(nameTok lexer.Token) ast.BindingRHS {
	p.expect(lexer.TokLBrace)
	var fields []ast.ConstructionField
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		fieldTok := p.peek()
		if fieldTok.Kind != lexer.TokIdent {
			p.errorf(fieldTok, "expected capture name in construction of %q, got %s",
				nameTok.Value, kindName(fieldTok.Kind))
			p.syncToBlockItem(lexer.TokIdent, lexer.TokRBrace)
			continue
		}
		p.advance() // consume field name
		p.expect(lexer.TokEquals)
		value := p.parseArg()
		fields = append(fields, ast.ConstructionField{
			Pos:   p.posOf(fieldTok),
			Name:  fieldTok.Value,
			Value: value,
		})
		if p.peek().Kind == lexer.TokComma {
			p.advance()
		}
	}
	p.expect(lexer.TokRBrace)
	return &ast.TemplateConstructionRHS{
		Pos:      p.posOf(nameTok),
		TypeName: nameTok.Value,
		Fields:   fields,
	}
}

// parseTypeExpr parses a type expression, folding a '|'-separated sequence into
// a UnionType. A single atom is returned directly.
func (p *parser) parseTypeExpr() ast.Type {
	first := p.parseTypeAtom()
	if first == nil {
		return nil
	}
	if p.peek().Kind != lexer.TokPipe {
		return first
	}
	members := []ast.Type{first}
	unionPos := first.Pos()
	for p.peek().Kind == lexer.TokPipe {
		p.advance() // consume '|'
		atom := p.parseTypeAtom()
		if atom == nil {
			return nil
		}
		members = append(members, atom)
	}
	return ast.NewUnionType(unionPos, members)
}

// parseTypeAtom parses a single type atom.
func (p *parser) parseTypeAtom() ast.Type {
	t := p.peek()
	switch t.Kind {
	case lexer.TokStringLit:
		p.advance()
		return p.stringTypeAtom(t.Value, p.posOf(t))
	case lexer.TokNumberLit, lexer.TokMinus, lexer.TokBoolLit:
		lit := p.parseLiteral()
		return ast.NewLiteralType(lit.Pos(), lit)
	case lexer.TokIdent:
		p.advance()
		if kind, ok := ast.PrimitiveKindFromString(t.Value); ok {
			return ast.NewPrimitiveType(p.posOf(t), kind)
		}
		return ast.NewNamedType(p.posOf(t), t.Value)
	default:
		p.errorf(t, "expected a type, got %s %q", kindName(t.Kind), t.Value)
		return nil
	}
}

// stringTypeAtom builds either a plain string LiteralType or, when the value
// contains a capture region, a TemplateType.
func (p *parser) stringTypeAtom(raw string, pos ast.Pos) ast.Type {
	if !strings.ContainsRune(raw, '{') {
		return ast.NewLiteralType(pos, ast.NewStringLiteral(pos, raw))
	}
	return p.parseTemplateString(raw, pos)
}

// parseTemplateString parses the raw content of a template literal type into
// ordered text and capture segments. Empty text segments are dropped (§6.5).
func (p *parser) parseTemplateString(raw string, pos ast.Pos) ast.Type {
	runes := []rune(raw)
	var segs []ast.TemplateSegment
	var text strings.Builder
	flush := func() {
		if text.Len() > 0 {
			segs = append(segs, &ast.TextSegment{Value: text.String()})
			text.Reset()
		}
	}
	i := 0
	for i < len(runes) {
		c := runes[i]
		switch c {
		case '{':
			flush()
			cap, next, ok := p.parseTemplateCapture(runes, i+1, pos)
			if !ok {
				return nil
			}
			segs = append(segs, cap)
			i = next
		case '}':
			p.errorWithCode(tokAt(pos), diag.CodeParseSyntaxError,
				"unexpected '}' in template literal type %q", raw)
			return nil
		default:
			text.WriteRune(c)
			i++
		}
	}
	flush()
	return ast.NewTemplateType(pos, segs)
}

// parseTemplateCapture parses `name : TypeExpr }` starting at start (just past
// the opening '{'). Returns the capture segment and the index just past '}'.
func (p *parser) parseTemplateCapture(runes []rune, start int, pos ast.Pos) (*ast.CaptureSegment, int, bool) {
	i := skipSpaces(runes, start)
	name, i, ok := scanIdentRunes(runes, i)
	if !ok || name == "" {
		p.errorWithCode(tokAt(pos), diag.CodeParseSyntaxError,
			"expected capture name in template literal type")
		return nil, 0, false
	}
	i = skipSpaces(runes, i)
	if i >= len(runes) || runes[i] != ':' {
		p.errorWithCode(tokAt(pos), diag.CodeParseSyntaxError,
			"expected ':' after capture name %q in template literal type", name)
		return nil, 0, false
	}
	i++ // consume ':'
	// Collect the raw type text up to the matching '}'.
	depth := 1
	typeStart := i
	for i < len(runes) && depth > 0 {
		switch runes[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				break
			}
		}
		if depth == 0 {
			break
		}
		i++
	}
	if i >= len(runes) || runes[i] != '}' {
		p.errorWithCode(tokAt(pos), diag.CodeParseSyntaxError,
			"unterminated capture %q in template literal type", name)
		return nil, 0, false
	}
	typeText := strings.TrimSpace(string(runes[typeStart:i]))
	capType := p.parseCaptureType(typeText, pos)
	if capType == nil {
		return nil, 0, false
	}
	return &ast.CaptureSegment{Pos: pos, Name: name, CaptureType: capType}, i + 1, true
}

// parseCaptureType parses the inner type expression of a capture. It supports
// primitives, named references, and unquoted-identifier unions (§6.2). Quoted
// inline unions are handled by the Phase 2 template lexer.
func (p *parser) parseCaptureType(text string, pos ast.Pos) ast.Type {
	parts := strings.Split(text, "|")
	if len(parts) == 1 {
		return p.captureAtom(strings.TrimSpace(parts[0]), pos, false)
	}
	members := make([]ast.Type, 0, len(parts))
	for _, part := range parts {
		// Inside a union, bare identifiers normalize to string literals (§6.2).
		m := p.captureAtom(strings.TrimSpace(part), pos, true)
		if m == nil {
			return nil
		}
		members = append(members, m)
	}
	return ast.NewUnionType(pos, members)
}

// captureAtom parses a single capture-type atom. When inUnion is true, a bare
// identifier is treated as a string literal (§6.2); otherwise it is a primitive
// or named type reference.
func (p *parser) captureAtom(text string, pos ast.Pos, inUnion bool) ast.Type {
	if text == "" {
		p.errorWithCode(tokAt(pos), diag.CodeParseSyntaxError, "empty capture type")
		return nil
	}
	// Numeric literal atom.
	if v, err := strconv.ParseFloat(text, 64); err == nil {
		return ast.NewLiteralType(pos, ast.NewNumberLiteral(pos, v))
	}
	if inUnion {
		return ast.NewLiteralType(pos, ast.NewStringLiteral(pos, text))
	}
	if kind, ok := ast.PrimitiveKindFromString(text); ok {
		return ast.NewPrimitiveType(pos, kind)
	}
	if isIdentifier(text) {
		return ast.NewNamedType(pos, text)
	}
	p.errorWithCode(tokAt(pos), diag.CodeParseSyntaxError, "invalid capture type %q", text)
	return nil
}

// ─── rune-scanning helpers for template content ─────────────────────────────

func skipSpaces(runes []rune, i int) int {
	for i < len(runes) && (runes[i] == ' ' || runes[i] == '\t') {
		i++
	}
	return i
}

func scanIdentRunes(runes []rune, i int) (string, int, bool) {
	start := i
	if i < len(runes) && (unicode.IsLetter(runes[i]) || runes[i] == '_') {
		i++
		for i < len(runes) && (unicode.IsLetter(runes[i]) || unicode.IsDigit(runes[i]) || runes[i] == '_') {
			i++
		}
		return string(runes[start:i]), i, true
	}
	return "", i, false
}

func isIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for idx, r := range s {
		if idx == 0 && !(unicode.IsLetter(r) || r == '_') {
			return false
		}
		if idx > 0 && !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_') {
			return false
		}
	}
	return true
}

// tokAt builds a lexer.Token carrying an ast.Pos, so template-content
// diagnostics report the template's source position.
func tokAt(pos ast.Pos) lexer.Token {
	return lexer.Token{Line: pos.Line, Col: pos.Col}
}
