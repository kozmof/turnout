// Package parser implements a recursive-descent parser for the Turn DSL.
package parser

import (
	"fmt"
	"strconv"

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
	p := &parser{tokens: tokens, file: file}
	tf := p.parseFile()
	if p.diags.HasErrors() {
		return nil, p.diags
	}
	return tf, p.diags
}

// ParseStateFile parses a state-only file (no scene block required).
// It returns the InlineStateBlock if present, or nil with diagnostics on error.
func ParseStateFile(file, src string) (*ast.InlineStateBlock, diag.Diagnostics) {
	tokens, ld := lexer.Tokenize(file, src)
	if ld.HasErrors() {
		return nil, ld
	}
	p := &parser{tokens: tokens, file: file}
	tf := p.parseFile()

	// Filter out MissingScene — state files legitimately have no scene block.
	var realDiags diag.Diagnostics
	for _, d := range p.diags {
		if d.Code == "MissingScene" {
			continue
		}
		realDiags = append(realDiags, d)
	}
	if realDiags.HasErrors() {
		return nil, realDiags
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
	return inline, realDiags
}

// ─── parser state ────────────────────────────────────────────────────────────

type parser struct {
	tokens []lexer.Token
	pos    int
	file   string
	diags  diag.Diagnostics
	halted bool
}

const maxDiagnostics = 100

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
	if p.halted {
		return
	}
	if len(p.diags) >= maxDiagnostics {
		p.diags = append(p.diags, diag.ErrorAt(
			p.file,
			t.Line,
			t.Col,
			diag.CodeTooManyDiagnostics,
			"too many parse errors; stopping after %d diagnostics",
			maxDiagnostics,
		))
		p.pos = len(p.tokens) - 1
		p.halted = true
		return
	}
	p.diags = append(p.diags, diag.ErrorAt(p.file, t.Line, t.Col,
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
		// Some keywords are valid as bare references (e.g. root = decision when
		// "decision" happens to be parsed as a keyword in another context).
		// In practice keyword names like 'score', 'approve' etc. won't be keywords,
		// but handle the case defensively.
		if isKeyword(t.Kind) {
			p.advance()
			val := t.Value
			for p.peek().Kind == lexer.TokDot {
				p.advance()
				seg := p.peek()
				if seg.Kind == lexer.TokIdent || isKeyword(seg.Kind) {
					p.advance()
					val += "." + seg.Value
				} else {
					break
				}
			}
			return val
		}
		p.errorf(t, "expected identifier or string for reference value, got %s %q", kindName(t.Kind), t.Value)
		return ""
	}
}

// isKeyword reports whether k is any keyword token kind.
func isKeyword(k lexer.TokenKind) bool {
	return k >= lexer.TokKwState && k <= lexer.TokKwText
}

// ─── parseFieldType ──────────────────────────────────────────────────────────

// parseFieldType consumes a type token (TokIdent for scalar types, TokType for
// arr<T>) and returns the corresponding FieldType.
func (p *parser) parseFieldType() (ast.FieldType, bool) {
	t := p.peek()
	switch t.Kind {
	case lexer.TokType:
		p.advance()
		ft, ok := ast.FieldTypeFromString(t.Value)
		if !ok {
			p.errorf(t, "unknown array type %q", t.Value)
			return 0, false
		}
		return ft, true
	case lexer.TokIdent:
		ft, ok := ast.FieldTypeFromString(t.Value)
		if !ok {
			p.errorf(t, "unknown type %q; expected number, str, bool, or arr<T>", t.Value)
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
		return &ast.BoolLiteral{Pos: p.posOf(t), Value: t.Value == "true"}

	case lexer.TokNumberLit:
		p.advance()
		v, err := strconv.ParseFloat(t.Value, 64)
		if err != nil {
			p.errorf(t, "invalid number literal %q: %v", t.Value, err)
			return &ast.NumberLiteral{Pos: p.posOf(t)}
		}
		return &ast.NumberLiteral{Pos: p.posOf(t), Value: v}

	case lexer.TokStringLit:
		p.advance()
		return &ast.StringLiteral{Pos: p.posOf(t), Value: t.Value}

	case lexer.TokHeredoc, lexer.TokTripleQuote:
		p.advance()
		return &ast.StringLiteral{Pos: p.posOf(t), Value: t.Value}

	case lexer.TokLBracket:
		return p.parseArrayLiteral()

	default:
		p.errorf(t, "expected literal value, got %s %q", kindName(t.Kind), t.Value)
		return &ast.BoolLiteral{Pos: p.posOf(t)}
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
	return &ast.ArrayLiteral{Pos: pos, Elements: elems}
}

// ─── parseArg ─────────────────────────────────────────────────────────────────

// parseArg parses one argument in a function call, infix expr, or pipe step.
// Valid forms: bare ident (RefArg), literal (LitArg), { step_ref = N },
// { func_ref = "name" }, { transform = { ref = "v", fn = [...] } },
// or the DSL method-call form: receiver.method1().method2()
func (p *parser) parseArg() ast.Arg {
	t := p.peek()
	switch t.Kind {
	case lexer.TokLBrace:
		return p.parseBlockArg()
	case lexer.TokIdent:
		p.advance()
		// Check for method-call chain: ident followed by one or more .methodName()
		if p.peek().Kind == lexer.TokDot {
			return p.parseMethodChain(t.Value)
		}
		return &ast.RefArg{Name: t.Value}
	default:
		// literal arg
		lit := p.parseLiteral()
		return &ast.LitArg{Value: lit}
	}
}

// parseMethodChain parses `receiver.method1().method2()...` and returns a
// MethodCallArg. The receiver ident has already been consumed.
func (p *parser) parseMethodChain(receiver string) ast.Arg {
	var methods []string
	for p.peek().Kind == lexer.TokDot {
		p.advance() // consume .
		methodTok := p.peek()
		if methodTok.Kind != lexer.TokIdent {
			p.errorf(methodTok, "expected method name after '.', got %s", kindName(methodTok.Kind))
			break
		}
		p.advance() // consume method name
		p.expect(lexer.TokLParen)
		p.expect(lexer.TokRParen)
		methods = append(methods, methodTok.Value)
	}
	return &ast.MethodCallArg{Receiver: receiver, Methods: methods}
}

// parseBlockArg parses { step_ref = N }, { func_ref = "fn" }, or
// { transform = { ref = "v", fn = "..." } }.
func (p *parser) parseBlockArg() ast.Arg {
	open := p.advance() // consume {
	key := p.peek()
	if key.Kind != lexer.TokIdent {
		p.errorf(key, "expected identifier inside block arg, got %s", kindName(key.Kind))
		p.skipTo(lexer.TokRBrace)
		p.advance()
		return &ast.RefArg{}
	}
	p.advance() // consume key ident
	p.expect(lexer.TokEquals)

	var result ast.Arg
	switch key.Value {
	case "step_ref":
		numTok, _ := p.expect(lexer.TokNumberLit)
		v, _ := strconv.ParseFloat(numTok.Value, 64)
		result = &ast.StepRefArg{Index: int(v)}
	case "func_ref":
		strTok, _ := p.expect(lexer.TokStringLit)
		result = &ast.FuncRefArg{FnName: strTok.Value}
	case "transform":
		p.expect(lexer.TokLBrace)
		var ref string
		var fns []string
		for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
			fk := p.peek()
			if fk.Kind != lexer.TokIdent {
				p.advance()
				continue
			}
			p.advance()
			p.expect(lexer.TokEquals)
			switch fk.Value {
			case "ref":
				ref = p.parseRefVal()
			case "fn":
				if p.peek().Kind == lexer.TokLBracket {
					// fn = ["fn1", "fn2", ...]
					p.advance() // consume [
					for p.peek().Kind != lexer.TokRBracket && p.peek().Kind != lexer.TokEOF {
						strTok, _ := p.expect(lexer.TokStringLit)
						fns = append(fns, strTok.Value)
						if p.peek().Kind == lexer.TokComma {
							p.advance()
						}
					}
					p.expect(lexer.TokRBracket)
				} else {
					// Legacy single-string form: fn = "fn1"
					strTok, _ := p.expect(lexer.TokStringLit)
					fns = []string{strTok.Value}
				}
			default:
				p.errorf(fk, "unexpected field %q in transform arg", fk.Value)
				p.advance()
			}
		}
		p.expect(lexer.TokRBrace)
		result = &ast.TransformArg{Ref: ref, Fn: fns}
		_ = open
	default:
		p.errorf(key, "unexpected block arg key %q; expected step_ref, func_ref, or transform", key.Value)
		p.skipTo(lexer.TokRBrace)
		result = &ast.RefArg{}
	}
	p.expect(lexer.TokRBrace)
	return result
}

// parseFuncArgs parses the argument list of a function call: (arg, arg) or
// (name: arg, name: arg). Named form is normalized to ordered Args.
func (p *parser) parseFuncArgs() []ast.Arg {
	p.expect(lexer.TokLParen)
	var args []ast.Arg
	for p.peek().Kind != lexer.TokRParen && p.peek().Kind != lexer.TokEOF {
		// Detect named arg: ident ':'
		if p.peek().Kind == lexer.TokIdent && p.peekAt(1).Kind == lexer.TokColon {
			p.advance() // skip name
			p.advance() // skip ':'
		}
		args = append(args, p.parseArg())
		if p.peek().Kind == lexer.TokComma {
			p.advance()
		} else {
			break
		}
	}
	p.expect(lexer.TokRParen)
	return args
}

// ─── parseRHS ────────────────────────────────────────────────────────────────

// parseRHS parses the right-hand side of a binding declaration.
func (p *parser) parseRHS(_ string) ast.BindingRHS {
	t := p.peek()
	switch t.Kind {
	// ── literal forms ──────────────────────────────────────────────────────
	case lexer.TokBoolLit, lexer.TokNumberLit, lexer.TokStringLit,
		lexer.TokHeredoc, lexer.TokTripleQuote, lexer.TokLBracket:
		return &ast.LiteralRHS{Value: p.parseLiteral()}

	// ── _ is invalid as a binding RHS (v1: only valid in #case patterns) ──
	case lexer.TokUnderscore:
		p.errorf(t, "_ is not a valid binding RHS; it is reserved for #case wildcard patterns")
		p.advance()
		return &ast.LiteralRHS{Value: &ast.BoolLiteral{}}

	// ── #pipe (new function-call form) ────────────────────────────────────
	case lexer.TokHashPipe:
		return p.parsePipeCallRHS()

	// ── #if (new function-call form) ──────────────────────────────────────
	case lexer.TokHashIf:
		return p.parseIfCallRHS()

	// ── #case ─────────────────────────────────────────────────────────────
	case lexer.TokHashCase:
		return p.parseCaseCallRHS()

	// ── block form: rejected in v1 ─────────────────────────────────────────
	case lexer.TokLBrace:
		p.errorf(t, "block-form expressions are not supported in v1; use #if(cond, then, else), #case(...), or call syntax fn(args)")
		p.skipBlock()
		return &ast.LiteralRHS{Value: &ast.BoolLiteral{}}

	// ── ident-based forms ──────────────────────────────────────────────────
	case lexer.TokIdent:
		return p.parseIdentRHS()

	default:
		p.errorf(t, "unexpected token %s %q at start of binding RHS", kindName(t.Kind), t.Value)
		return &ast.LiteralRHS{Value: &ast.BoolLiteral{}}
	}
}

// parseIdentRHS dispatches between FuncCallRHS, InfixRHS, and SingleRefRHS.
func (p *parser) parseIdentRHS() ast.BindingRHS {
	nameTok := p.advance() // consume the first ident
	second := p.peek()

	switch second.Kind {
	case lexer.TokLParen:
		// function call: fn_alias(args)
		args := p.parseFuncArgs()
		return &ast.FuncCallRHS{FnAlias: nameTok.Value, Args: args}

	case lexer.TokAmpersand, lexer.TokGTE, lexer.TokLTE, lexer.TokPlus,
		lexer.TokMinus, lexer.TokStar, lexer.TokSlash, lexer.TokPercent,
		lexer.TokGT, lexer.TokLT, lexer.TokPipe, lexer.TokEqEq, lexer.TokNeq:
		// infix: lhs OP rhs
		opTok := p.advance()
		var op ast.InfixOp
		switch opTok.Kind {
		case lexer.TokAmpersand:
			op = ast.InfixAnd
		case lexer.TokGTE:
			op = ast.InfixGTE
		case lexer.TokLTE:
			op = ast.InfixLTE
		case lexer.TokGT:
			op = ast.InfixGT
		case lexer.TokLT:
			op = ast.InfixLT
		case lexer.TokPipe:
			op = ast.InfixBoolOr
		case lexer.TokEqEq:
			op = ast.InfixEq
		case lexer.TokNeq:
			op = ast.InfixNeq
		case lexer.TokPlus:
			op = ast.InfixPlus
		case lexer.TokMinus:
			op = ast.InfixSub
		case lexer.TokStar:
			op = ast.InfixMul
		case lexer.TokSlash:
			op = ast.InfixDiv
		case lexer.TokPercent:
			op = ast.InfixMod
		}
		rhs := p.parseArg()
		return &ast.InfixRHS{
			Op:  op,
			LHS: &ast.RefArg{Name: nameTok.Value},
			RHS: rhs,
		}

	default:
		// single-reference form
		return &ast.SingleRefRHS{RefName: nameTok.Value}
	}
}

// ─── #if (v1 function-call form) ─────────────────────────────────────────────

// parseIfCallRHS parses `#if(cond_expr, then_expr, else_expr)`.
func (p *parser) parseIfCallRHS() ast.BindingRHS {
	pos := p.posOf(p.peek())
	p.advance() // consume #if
	p.expect(lexer.TokLParen)
	cond := p.parseLocalExpr()
	p.expect(lexer.TokComma)
	then := p.parseLocalExpr()
	p.expect(lexer.TokComma)
	els := p.parseLocalExpr()
	p.expect(lexer.TokRParen)
	return &ast.IfCallRHS{Pos: pos, Cond: cond, Then: then, Else: els}
}

// ─── #case (v1 form) ──────────────────────────────────────────────────────────

// parseCaseCallRHS parses `#case(subject, pattern => expr, ..., _ => default)`.
func (p *parser) parseCaseCallRHS() ast.BindingRHS {
	pos := p.posOf(p.peek())
	p.advance() // consume #case
	p.expect(lexer.TokLParen)
	subject := p.parseLocalExpr()
	var arms []ast.LocalCaseArm
	for p.peek().Kind == lexer.TokComma {
		p.advance() // consume comma
		arm := p.parseCaseArm()
		arms = append(arms, arm)
	}
	p.expect(lexer.TokRParen)
	return &ast.CaseCallRHS{Pos: pos, Subject: subject, Arms: arms}
}

func (p *parser) parseCaseArm() ast.LocalCaseArm {
	pos := p.posOf(p.peek())
	pattern := p.parseCasePattern()

	var guard ast.LocalExpr
	// Guard: `if <expr>` before `=>`
	if p.peek().Kind == lexer.TokIdent && p.peek().Value == "if" {
		p.advance() // consume "if"
		guard = p.parseLocalExpr()
	}

	p.expect(lexer.TokArrow)
	expr := p.parseLocalExpr()
	return ast.LocalCaseArm{Pos: pos, Pattern: pattern, Guard: guard, Expr: expr}
}

func (p *parser) parseCasePattern() ast.LocalCasePattern {
	t := p.peek()
	switch t.Kind {
	case lexer.TokUnderscore:
		p.advance()
		return &ast.WildcardCasePattern{Pos: p.posOf(t)}
	case lexer.TokLParen:
		return p.parseTupleCasePattern()
	case lexer.TokBoolLit, lexer.TokNumberLit, lexer.TokStringLit:
		lit := p.parseLiteral()
		return &ast.LiteralCasePattern{Pos: p.posOf(t), Value: lit}
	case lexer.TokIdent:
		nameTok := p.advance()
		return &ast.VarBinderPattern{Pos: p.posOf(t), Name: nameTok.Value}
	default:
		p.errorf(t, "expected pattern in #case arm, got %s %q", kindName(t.Kind), t.Value)
		return &ast.WildcardCasePattern{Pos: p.posOf(t)}
	}
}

func (p *parser) parseTupleCasePattern() *ast.TupleCasePattern {
	open := p.peek()
	pos := p.posOf(open)
	p.advance() // consume (
	var elems []ast.LocalCasePattern
	for p.peek().Kind != lexer.TokRParen && p.peek().Kind != lexer.TokEOF {
		elems = append(elems, p.parseCasePattern())
		if p.peek().Kind == lexer.TokComma {
			p.advance()
		} else {
			break
		}
	}
	p.expect(lexer.TokRParen)
	return &ast.TupleCasePattern{Pos: pos, Elems: elems}
}

// ─── #pipe (v1 function-call form) ───────────────────────────────────────────

// parsePipeCallRHS parses `#pipe(initial_expr, step1_expr, step2_expr, ...)`.
func (p *parser) parsePipeCallRHS() ast.BindingRHS {
	pos := p.posOf(p.peek())
	p.advance() // consume #pipe
	p.expect(lexer.TokLParen)
	initial := p.parseLocalExpr()
	var steps []ast.LocalExpr
	for p.peek().Kind == lexer.TokComma {
		p.advance() // consume comma
		step := p.parseLocalExpr()
		steps = append(steps, step)
	}
	p.expect(lexer.TokRParen)
	return &ast.PipeCallRHS{Pos: pos, Initial: initial, Steps: steps}
}

// ─── Local expression parser ──────────────────────────────────────────────────

// parseLocalExpr parses a single local expression (ref, literal, call, #it,
// nested #if/#case/#pipe, or a binary infix expression).
func (p *parser) parseLocalExpr() ast.LocalExpr {
	lhs := p.parseLocalPrimary()
	// Check for infix operator
	switch p.peek().Kind {
	case lexer.TokAmpersand, lexer.TokGTE, lexer.TokLTE, lexer.TokGT, lexer.TokLT,
		lexer.TokPipe, lexer.TokEqEq, lexer.TokNeq, lexer.TokPlus, lexer.TokMinus,
		lexer.TokStar, lexer.TokSlash, lexer.TokPercent:
		opTok := p.advance()
		op := localInfixOpFromTok(opTok)
		rhs := p.parseLocalPrimary()
		return &ast.LocalInfixExpr{Pos: p.posOf(opTok), Op: op, LHS: lhs, RHS: rhs}
	}
	return lhs
}

func (p *parser) parseLocalPrimary() ast.LocalExpr {
	t := p.peek()
	switch t.Kind {
	case lexer.TokHashIf:
		return p.parseLocalIfExpr()
	case lexer.TokHashCase:
		return p.parseLocalCaseExpr()
	case lexer.TokHashPipe:
		return p.parseLocalPipeExpr()
	case lexer.TokHashIt:
		p.advance()
		return &ast.LocalItExpr{Pos: p.posOf(t)}
	case lexer.TokIdent:
		nameTok := p.advance()
		if p.peek().Kind == lexer.TokLParen {
			args := p.parseLocalArgList()
			return &ast.LocalCallExpr{Pos: p.posOf(nameTok), FnAlias: nameTok.Value, Args: args}
		}
		return &ast.LocalRefExpr{Pos: p.posOf(nameTok), Name: nameTok.Value}
	case lexer.TokBoolLit, lexer.TokNumberLit, lexer.TokStringLit,
		lexer.TokHeredoc, lexer.TokTripleQuote, lexer.TokLBracket:
		lit := p.parseLiteral()
		return &ast.LocalLitExpr{Pos: p.posOf(t), Value: lit}
	default:
		p.errorf(t, "expected expression, got %s %q", kindName(t.Kind), t.Value)
		return &ast.LocalLitExpr{Pos: p.posOf(t), Value: &ast.BoolLiteral{}}
	}
}

func (p *parser) parseLocalIfExpr() ast.LocalExpr {
	pos := p.posOf(p.peek())
	p.advance() // consume #if
	p.expect(lexer.TokLParen)
	cond := p.parseLocalExpr()
	p.expect(lexer.TokComma)
	then := p.parseLocalExpr()
	p.expect(lexer.TokComma)
	els := p.parseLocalExpr()
	p.expect(lexer.TokRParen)
	return &ast.LocalIfExpr{Pos: pos, Cond: cond, Then: then, Else: els}
}

func (p *parser) parseLocalCaseExpr() ast.LocalExpr {
	pos := p.posOf(p.peek())
	p.advance() // consume #case
	p.expect(lexer.TokLParen)
	subject := p.parseLocalExpr()
	var arms []ast.LocalCaseArm
	for p.peek().Kind == lexer.TokComma {
		p.advance()
		arm := p.parseCaseArm()
		arms = append(arms, arm)
	}
	p.expect(lexer.TokRParen)
	return &ast.LocalCaseExpr{Pos: pos, Subject: subject, Arms: arms}
}

func (p *parser) parseLocalPipeExpr() ast.LocalExpr {
	pos := p.posOf(p.peek())
	p.advance() // consume #pipe
	p.expect(lexer.TokLParen)
	initial := p.parseLocalExpr()
	var steps []ast.LocalExpr
	for p.peek().Kind == lexer.TokComma {
		p.advance()
		steps = append(steps, p.parseLocalExpr())
	}
	p.expect(lexer.TokRParen)
	return &ast.LocalPipeExpr{Pos: pos, Initial: initial, Steps: steps}
}

// parseLocalArgList parses `(expr, expr, ...)` as a list of local expressions.
// Named-arg `name: expr` form is also accepted (the name is skipped).
func (p *parser) parseLocalArgList() []ast.LocalExpr {
	p.expect(lexer.TokLParen)
	var args []ast.LocalExpr
	for p.peek().Kind != lexer.TokRParen && p.peek().Kind != lexer.TokEOF {
		// skip named arg key if present
		if p.peek().Kind == lexer.TokIdent && p.peekAt(1).Kind == lexer.TokColon {
			p.advance()
			p.advance()
		}
		args = append(args, p.parseLocalExpr())
		if p.peek().Kind == lexer.TokComma {
			p.advance()
		} else {
			break
		}
	}
	p.expect(lexer.TokRParen)
	return args
}

func localInfixOpFromTok(t lexer.Token) ast.InfixOp {
	switch t.Kind {
	case lexer.TokAmpersand:
		return ast.InfixAnd
	case lexer.TokGTE:
		return ast.InfixGTE
	case lexer.TokLTE:
		return ast.InfixLTE
	case lexer.TokGT:
		return ast.InfixGT
	case lexer.TokLT:
		return ast.InfixLT
	case lexer.TokPipe:
		return ast.InfixBoolOr
	case lexer.TokEqEq:
		return ast.InfixEq
	case lexer.TokNeq:
		return ast.InfixNeq
	case lexer.TokPlus:
		return ast.InfixPlus
	case lexer.TokMinus:
		return ast.InfixSub
	case lexer.TokStar:
		return ast.InfixMul
	case lexer.TokSlash:
		return ast.InfixDiv
	case lexer.TokPercent:
		return ast.InfixMod
	default:
		return ast.InfixAnd
	}
}

// ─── parseBindingDecl ────────────────────────────────────────────────────────

// parseBindingDecl parses one binding declaration inside a prog block:
// [sigil] name ':' type ['=' rhs]
// Ingress (~>) and bidirectional (<~>) sigils are input-only declarations with no RHS.
// Egress (<~) and plain bindings require '=' followed by an RHS.
func (p *parser) parseBindingDecl() *ast.BindingDecl {
	t := p.peek()
	pos := p.posOf(t)

	// optional sigil
	var sigil ast.Sigil
	switch t.Kind {
	case lexer.TokSigilBiDir:
		sigil = ast.SigilBiDir
		p.advance()
	case lexer.TokSigilEgress:
		sigil = ast.SigilEgress
		p.advance()
	case lexer.TokSigilIngress:
		sigil = ast.SigilIngress
		p.advance()
	}

	nameTok, ok := p.expectIdent()
	if !ok {
		p.skipTo(lexer.TokRBrace)
		return nil
	}

	p.expect(lexer.TokColon)
	ft, ok := p.parseFieldType()
	if !ok {
		p.skipTo(lexer.TokRBrace)
		return nil
	}

	// Input sigils (~> and <~>) have no RHS.
	if sigil == ast.SigilIngress || sigil == ast.SigilBiDir {
		if p.peek().Kind == lexer.TokEquals {
			p.errorf(p.peek(), "input sigil declaration %q must not have a right-hand side; remove '= ...'", nameTok.Value)
			p.advance() // consume =
			p.parseRHS(nameTok.Value) // consume and discard the erroneous RHS
		}
		return &ast.BindingDecl{
			Pos:   pos,
			Sigil: sigil,
			Name:  nameTok.Value,
			Type:  ft,
			RHS:   &ast.SigilInputRHS{},
		}
	}

	p.expect(lexer.TokEquals)
	rhs := p.parseRHS(nameTok.Value)

	return &ast.BindingDecl{
		Pos:   pos,
		Sigil: sigil,
		Name:  nameTok.Value,
		Type:  ft,
		RHS:   rhs,
	}
}

// ─── parseProgBlock ──────────────────────────────────────────────────────────

func (p *parser) parseProgBlock() *ast.ProgBlock {
	kwTok, _ := p.expect(lexer.TokKwProg)
	pos := p.posOf(kwTok)

	nameTok, _ := p.expect(lexer.TokStringLit)
	p.expect(lexer.TokLBrace)

	var bindings []*ast.BindingDecl
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		bd := p.parseBindingDecl()
		if bd != nil {
			bindings = append(bindings, bd)
		}
	}
	p.expect(lexer.TokRBrace)

	return &ast.ProgBlock{Pos: pos, Name: nameTok.Value, Bindings: bindings}
}

// ─── parseComputeBlock ───────────────────────────────────────────────────────

func (p *parser) parseComputeBlock() *ast.ComputeBlock {
	kwTok, _ := p.expect(lexer.TokKwCompute)
	pos := p.posOf(kwTok)
	p.expect(lexer.TokLBrace)

	var root string
	var prog *ast.ProgBlock
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		switch t.Kind {
		case lexer.TokKwRoot:
			p.advance()
			p.expect(lexer.TokEquals)
			root = p.parseRefVal()
		case lexer.TokKwProg:
			prog = p.parseProgBlock()
		default:
			p.errorf(t, "unexpected token %s %q in compute block", kindName(t.Kind), t.Value)
			p.advance()
		}
	}
	p.expect(lexer.TokRBrace)
	return &ast.ComputeBlock{Pos: pos, Root: root, Prog: prog}
}

