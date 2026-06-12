// Package parser implements a recursive-descent parser for the Turn DSL.
package parser

import (
	"fmt"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lexer"
)

// ParseFile parses Turn DSL source src into a TurnFile AST.
// file is the source path used in diagnostic positions.
func ParseFile(file, src string) (*ast.TurnFile, diag.Diagnostics) {
	tokens, ld := lexer.Tokenize(file, src)
	if ld.HasErrors() {
		return nil, ld
	}
	p := &parser{tokens: tokens, file: file, requiresScenes: true}
	tf := p.parseFile()
	if p.HasErrors() {
		return nil, p.Flush()
	}
	return tf, p.Flush()
}

// ParseStateFile parses a state-only file (no scene block required).
// It returns the InlineStateBlock if present, or nil with diagnostics on error.
func ParseStateFile(file, src string) (*ast.InlineStateBlock, diag.Diagnostics) {
	tokens, ld := lexer.Tokenize(file, src)
	if ld.HasErrors() {
		return nil, ld
	}
	p := &parser{tokens: tokens, file: file, requiresScenes: false}
	tf := p.parseFile()

	if p.HasErrors() {
		return nil, p.Flush()
	}

	if tf == nil || tf.StateSource == nil {
		return nil, diag.Diagnostics{diag.Errorf("MissingStateBlock",
			"state file %q has no state block", file)}
	}
	inline, ok := tf.StateSource.(*ast.InlineStateBlock)
	if !ok {
		return nil, diag.Diagnostics{diag.Errorf("MissingStateBlock",
			"state file %q must contain a literal state block, not state_file", file)}
	}
	return inline, p.Flush()
}

// ─── parser state ────────────────────────────────────────────────────────────

type parser struct {
	tokens         []lexer.Token
	pos            int
	file           string
	requiresScenes bool
	diag.DiagSink
}

func (p *parser) peek() lexer.Token { return p.peekAt(0) }
func (p *parser) peekAt(n int) lexer.Token {
	i := p.pos + n
	if i >= len(p.tokens) {
		return lexer.Token{Kind: lexer.TokEOF}
	}
	return p.tokens[i]
}

func (p *parser) advance() lexer.Token {
	t := p.peek()
	if t.Kind != lexer.TokEOF {
		p.pos++
	}
	return t
}

// posOf converts a lexer token into an ast.Pos.
func (p *parser) posOf(t lexer.Token) ast.Pos {
	return ast.Pos{File: p.file, Line: t.Line, Col: t.Col}
}

// errorf appends a parse-syntax-error diagnostic.
func (p *parser) errorf(t lexer.Token, format string, args ...any) {
	if p.IsHalted() {
		return
	}
	if p.AtCap() {
		p.pos = len(p.tokens) - 1 // stage-specific recovery: skip to end
		p.Halt()                   // appends TooManyDiagnostics sentinel internally
		return
	}
	p.Append(diag.ErrorAt(p.file, t.Line, t.Col,
		"ParseSyntaxError", "%s", fmt.Sprintf(format, args...)))
}

// expect consumes the next token if its kind matches, otherwise records an
// error and returns the current (wrong) token without advancing.
func (p *parser) expect(kind lexer.TokenKind) (lexer.Token, bool) {
	t := p.peek()
	if t.Kind != kind {
		p.errorf(t, "expected %s, got %s %q", kindName(kind), kindName(t.Kind), t.Value)
		return t, false
	}
	return p.advance(), true
}

// expectIdent is like expect but also returns the string value.
func (p *parser) expectIdent() (lexer.Token, bool) {
	return p.expect(lexer.TokIdent)
}

// consumeNamedArgIfPresent detects a `name:` named-argument prefix at the current
// position. If found, it consumes the name and colon tokens, records a diagnostic
// (named args are unsupported; callers must use positional form), and returns true.
// Returns false without advancing when no named-arg prefix is present.
func (p *parser) consumeNamedArgIfPresent() bool {
	if p.peek().Kind != lexer.TokIdent || p.peekAt(1).Kind != lexer.TokColon {
		return false
	}
	nameTok := p.advance() // consume name
	p.advance()            // consume ':'
	p.Append(diag.ErrorAt(p.file, nameTok.Line, nameTok.Col,
		diag.CodeNamedArgNotSupported, "named argument %q is not supported; pass arguments positionally", nameTok.Value))
	return true
}

// skipTo advances past tokens until the current token is one of the given
// kinds (or EOF). Used for error recovery.
func (p *parser) skipTo(kinds ...lexer.TokenKind) {
	for p.peek().Kind != lexer.TokEOF {
		for _, k := range kinds {
			if p.peek().Kind == k {
				return
			}
		}
		p.advance()
	}
}

func (p *parser) atAny(kinds ...lexer.TokenKind) bool {
	for _, k := range kinds {
		if p.peek().Kind == k {
			return true
		}
	}
	return false
}

// syncToBlockItem advances to the next likely sibling item in the current
// block, or to the current block's closing brace. Nested blocks are skipped so
// recovery does not accidentally stop on a token inside malformed content.
func (p *parser) syncToBlockItem(starters ...lexer.TokenKind) {
	for p.peek().Kind != lexer.TokEOF && p.peek().Kind != lexer.TokRBrace {
		if p.atAny(starters...) {
			return
		}
		if p.peek().Kind == lexer.TokLBrace {
			p.skipBlock()
			continue
		}
		p.advance()
	}
}

