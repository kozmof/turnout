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
		return nil, diag.Diagnostics{diag.Errorf(diag.CodeMissingStateBlock,
			"state file %q has no state block", file)}
	}
	inline, ok := tf.StateSource.(*ast.InlineStateBlock)
	if !ok {
		return nil, diag.Diagnostics{diag.Errorf(diag.CodeMissingStateBlock,
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
	// inNextCompute is true while parsing a compute block inside a next rule. Inline IO
	// sources differ by context (NEW_SYNTAX.md 3), and the two contexts are
	// distinct parse paths, so tracking it here keeps the check at the token.
	inNextCompute bool
	// exprDepth is how many expression frames are currently open, and
	// exprTooDeep records that the cap has already been reported. See
	// enterExpression.
	exprDepth   int
	exprTooDeep bool
	diag.DiagSink
}

// maxExpressionDepth bounds how deep the expression grammar may nest. It is
// pinned through spec/limits.json alongside the engine's own nesting caps.
//
// Every other limit in this package is a courtesy — a cap on diagnostics, a cap
// on input size — and exceeding one produces a diagnostic. This one is not.
// Expression parsing is mutually recursive (parseLocalTupleExpr →
// parseLocalExpr → parseLocalPrec → parseLocalPrimary → parseLocalTupleExpr),
// so `(((…` descends one frame per character, and past roughly a million frames
// the goroutine stack is exhausted. A Go stack overflow is a fatal runtime
// error, not a panic: neither recoverInternalPanic in the converter package nor
// safeRun in cmd/turnout can turn it into a diagnostic, because recover() never
// runs. The process dies.
//
// So the bound has to be here, ahead of the recursion, and it has to be low
// enough that the frames below it cannot add up to a stack. 256 is the same
// number the engine uses for its own graph and inference depths, and is far
// past any expression anyone writes.
const maxExpressionDepth = 256

// enterExpression opens one expression frame, and returns whether there was
// room for it along with the function that closes it. A caller that is refused
// must return a placeholder node without recursing.
//
// The diagnostic is recorded once per source. A refusal happens at every level
// of an over-deep expression, and again for each sibling the parser reaches
// afterwards; reporting each one would bury the file's real errors under a
// hundred copies of this one.
func (p *parser) enterExpression(t lexer.Token) (func(), bool) {
	if p.exprDepth >= maxExpressionDepth {
		if !p.exprTooDeep {
			p.exprTooDeep = true
			p.errorWithCode(t, diag.CodeExpressionTooDeep,
				"expression nests deeper than %d levels", maxExpressionDepth)
		}
		return func() {}, false
	}
	p.exprDepth++
	return func() { p.exprDepth-- }, true
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

// continuesLine reports whether t sits on the same source line as the token
// before the cursor. The grammar is otherwise newline-insensitive; this is for
// the few clauses that must stay attached to what precedes them.
func (p *parser) continuesLine(t lexer.Token) bool {
	if p.pos == 0 {
		return false
	}
	return p.tokens[p.pos-1].Line == t.Line
}

// errorf appends a parse-syntax-error diagnostic.
func (p *parser) errorf(t lexer.Token, format string, args ...any) {
	p.errorWithCode(t, diag.CodeParseSyntaxError, format, args...)
}

// errorWithCode appends a diagnostic with a caller-supplied error code.
// Shares the same halt/cap logic as errorf.
func (p *parser) errorWithCode(t lexer.Token, code diag.ErrorCode, format string, args ...any) {
	if p.IsHalted() {
		return
	}
	if p.AtCap() {
		p.pos = len(p.tokens) - 1 // stage-specific recovery: skip to end
		p.Halt()                  // appends TooManyDiagnostics sentinel internally
		return
	}
	p.Append(diag.ErrorAt(p.file, t.Line, t.Col,
		code, "%s", fmt.Sprintf(format, args...)))
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
// been consumed. Safe because the lexer emits TokLBrace / TokRBrace only for
// structural braces; brace characters inside string literals are consumed by
// the lexer as a single TokStringLit token and never reach the parser as brace tokens.
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

// skipNestedExpression consumes the whole operand the cursor is sitting on:
// a balanced group, a call's name together with its argument list, or one
// token when it is neither. It is the recovery for an expression refused by
// enterExpression — the frames below the cap unwind without parsing anything,
// so something has to consume what they would have, or the tokens come back as
// a hundred cascading syntax errors and the one that matters scrolls away.
//
// The call case is not an extra: `add(add(…))` and `if(true, 1, if(…))` nest
// through a name rather than through a bracket, so a cursor on the name that
// consumed only the name would leave the argument list behind — which is
// exactly the cascade this exists to stop.
//
// Consuming a token even in the last case is what guarantees the caller makes
// progress.
func (p *parser) skipNestedExpression() {
	openers := map[lexer.TokenKind]lexer.TokenKind{
		lexer.TokLParen:   lexer.TokRParen,
		lexer.TokLBracket: lexer.TokRBracket,
		lexer.TokLBrace:   lexer.TokRBrace,
	}
	// A call: consume the callee, then fall through to its argument list.
	if p.peek().Kind == lexer.TokIdent {
		if _, opensArgs := openers[p.peekAt(1).Kind]; !opensArgs {
			p.advance()
			return
		}
		p.advance()
	}
	closer, isOpener := openers[p.peek().Kind]
	if !isOpener {
		p.advance()
		return
	}
	opener := p.peek().Kind
	depth := 0
	for p.peek().Kind != lexer.TokEOF {
		switch p.peek().Kind {
		case opener:
			depth++
		case closer:
			depth--
		}
		p.advance()
		if depth == 0 {
			return
		}
	}
}

// skipUnexpectedItem advances past one unexpected token (and its following
// block, if any). Used by block parsers that want per-item error recovery:
// each bad sibling gets its own diagnostic, and the outer loop retries.
func (p *parser) skipUnexpectedItem() {
	p.advance()
	if p.peek().Kind == lexer.TokLBrace {
		p.skipBlock()
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
		lexer.TokKwExtend,
		lexer.TokKwNext, lexer.TokKwProg,
		lexer.TokKwEntryAction,
		lexer.TokKwHook, lexer.TokKwOverview, lexer.TokKwText, lexer.TokKwRoute, lexer.TokKwEntry:
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
					"Turn DSL file declares STATE more than once; remove the duplicate state block or state_file directive"))
				// The `state` keyword must be consumed before skipping the block:
				// skipBlock expects to be sitting on the opening brace and returns
				// without advancing otherwise, which spun this loop forever on any
				// file carrying two state blocks.
				p.advance()
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

		case lexer.TokKwType:
			if td := p.parseTypeDecl(); td != nil {
				tf.TypeDecls = append(tf.TypeDecls, td)
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