// ─── parsePrepareBlock (action level) ────────────────────────────────────────

func (p *parser) parsePrepareBlock() *ast.PrepareBlock {
	kwTok, _ := p.expect(lexer.TokKwPrepare)
	pos := p.posOf(kwTok)
	p.expect(lexer.TokLBrace)

	var entries []*ast.PrepareEntry
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		if t.Kind != lexer.TokIdent {
			p.errorf(t, "expected binding name in prepare block, got %s", kindName(t.Kind))
			p.advance()
			continue
		}
		nameTok := p.advance()
		entryPos := p.posOf(nameTok)
		p.expect(lexer.TokLBrace)

		var src ast.PrepareSource
		for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
			fk := p.peek()
			switch fk.Kind {
			case lexer.TokKwFromState:
				p.advance()
				p.expect(lexer.TokEquals)
				src = &ast.FromState{Pos: p.posOf(fk), Path: p.parseRefVal()}
			case lexer.TokKwFromHook:
				p.advance()
				p.expect(lexer.TokEquals)
				hookTok, _ := p.expect(lexer.TokStringLit)
				src = &ast.FromHook{Pos: p.posOf(fk), HookName: hookTok.Value}
			case lexer.TokKwFromLiteral:
				// from_literal valid in action prepare (per spec, validator rejects at action level)
				p.advance()
				p.expect(lexer.TokEquals)
				src = &ast.FromLiteral{Pos: p.posOf(fk), Value: p.parseLiteral()}
			default:
				p.errorf(fk, "unexpected token %s in prepare entry", kindName(fk.Kind))
				p.advance()
			}
		}
		p.expect(lexer.TokRBrace)

		if src == nil {
			p.errorf(nameTok, "prepare entry %q has no source (from_state, from_hook, or from_literal)", nameTok.Value)
			src = &ast.FromState{}
		}
		entries = append(entries, &ast.PrepareEntry{
			Pos:         entryPos,
			BindingName: nameTok.Value,
			Source:      src,
		})
	}
	p.expect(lexer.TokRBrace)
	return &ast.PrepareBlock{Pos: pos, Entries: entries}
}

