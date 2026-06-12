package parser

import (
	"fmt"
	"strconv"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/lexer"
)

// ─── parseArg ─────────────────────────────────────────────────────────────────

// parseArg parses one argument in a function call, infix expr, or pipe step.
// Valid forms: bare ident (RefArg), literal (LitArg), { step_ref = N },
// { func_ref = "name" }, { transform = { ref = "v", fn = [...] } },
// or the DSL method-call form: receiver.method1().method2()
func (p *parser) parseArg() ast.SyntaxArg {
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
func (p *parser) parseMethodChain(receiver string) ast.SyntaxArg {
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
func (p *parser) parseBlockArg() ast.SyntaxArg {
	p.advance() // consume {
	key := p.peek()
	if key.Kind != lexer.TokIdent {
		p.errorf(key, "expected identifier inside block arg, got %s", kindName(key.Kind))
		p.skipTo(lexer.TokRBrace)
		p.advance()
		return &ast.RefArg{}
	}
	p.advance() // consume key ident
	p.expect(lexer.TokEquals)

	var result ast.SyntaxArg
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
	default:
		p.errorf(key, "unexpected block arg key %q; expected step_ref, func_ref, or transform", key.Value)
		p.skipTo(lexer.TokRBrace)
		result = &ast.RefArg{}
	}
	p.expect(lexer.TokRBrace)
	return result
}

// parseFuncArgs parses the positional argument list of a function call: (arg, arg).
// Named-arg form is rejected because calls have positional semantics only.
func (p *parser) parseFuncArgs() []ast.SyntaxArg {
	p.expect(lexer.TokLParen)
	args := make([]ast.SyntaxArg, 0, 2) // most DSL functions are binary
	for p.peek().Kind != lexer.TokRParen && p.peek().Kind != lexer.TokEOF {
		p.consumeNamedArgIfPresent()
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
func (p *parser) parseRHS() ast.BindingRHS {
	t := p.peek()
	switch t.Kind {
	// ── literal forms ──────────────────────────────────────────────────────
	case lexer.TokBoolLit, lexer.TokNumberLit, lexer.TokStringLit,
		lexer.TokHeredoc, lexer.TokTripleQuote, lexer.TokLBracket, lexer.TokMinus:
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

// tokenToInfixOp converts an infix operator token to the corresponding ast.InfixOp.
// Returns (op, true) on success, (0, false) for unrecognised tokens.
// This is the single source of truth for the token→op mapping used by both
// parseIdentRHS (outer binding dispatch) and localInfixOpFromTok (local expressions).
func tokenToInfixOp(t lexer.Token) (ast.InfixOp, bool) {
	switch t.Kind {
	case lexer.TokAmpersand:
		return ast.InfixAnd, true
	case lexer.TokGTE:
		return ast.InfixGTE, true
	case lexer.TokLTE:
		return ast.InfixLTE, true
	case lexer.TokGT:
		return ast.InfixGT, true
	case lexer.TokLT:
		return ast.InfixLT, true
	case lexer.TokPipe:
		return ast.InfixBoolOr, true
	case lexer.TokEqEq:
		return ast.InfixEq, true
	case lexer.TokNeq:
		return ast.InfixNeq, true
	case lexer.TokPlus:
		return ast.InfixPlus, true
	case lexer.TokMinus:
		return ast.InfixSub, true
	case lexer.TokStar:
		return ast.InfixMul, true
	case lexer.TokSlash:
		return ast.InfixDiv, true
	case lexer.TokPercent:
		return ast.InfixMod, true
	default:
		return 0, false
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
		op, ok := tokenToInfixOp(opTok)
		if !ok {
			p.errorf(opTok, "internal error: parseIdentRHS infix switch on unexpected token kind %v", opTok.Kind)
			return &ast.SingleRefRHS{RefName: nameTok.Value}
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
		p.errorf(t, "tuple patterns are not supported in #case; use _ to match any value or a variable binder (e.g. x) to capture it")
		p.skipTo(lexer.TokArrow, lexer.TokRParen, lexer.TokComma)
		return &ast.WildcardCasePattern{Pos: p.posOf(t)}
	case lexer.TokBoolLit, lexer.TokNumberLit, lexer.TokStringLit, lexer.TokMinus:
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

// infixPrec returns the binding precedence for an infix token (higher binds tighter).
// Returns (0, false) for non-infix tokens.
//
// Precedence table (highest binds tightest):
//
//	5  *  /  %
//	4  +  -
//	3  <  <=  >  >=
//	2  ==  !=
//	1  & (bool_and)
//	0  | (bool_or)
func infixPrec(k lexer.TokenKind) (int, bool) {
	switch k {
	case lexer.TokStar, lexer.TokSlash, lexer.TokPercent:
		return 5, true
	case lexer.TokPlus, lexer.TokMinus:
		return 4, true
	case lexer.TokLT, lexer.TokLTE, lexer.TokGT, lexer.TokGTE:
		return 3, true
	case lexer.TokEqEq, lexer.TokNeq:
		return 2, true
	case lexer.TokAmpersand:
		return 1, true
	case lexer.TokPipe:
		return 0, true
	default:
		return 0, false
	}
}

// parseLocalExpr parses a local expression using precedence climbing so that
// operator precedence is respected: e.g. `a + b * c` parses as `a + (b * c)`.
func (p *parser) parseLocalExpr() ast.LocalExpr {
	return p.parseLocalPrec(0)
}

func (p *parser) parseLocalPrec(minPrec int) ast.LocalExpr {
	lhs := p.parseLocalPrimary()
	for {
		prec, ok := infixPrec(p.peek().Kind)
		if !ok || prec < minPrec {
			break
		}
		opTok := p.advance()
		rhs := p.parseLocalPrec(prec + 1) // +1 for left-associativity
		lhs = &ast.LocalInfixExpr{Pos: p.posOf(opTok), Op: localInfixOpFromTok(opTok), LHS: lhs, RHS: rhs}
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
		lexer.TokHeredoc, lexer.TokTripleQuote, lexer.TokLBracket, lexer.TokMinus:
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

// parseLocalArgList parses `(expr, expr, ...)` as positional local expressions.
// Named-arg form is rejected because local calls have positional semantics only.
func (p *parser) parseLocalArgList() []ast.LocalExpr {
	p.expect(lexer.TokLParen)
	args := make([]ast.LocalExpr, 0, 2) // most DSL calls are binary
	for p.peek().Kind != lexer.TokRParen && p.peek().Kind != lexer.TokEOF {
		p.consumeNamedArgIfPresent()
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
	op, ok := tokenToInfixOp(t)
	if !ok {
		panic(fmt.Sprintf("unreachable: localInfixOpFromTok called with unexpected token kind %v", t.Kind))
	}
	return op
}