// skipBlock skips a balanced { ... } block. Assumes the opening { has NOT yet
// been consumed.
func (p *parser) skipBlock() {
	if p.peek().Kind != lexer.TokLBrace {
		return
	}
	p.advance() // consume {
	depth := 1
	for p.peek().Kind != lexer.TokEOF && depth > 0 {
		switch p.peek().Kind {
		case lexer.TokLBrace:
			depth++
		case lexer.TokRBrace:
			depth--
		}
		p.advance()
	}
}

// ─── parseRefVal ─────────────────────────────────────────────────────────────

// parseRefVal consumes either a bare identifier or a quoted string and returns
// the string value. Both forms are reference-normalized per §2.3.
// It also accepts dotted paths (a.b.c) when they consist of bare idents.
func (p *parser) parseRefVal() string {
	t := p.peek()
	switch t.Kind {
	case lexer.TokStringLit:
		p.advance()
		return t.Value
	case lexer.TokIdent:
		// Collect dotted-path segments: ident ('.' ident)*
		p.advance()
		val := t.Value
		for p.peek().Kind == lexer.TokDot {
			p.advance() // consume '.'
			seg := p.peek()
			if seg.Kind != lexer.TokIdent {
				p.errorf(seg, "expected identifier after '.' in path, got %s", kindName(seg.Kind))
				break
			}
			p.advance()
			val += "." + seg.Value
		}
		return val
	default:
		p.errorf(t, "expected identifier or string for reference value, got %s %q", kindName(t.Kind), t.Value)
		return ""
	}
}

// isKeyword reports whether k is any keyword token kind.
// Listed explicitly so the compiler catches any new keyword not added here.
func isKeyword(k lexer.TokenKind) bool {
	switch k {
	case lexer.TokKwState, lexer.TokKwStateFile, lexer.TokKwScene, lexer.TokKwAction,
		lexer.TokKwCompute, lexer.TokKwPrepare, lexer.TokKwMerge, lexer.TokKwPublish,
		lexer.TokKwNext, lexer.TokKwProg, lexer.TokKwRoot, lexer.TokKwCondition,
		lexer.TokKwEntryActions, lexer.TokKwNextPolicy,
		lexer.TokKwFromState, lexer.TokKwFromAction, lexer.TokKwFromHook, lexer.TokKwFromLiteral,
		lexer.TokKwToState, lexer.TokKwHook, lexer.TokKwView, lexer.TokKwFlow,
		lexer.TokKwEnforce, lexer.TokKwText, lexer.TokKwRoute, lexer.TokKwMatch, lexer.TokKwEntry:
		return true
	}
	return false
}

// ─── parseFile ───────────────────────────────────────────────────────────────

func (p *parser) parseFile() *ast.TurnFile {
	tf := &ast.TurnFile{}
	hasState := false

	for p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		switch t.Kind {
		case lexer.TokKwState:
			if hasState {
				p.Append(diag.ErrorAt(p.file, t.Line, t.Col, diag.CodeConflictingStateSource,
					"Turn DSL file cannot declare both a state block and a state_file directive"))
				p.skipBlock()
				continue
			}
			hasState = true
			tf.StateSource = p.parseInlineStateBlock()

		case lexer.TokKwStateFile:
			if hasState {
				p.Append(diag.ErrorAt(p.file, t.Line, t.Col, diag.CodeConflictingStateSource,
					"Turn DSL file cannot declare both a state block and a state_file directive"))
				p.advance()
				p.expect(lexer.TokEquals)
				p.advance() // skip path
				continue
			}
			hasState = true
			p.advance() // consume state_file keyword
			p.expect(lexer.TokEquals)
			pathTok, _ := p.expect(lexer.TokStringLit)
			tf.StateSource = &ast.StateFileDirective{
				Pos:  p.posOf(t),
				Path: pathTok.Value,
			}

		case lexer.TokKwScene:
			if sb := p.parseSceneBlock(); sb != nil {
				tf.Scenes = append(tf.Scenes, sb)
			}

		case lexer.TokKwRoute:
			rb := p.parseRouteBlock()
			if rb != nil {
				tf.Routes = append(tf.Routes, rb)
			}

		case lexer.TokIdent:
			p.errorf(t, "unexpected token %s %q at file top level", kindName(t.Kind), t.Value)
			p.advance()

		default:
			p.errorf(t, "unexpected token %s %q at file top level", kindName(t.Kind), t.Value)
			p.advance()
		}
	}
	if p.IsHalted() {
		return tf
	}

	if !hasState {
		p.Append(diag.Errorf(diag.CodeMissingStateSource,
			"Turn DSL file must contain either a state block or state_file directive"))
	}
	if p.requiresScenes && len(tf.Scenes) == 0 {
		p.Append(diag.Errorf(diag.CodeMissingScene,
			"Turn DSL file must contain a scene block"))
	}
	return tf
}

// kindName returns a human-readable name for a token kind.
// Delegates to lexer.TokenName so the name table has a single source of truth.
func kindName(k lexer.TokenKind) string {
	return lexer.TokenName(k)
}