// ─── parseMergeBlock ─────────────────────────────────────────────────────────

func (p *parser) parseMergeBlock() *ast.MergeBlock {
	kwTok, _ := p.expect(lexer.TokKwMerge)
	pos := p.posOf(kwTok)
	p.expect(lexer.TokLBrace)

	var entries []*ast.MergeEntry
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		if t.Kind != lexer.TokIdent {
			p.errorf(t, "expected binding name in merge block, got %s", kindName(t.Kind))
			p.advance()
			continue
		}
		nameTok := p.advance()
		entryPos := p.posOf(nameTok)
		p.expect(lexer.TokLBrace)

		var toState string
		for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
			fk := p.peek()
			if fk.Kind == lexer.TokKwToState {
				p.advance()
				p.expect(lexer.TokEquals)
				toState = p.parseRefVal()
			} else {
				p.errorf(fk, "unexpected token %s in merge entry", kindName(fk.Kind))
				p.advance()
			}
		}
		p.expect(lexer.TokRBrace)

		entries = append(entries, &ast.MergeEntry{
			Pos:         entryPos,
			BindingName: nameTok.Value,
			ToState:     toState,
		})
	}
	p.expect(lexer.TokRBrace)
	return &ast.MergeBlock{Pos: pos, Entries: entries}
}

// ─── parsePublishBlock ───────────────────────────────────────────────────────

func (p *parser) parsePublishBlock() *ast.PublishBlock {
	kwTok, _ := p.expect(lexer.TokKwPublish)
	pos := p.posOf(kwTok)
	p.expect(lexer.TokLBrace)

	var hooks []string
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		if t.Kind == lexer.TokKwHook {
			p.advance()
			p.expect(lexer.TokEquals)
			hookTok, _ := p.expect(lexer.TokStringLit)
			hooks = append(hooks, hookTok.Value)
		} else {
			p.errorf(t, "unexpected token %s in publish block", kindName(t.Kind))
			p.advance()
		}
	}
	p.expect(lexer.TokRBrace)
	return &ast.PublishBlock{Pos: pos, Hooks: hooks}
}

// ─── parseNextBlock ──────────────────────────────────────────────────────────

func (p *parser) parseNextBlock() *ast.NextRule {
	kwTok, _ := p.expect(lexer.TokKwNext)
	pos := p.posOf(kwTok)
	p.expect(lexer.TokLBrace)

	var compute *ast.NextComputeBlock
	var prepare *ast.NextPrepareBlock
	var actionID string

	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		switch t.Kind {
		case lexer.TokKwCompute:
			compute = p.parseNextComputeBlock()
		case lexer.TokKwPrepare:
			prepare = p.parseNextPrepareBlock()
		case lexer.TokKwAction:
			p.advance()
			p.expect(lexer.TokEquals)
			actionID = p.parseRefVal()
		default:
			p.errorf(t, "unexpected token %s in next block", kindName(t.Kind))
			p.advance()
		}
	}
	p.expect(lexer.TokRBrace)

	return &ast.NextRule{Pos: pos, Compute: compute, Prepare: prepare, ActionID: actionID}
}

func (p *parser) parseNextComputeBlock() *ast.NextComputeBlock {
	kwTok, _ := p.expect(lexer.TokKwCompute)
	pos := p.posOf(kwTok)
	p.expect(lexer.TokLBrace)

	var condition string
	var prog *ast.ProgBlock
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		switch t.Kind {
		case lexer.TokKwCondition:
			p.advance()
			p.expect(lexer.TokEquals)
			condition = p.parseRefVal()
		case lexer.TokKwProg:
			prog = p.parseProgBlock()
		default:
			p.errorf(t, "unexpected token %s in next compute block", kindName(t.Kind))
			p.advance()
		}
	}
	p.expect(lexer.TokRBrace)
	return &ast.NextComputeBlock{Pos: pos, Condition: condition, Prog: prog}
}

func (p *parser) parseNextPrepareBlock() *ast.NextPrepareBlock {
	kwTok, _ := p.expect(lexer.TokKwPrepare)
	pos := p.posOf(kwTok)
	p.expect(lexer.TokLBrace)

	var entries []*ast.NextPrepareEntry
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		if t.Kind != lexer.TokIdent {
			p.errorf(t, "expected binding name in next prepare block, got %s", kindName(t.Kind))
			p.advance()
			continue
		}
		nameTok := p.advance()
		entryPos := p.posOf(nameTok)
		p.expect(lexer.TokLBrace)

		var src ast.NextPrepareSource
		for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
			fk := p.peek()
			switch fk.Kind {
			case lexer.TokKwFromAction:
				p.advance()
				p.expect(lexer.TokEquals)
				src = &ast.FromAction{Pos: p.posOf(fk), BindingName: p.parseRefVal()}
			case lexer.TokKwFromState:
				p.advance()
				p.expect(lexer.TokEquals)
				src = &ast.FromState{Pos: p.posOf(fk), Path: p.parseRefVal()}
			case lexer.TokKwFromLiteral:
				p.advance()
				p.expect(lexer.TokEquals)
				src = &ast.FromLiteral{Pos: p.posOf(fk), Value: p.parseLiteral()}
			default:
				p.errorf(fk, "unexpected token %s in next prepare entry", kindName(fk.Kind))
				p.advance()
			}
		}
		p.expect(lexer.TokRBrace)

		if src == nil {
			p.errorf(nameTok, "next prepare entry %q has no source", nameTok.Value)
			src = &ast.FromState{}
		}
		entries = append(entries, &ast.NextPrepareEntry{
			Pos:         entryPos,
			BindingName: nameTok.Value,
			Source:      src,
		})
	}
	p.expect(lexer.TokRBrace)
	return &ast.NextPrepareBlock{Pos: pos, Entries: entries}
}

// ─── parseActionBlock ────────────────────────────────────────────────────────

func (p *parser) parseActionBlock() *ast.ActionBlock {
	kwTok, _ := p.expect(lexer.TokKwAction)
	pos := p.posOf(kwTok)

	labelTok, _ := p.expect(lexer.TokStringLit)
	p.expect(lexer.TokLBrace)

	ab := &ast.ActionBlock{Pos: pos, ID: labelTok.Value}

	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		switch t.Kind {
		case lexer.TokTripleQuote:
			// triple-quoted docstring
			body := p.advance().Value
			if ab.Text != nil {
				p.errorf(t, "duplicate text in action %q (SCN_ACTION_TEXT_DUPLICATE)", ab.ID)
			} else {
				ab.Text = &body
			}
		case lexer.TokKwText:
			p.advance()
			p.expect(lexer.TokEquals)
			var tv string
			switch p.peek().Kind {
			case lexer.TokStringLit, lexer.TokHeredoc, lexer.TokTripleQuote:
				tv = p.advance().Value
			default:
				p.errorf(p.peek(), "expected string after text =")
			}
			if ab.Text != nil {
				p.errorf(t, "duplicate text in action %q (SCN_ACTION_TEXT_DUPLICATE)", ab.ID)
			} else {
				ab.Text = &tv
			}
		case lexer.TokKwCompute:
			ab.Compute = p.parseComputeBlock()
		case lexer.TokKwPrepare:
			ab.Prepare = p.parsePrepareBlock()
		case lexer.TokKwMerge:
			ab.Merge = p.parseMergeBlock()
		case lexer.TokKwPublish:
			ab.Publish = p.parsePublishBlock()
		case lexer.TokKwNext:
			ab.Next = append(ab.Next, p.parseNextBlock())
		default:
			p.errorf(t, "unexpected token %s %q in action block", kindName(t.Kind), t.Value)
			p.advance()
		}
	}
	p.expect(lexer.TokRBrace)
	return ab
}

// ─── parseViewBlock ──────────────────────────────────────────────────────────

func (p *parser) parseViewBlock() *ast.ViewBlock {
	kwTok, _ := p.expect(lexer.TokKwView)
	pos := p.posOf(kwTok)

	labelTok, _ := p.expect(lexer.TokStringLit)
	p.expect(lexer.TokLBrace)

	vb := &ast.ViewBlock{Pos: pos, Name: labelTok.Value}
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		switch t.Kind {
		case lexer.TokKwFlow:
			p.advance()
			p.expect(lexer.TokEquals)
			tok := p.peek()
			if tok.Kind == lexer.TokHeredoc || tok.Kind == lexer.TokStringLit {
				vb.Flow = p.advance().Value
			} else {
				p.errorf(tok, "expected heredoc or string for flow value")
			}
		case lexer.TokKwEnforce:
			p.advance()
			p.expect(lexer.TokEquals)
			strTok, _ := p.expect(lexer.TokStringLit)
			vb.Enforce = strTok.Value
		default:
			p.errorf(t, "unexpected token %s in view block", kindName(t.Kind))
			p.advance()
		}
	}
	p.expect(lexer.TokRBrace)
	return vb
}

// ─── parseSceneBlock ─────────────────────────────────────────────────────────

func (p *parser) parseSceneBlock() *ast.SceneBlock {
	kwTok, _ := p.expect(lexer.TokKwScene)
	pos := p.posOf(kwTok)

	labelTok, _ := p.expect(lexer.TokStringLit)
	p.expect(lexer.TokLBrace)

	sb := &ast.SceneBlock{Pos: pos, ID: labelTok.Value}
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		switch t.Kind {
		case lexer.TokKwEntryActions:
			p.advance()
			p.expect(lexer.TokEquals)
			sb.EntryActions = p.parseStringArray()
		case lexer.TokKwNextPolicy:
			p.advance()
			p.expect(lexer.TokEquals)
			strTok, _ := p.expect(lexer.TokStringLit)
			sb.NextPolicy = strTok.Value
		case lexer.TokKwView:
			sb.View = p.parseViewBlock()
		case lexer.TokKwAction:
			sb.Actions = append(sb.Actions, p.parseActionBlock())
		default:
			p.errorf(t, "unexpected token %s %q in scene block", kindName(t.Kind), t.Value)
			p.advance()
		}
	}
	p.expect(lexer.TokRBrace)
	return sb
}

// parseStringArray parses `["str1", "str2", ...]` into a []string.
func (p *parser) parseStringArray() []string {
	p.expect(lexer.TokLBracket)
	var result []string
	for p.peek().Kind != lexer.TokRBracket && p.peek().Kind != lexer.TokEOF {
		strTok, ok := p.expect(lexer.TokStringLit)
		if ok {
			result = append(result, strTok.Value)
		}
		if p.peek().Kind == lexer.TokComma {
			p.advance()
		} else {
			break
		}
	}
	p.expect(lexer.TokRBracket)
	return result
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
	ft, _ := p.parseFieldType()
	p.expect(lexer.TokEquals)
	lit := p.parseLiteral()
	return &ast.FieldDecl{Pos: pos, Name: nameTok.Value, Type: ft, Default: lit}
}

// ─── parseFile ───────────────────────────────────────────────────────────────

// ─── Route block parsing ──────────────────────────────────────────────────────

// parseRouteBlock parses `route "<id>" { match { ... } }`.
// "route" has already been identified as a TokIdent with value "route" by the caller.
func (p *parser) parseRouteBlock() *ast.RouteBlock {
	pos := p.posOf(p.peek())
	p.advance() // consume the bare "route" ident
	idTok, _ := p.expect(lexer.TokStringLit)
	p.expect(lexer.TokLBrace)
	rb := &ast.RouteBlock{Pos: pos, ID: idTok.Value}
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		if t.Kind == lexer.TokIdent && t.Value == "match" {
			if rb.Match != nil {
				p.errorf(t, "duplicate match block in route %q", rb.ID)
				p.skipBlock()
				continue
			}
			rb.Match = p.parseMatchBlock()
		} else {
			p.errorf(t, "expected 'match' in route block, got %s %q", kindName(t.Kind), t.Value)
			p.advance()
		}
	}
	p.expect(lexer.TokRBrace)
	return rb
}

// parseMatchBlock parses `match { <arm>... }`.
// "match" has already been identified as a TokIdent with value "match" by the caller.
func (p *parser) parseMatchBlock() *ast.MatchBlock {
	pos := p.posOf(p.peek())
	p.advance() // consume the bare "match" ident
	p.expect(lexer.TokLBrace)
	mb := &ast.MatchBlock{Pos: pos}
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		arm := p.parseMatchArm()
		if arm != nil {
			mb.Arms = append(mb.Arms, arm)
		}
	}
	p.expect(lexer.TokRBrace)
	return mb
}

// parseMatchArm parses one arm: `<branch> (| <branch>)* => <scene_id>,`
func (p *parser) parseMatchArm() *ast.MatchArm {
	pos := p.posOf(p.peek())
	arm := &ast.MatchArm{Pos: pos}

	for {
		branch := p.parsePathExpr()
		if branch == nil {
			// Error already recorded; skip to the next arm boundary to
			// avoid an infinite loop in the caller's loop.
			p.skipTo(lexer.TokArrow, lexer.TokComma, lexer.TokRBrace)
			if p.peek().Kind == lexer.TokArrow {
				// Try to recover by consuming the rest of the arm.
				p.advance() // consume =>
				arm.Target = p.parseRefVal()
				if p.peek().Kind == lexer.TokComma {
					p.advance()
				}
			} else if p.peek().Kind == lexer.TokComma {
				p.advance()
			}
			return nil
		}
		arm.Branches = append(arm.Branches, branch)
		if p.peek().Kind == lexer.TokPipe {
			p.advance() // consume |
			continue
		}
		break
	}

	p.expect(lexer.TokArrow) // =>
	arm.Target = p.parseRefVal()

	// optional trailing comma
	if p.peek().Kind == lexer.TokComma {
		p.advance()
	}
	return arm
}

// parsePathExpr parses `_` or `scene_id(.segment)*` where segment is an ident or `*`.
func (p *parser) parsePathExpr() *ast.PathExpr {
	pos := p.posOf(p.peek())
	t := p.peek()

	if t.Kind == lexer.TokUnderscore {
		p.advance()
		return &ast.PathExpr{Pos: pos, Fallback: true}
	}

	// scene_id — bare ident or keyword used as identifier
	sceneID := ""
	if t.Kind == lexer.TokIdent || isKeyword(t.Kind) {
		p.advance()
		sceneID = t.Value
	} else {
		p.errorf(t, "expected scene_id or _ in path expression, got %s %q", kindName(t.Kind), t.Value)
		return nil
	}

	var segments []string
	for p.peek().Kind == lexer.TokDot {
		p.advance() // consume .
		seg := p.peek()
		switch seg.Kind {
		case lexer.TokStar:
			p.advance()
			segments = append(segments, "*")
		case lexer.TokIdent:
			p.advance()
			segments = append(segments, seg.Value)
		default:
			if isKeyword(seg.Kind) {
				p.advance()
				segments = append(segments, seg.Value)
			} else {
				p.errorf(seg, "expected action_id or * in path expression, got %s %q", kindName(seg.Kind), seg.Value)
			}
		}
	}

	return &ast.PathExpr{Pos: pos, SceneID: sceneID, Segments: segments}
}

func (p *parser) parseFile() *ast.TurnFile {
	tf := &ast.TurnFile{}
	hasState := false

	for p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		switch t.Kind {
		case lexer.TokKwState:
			if hasState {
				p.errorf(t, "duplicate state source (ConflictingStateSource)")
				p.skipBlock()
				continue
			}
			hasState = true
			tf.StateSource = p.parseInlineStateBlock()

		case lexer.TokKwStateFile:
			if hasState {
				p.errorf(t, "duplicate state source (ConflictingStateSource)")
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

		case lexer.TokIdent:
			// `route` is not a hard keyword (to avoid clashing with user identifiers),
			// so it arrives as TokIdent at file top level.
			if t.Value == "route" {
				rb := p.parseRouteBlock()
				if rb != nil {
					tf.Routes = append(tf.Routes, rb)
				}
				continue
			}
			p.errorf(t, "unexpected token %s %q at file top level", kindName(t.Kind), t.Value)
			p.advance()

		default:
			p.errorf(t, "unexpected token %s %q at file top level", kindName(t.Kind), t.Value)
			p.advance()
		}
	}
	if p.halted {
		return tf
	}

	if !hasState {
		p.diags = append(p.diags, diag.Errorf(diag.CodeMissingStateSource,
			"Turn DSL file must contain either a state block or state_file directive"))
	}
	if len(tf.Scenes) == 0 {
		p.diags = append(p.diags, diag.Errorf("MissingScene",
			"Turn DSL file must contain a scene block"))
	}
	return tf
}

// ─── kindName ─────────────────────────────────────────────────────────────────

// kindName returns a human-readable name for a token kind.
func kindName(k lexer.TokenKind) string {
	names := map[lexer.TokenKind]string{
		lexer.TokEOF:            "EOF",
		lexer.TokIdent:          "IDENT",
		lexer.TokType:           "TYPE",
		lexer.TokStringLit:      "STRING",
		lexer.TokNumberLit:      "NUMBER",
		lexer.TokBoolLit:        "BOOL",
		lexer.TokSigilBiDir:     "<~>",
		lexer.TokSigilEgress:    "<~",
		lexer.TokSigilIngress:   "~>",
		lexer.TokLBrace:         "{",
		lexer.TokRBrace:         "}",
		lexer.TokLBracket:       "[",
		lexer.TokRBracket:       "]",
		lexer.TokLParen:         "(",
		lexer.TokRParen:         ")",
		lexer.TokComma:          ",",
		lexer.TokColon:          ":",
		lexer.TokEquals:         "=",
		lexer.TokDot:            ".",
		lexer.TokArrow:          "=>",
		lexer.TokPipe:           "|",
		lexer.TokAmpersand:      "&",
		lexer.TokGTE:            ">=",
		lexer.TokLTE:            "<=",
		lexer.TokGT:             ">",
		lexer.TokLT:             "<",
		lexer.TokPlus:           "+",
		lexer.TokMinus:          "-",
		lexer.TokStar:           "*",
		lexer.TokSlash:          "/",
		lexer.TokPercent:        "%",
		lexer.TokEqEq:           "==",
		lexer.TokNeq:            "!=",
		lexer.TokHashPipe:       "#pipe",
		lexer.TokHashIf:         "#if",
		lexer.TokHashCase:       "#case",
		lexer.TokHashIt:         "#it",
		lexer.TokUnderscore:     "_",
		lexer.TokHeredoc:        "HEREDOC",
		lexer.TokTripleQuote:    "TRIPLE_QUOTE",
		lexer.TokKwState:        "state",
		lexer.TokKwStateFile:    "state_file",
		lexer.TokKwScene:        "scene",
		lexer.TokKwAction:       "action",
		lexer.TokKwCompute:      "compute",
		lexer.TokKwPrepare:      "prepare",
		lexer.TokKwMerge:        "merge",
		lexer.TokKwPublish:      "publish",
		lexer.TokKwNext:         "next",
		lexer.TokKwProg:         "prog",
		lexer.TokKwRoot:         "root",
		lexer.TokKwCondition:    "condition",
		lexer.TokKwEntryActions: "entry_actions",
		lexer.TokKwNextPolicy:   "next_policy",
		lexer.TokKwFromState:    "from_state",
		lexer.TokKwFromAction:   "from_action",
		lexer.TokKwFromHook:     "from_hook",
		lexer.TokKwFromLiteral:  "from_literal",
		lexer.TokKwToState:      "to_state",
		lexer.TokKwHook:         "hook",
		lexer.TokKwView:         "view",
		lexer.TokKwFlow:         "flow",
		lexer.TokKwEnforce:      "enforce",
		lexer.TokKwText:         "text",
	}
	if s, ok := names[k]; ok {
		return s
	}
	return fmt.Sprintf("token(%d)", int(k))
}
