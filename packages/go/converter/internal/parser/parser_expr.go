package parser

import (
	"fmt"
	"strconv"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/lexer"
)

// Contextual keywords for the DSL forms. They dropped their `#` prefix in v2
// (NEW_SYNTAX.md 2.1) and are recognised as bare identifiers followed by `(`.
// They are not reserved words: an identifier named `if` is still a valid binding
// reference anywhere a call is not expected.
//
// `#it` deliberately kept its prefix — it is a placeholder, not a reference —
// which is why TokHashIt still exists while TokHashIf/Case/Pipe do not.
const (
	formIf   = "if"
	formCase = "case"
	formPipe = "pipe" // retired spelling, retained for a targeted diagnostic
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
	args := make([]ast.SyntaxArg, 0, 2) // most DSL functions take two arguments
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
	if p.hasPipeForwardInRHS() {
		expr := p.parseLocalExpr()
		pipe, ok := expr.(*ast.LocalPipeExpr)
		if !ok {
			p.errorf(p.peek(), "expected a pipeline expression")
			return &ast.ErrorRHS{}
		}
		return &ast.PipeCallRHS{Pos: pipe.Pos, Initial: pipe.Initial, Steps: pipe.Steps}
	}
	t := p.peek()
	switch t.Kind {
	// ── literal forms ──────────────────────────────────────────────────────
	case lexer.TokBoolLit, lexer.TokNumberLit, lexer.TokStringLit,
		lexer.TokHeredoc, lexer.TokTripleQuote, lexer.TokLBracket, lexer.TokMinus:
		// A literal followed by an operator is the left operand of an infix
		// expression (`100 - discount`); alone it stays a bare literal binding.
		return p.parseInfixFrom(&ast.InfixLeaf{Arg: &ast.LitArg{Value: p.parseLiteral()}})

	// ── _ is invalid as a binding RHS (only valid in case patterns) ──
	case lexer.TokUnderscore:
		p.errorf(t, "_ is not a valid binding RHS; it is reserved for case wildcard patterns")
		p.advance()
		return &ast.LiteralRHS{Value: &ast.BoolLiteral{}}

	// ── block form: unsupported ─────────────────────────────────────────
	case lexer.TokLBrace:
		p.errorf(t, "block-form expressions are not supported; use if(cond, then, else), case(...), or call syntax fn(args)")
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

func (p *parser) hasPipeForwardInRHS() bool {
	depth := 0
	startLine := p.peek().Line
	for i := 0; ; i++ {
		t := p.peekAt(i)
		if t.Kind == lexer.TokEOF || (depth == 0 && t.Kind == lexer.TokRBrace) {
			return false
		}
		if depth == 0 && t.Line > startLine && t.Kind != lexer.TokPipeForward {
			return false
		}
		switch t.Kind {
		case lexer.TokLParen, lexer.TokLBracket:
			depth++
		case lexer.TokRParen, lexer.TokRBracket:
			if depth > 0 {
				depth--
			}
		case lexer.TokPipeForward:
			if depth == 0 {
				return true
			}
		}
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
		// The DSL forms lost their `#` prefix in v2 (NEW_SYNTAX.md 2.1), so they
		// are bare identifiers that must be recognised before the generic call
		// dispatch. None of them collides with a builtin in spec/fn-aliases.json.
		switch nameTok.Value {
		case formIf:
			return p.parseIfCallRHS(p.posOf(nameTok))
		case formCase:
			return p.parseCaseCallRHS(p.posOf(nameTok))
		case formPipe:
			p.errorf(nameTok, "pipe(...) syntax has been removed; write initial |> step instead")
			return &ast.ErrorRHS{}
		}
		// function call: fn_alias(args)
		args := p.parseFuncArgs()
		return &ast.FuncCallRHS{FnAlias: nameTok.Value, Args: args}

	case lexer.TokLBrace:
		// typed template construction: TypeName { field = value ... }
		return p.parseTemplateConstruction(nameTok)

	case lexer.TokDot:
		// A method-call chain is an ordinary operand: it may stand alone as the
		// binding value (NEW_SYNTAX.md 1.3) or sit on either side of an operator.
		// The right operand already reached parseArg, which handles chains; this
		// case is what lets the left operand be something other than a bare ref.
		return p.parseInfixFrom(&ast.InfixLeaf{Arg: p.parseMethodChain(nameTok.Value)})

	default:
		// A bare reference, or the left operand of an infix expression.
		return p.parseInfixFrom(&ast.InfixLeaf{Arg: &ast.RefArg{Name: nameTok.Value}})
	}
}

// ─── nested infix ────────────────────────────────────────────────────────────

// parseInfixFrom parses the remainder of an infix expression whose left operand
// has already been consumed, then normalizes the result.
//
// The normalization is what preserves backward compatibility: an expression with
// exactly one operator and two terminal operands is emitted as the pre-existing
// InfixRHS, so it takes the pre-existing lowering path and produces byte-identical
// output. Only genuinely nested expressions — which could not be written before —
// become NestedInfixRHS.
func (p *parser) parseInfixFrom(lhs ast.InfixNode) ast.BindingRHS {
	branch, ok := p.parseInfixPrec(lhs, 0).(*ast.InfixBranch)
	if !ok {
		// No operator followed, so the RHS is the operand on its own.
		return leafToRHS(lhs)
	}
	l, lIsLeaf := branch.LHS.(*ast.InfixLeaf)
	r, rIsLeaf := branch.RHS.(*ast.InfixLeaf)
	if lIsLeaf && rIsLeaf {
		return &ast.InfixRHS{Op: branch.Op, LHS: l.Arg, RHS: r.Arg}
	}
	return &ast.NestedInfixRHS{Pos: branch.Pos, Root: branch}
}

// leafToRHS converts a lone operand into the binding RHS it represents. A bare
// reference and a bare literal keep the node types they have always used; a bare
// transform chain becomes TransformRHS (NEW_SYNTAX.md 1.3).
func leafToRHS(node ast.InfixNode) ast.BindingRHS {
	leaf, ok := node.(*ast.InfixLeaf)
	if !ok {
		// A branch is handled by the caller; nothing else can reach here.
		return &ast.ErrorRHS{}
	}
	switch a := leaf.Arg.(type) {
	case *ast.LitArg:
		return &ast.LiteralRHS{Value: a.Value}
	case *ast.RefArg:
		return &ast.SingleRefRHS{RefName: a.Name}
	case *ast.MethodCallArg:
		return &ast.TransformRHS{Arg: a}
	default:
		return &ast.ErrorRHS{}
	}
}

// parseInfixPrec is precedence climbing over InfixNode operands, seeded with an
// already-parsed left operand. Precedence comes from infixPrec, the same table
// used by local expressions, so `a & b & c >= 3` groups identically in both.
func (p *parser) parseInfixPrec(lhs ast.InfixNode, minPrec int) ast.InfixNode {
	for {
		prec, ok := infixPrec(p.peek().Kind)
		if !ok || prec < minPrec {
			return lhs
		}
		opTok := p.advance()
		// infixPrec and localInfixOpFromTok are total over the same token set, so
		// no operator check is needed here — parseLocalPrec relies on the same
		// invariant.
		op := localInfixOpFromTok(opTok)
		var rhs ast.InfixNode = &ast.InfixLeaf{Arg: p.parseArg()}
		// Pull any tighter-binding operators into the right operand.
		for {
			nextPrec, ok := infixPrec(p.peek().Kind)
			if !ok || nextPrec <= prec {
				break
			}
			rhs = p.parseInfixPrec(rhs, prec+1)
		}
		lhs = &ast.InfixBranch{Pos: p.posOf(opTok), Op: op, LHS: lhs, RHS: rhs}
	}
}

// ─── if function-call form ─────────────────────────────────────────────

// parseIfCallRHS parses `if(cond_expr, then_expr, else_expr)`.
func (p *parser) parseIfCallRHS(pos ast.Pos) ast.BindingRHS {
	p.expect(lexer.TokLParen)
	cond := p.parseLocalExpr()
	p.expect(lexer.TokComma)
	then := p.parseLocalExpr()
	p.expect(lexer.TokComma)
	els := p.parseLocalExpr()
	p.expect(lexer.TokRParen)
	return &ast.IfCallRHS{Pos: pos, Cond: cond, Then: then, Else: els}
}

// ─── case function-call form ──────────────────────────────────────────────────────────

// parseCaseCallRHS parses `case(subject, pattern -> expr, ..., _ -> default)`.
func (p *parser) parseCaseCallRHS(pos ast.Pos) ast.BindingRHS {
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
	// Guard: `if <expr>` before `->`
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
	case lexer.TokBoolLit, lexer.TokNumberLit, lexer.TokStringLit, lexer.TokMinus:
		lit := p.parseLiteral()
		return &ast.LiteralCasePattern{Pos: p.posOf(t), Value: lit}
	case lexer.TokIdent:
		nameTok := p.advance()
		if p.peek().Kind == lexer.TokLBrace {
			return p.parseTemplateCasePattern(nameTok)
		}
		return &ast.VarBinderPattern{Pos: p.posOf(t), Name: nameTok.Value}
	default:
		p.errorf(t, "expected pattern in case arm, got %s %q", kindName(t.Kind), t.Value)
		return &ast.WildcardCasePattern{Pos: p.posOf(t)}
	}
}

func (p *parser) parseTupleCasePattern() ast.LocalCasePattern {
	open := p.advance()
	var elems []ast.LocalCasePattern
	for p.peek().Kind != lexer.TokRParen && p.peek().Kind != lexer.TokEOF {
		elems = append(elems, p.parseCasePattern())
		if p.peek().Kind != lexer.TokComma {
			break
		}
		p.advance()
	}
	p.expect(lexer.TokRParen)
	return &ast.TupleCasePattern{Pos: p.posOf(open), Elems: elems}
}

// parseTemplateCasePattern parses `TypeName { field[: sub], ... }`. The type name
// identifier has already been consumed. A field with no `: sub` binds the
// capture to its own name.
func (p *parser) parseTemplateCasePattern(nameTok lexer.Token) ast.LocalCasePattern {
	p.expect(lexer.TokLBrace)
	var fields []ast.TemplateFieldPattern
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		fieldTok := p.peek()
		if fieldTok.Kind != lexer.TokIdent {
			p.errorf(fieldTok, "expected capture name in pattern %q, got %s", nameTok.Value, kindName(fieldTok.Kind))
			p.skipTo(lexer.TokRBrace, lexer.TokComma)
			if p.peek().Kind == lexer.TokComma {
				p.advance()
			}
			continue
		}
		p.advance() // consume field name
		var sub ast.LocalCasePattern
		if p.peek().Kind == lexer.TokColon {
			p.advance() // consume ':'
			sub = p.parseCasePattern()
		} else {
			sub = &ast.VarBinderPattern{Pos: p.posOf(fieldTok), Name: fieldTok.Value}
		}
		fields = append(fields, ast.TemplateFieldPattern{
			Pos:  p.posOf(fieldTok),
			Name: fieldTok.Value,
			Sub:  sub,
		})
		if p.peek().Kind == lexer.TokComma {
			p.advance()
		}
	}
	p.expect(lexer.TokRBrace)
	return &ast.TemplateCasePattern{Pos: p.posOf(nameTok), TypeName: nameTok.Value, Fields: fields}
}

// ─── pipe function-call form ───────────────────────────────────────────

// parsePipeCallRHS parses `pipe(initial_expr, step1_expr, step2_expr, ...)`.
func (p *parser) parsePipeCallRHS(pos ast.Pos) ast.BindingRHS {
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
	initial := p.parseLocalPrec(0)
	if p.peek().Kind != lexer.TokPipeForward {
		return initial
	}
	pipe := &ast.LocalPipeExpr{Pos: p.posOf(p.peek()), Initial: initial}
	for p.peek().Kind == lexer.TokPipeForward {
		p.advance()
		pipe.Steps = append(pipe.Steps, p.parseLocalPrec(0))
	}
	return pipe
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
	case lexer.TokHashIt:
		p.advance()
		return &ast.LocalItExpr{Pos: p.posOf(t)}
	case lexer.TokIdent:
		nameTok := p.advance()
		if p.peek().Kind == lexer.TokLParen {
			// Bare DSL forms take precedence over the generic call form; see the
			// matching dispatch in parseIdentRHS.
			switch nameTok.Value {
			case formIf:
				return p.parseLocalIfExpr(p.posOf(nameTok))
			case formCase:
				return p.parseLocalCaseExpr(p.posOf(nameTok))
			case formPipe:
				p.errorf(nameTok, "pipe(...) syntax has been removed; write initial |> step instead")
				return &ast.LocalLitExpr{Pos: p.posOf(nameTok), Value: &ast.BoolLiteral{}}
			}
			args := p.parseLocalArgList()
			return &ast.LocalCallExpr{Pos: p.posOf(nameTok), FnAlias: nameTok.Value, Args: args}
		}
		return &ast.LocalRefExpr{Pos: p.posOf(nameTok), Name: nameTok.Value}
	case lexer.TokLParen:
		return p.parseLocalTupleExpr()
	case lexer.TokBoolLit, lexer.TokNumberLit, lexer.TokStringLit,
		lexer.TokHeredoc, lexer.TokTripleQuote, lexer.TokLBracket, lexer.TokMinus:
		lit := p.parseLiteral()
		return &ast.LocalLitExpr{Pos: p.posOf(t), Value: lit}
	default:
		p.errorf(t, "expected expression, got %s %q", kindName(t.Kind), t.Value)
		return &ast.LocalLitExpr{Pos: p.posOf(t), Value: &ast.BoolLiteral{}}
	}
}

func (p *parser) parseLocalTupleExpr() ast.LocalExpr {
	open := p.advance()
	first := p.parseLocalExpr()
	if p.peek().Kind != lexer.TokComma {
		p.expect(lexer.TokRParen)
		return first
	}
	elems := []ast.LocalExpr{first}
	for p.peek().Kind == lexer.TokComma {
		p.advance()
		elems = append(elems, p.parseLocalExpr())
	}
	p.expect(lexer.TokRParen)
	return &ast.LocalTupleExpr{Pos: p.posOf(open), Elems: elems}
}

func (p *parser) parseLocalIfExpr(pos ast.Pos) ast.LocalExpr {
	p.expect(lexer.TokLParen)
	cond := p.parseLocalExpr()
	p.expect(lexer.TokComma)
	then := p.parseLocalExpr()
	p.expect(lexer.TokComma)
	els := p.parseLocalExpr()
	p.expect(lexer.TokRParen)
	return &ast.LocalIfExpr{Pos: pos, Cond: cond, Then: then, Else: els}
}

func (p *parser) parseLocalCaseExpr(pos ast.Pos) ast.LocalExpr {
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

// parseLocalArgList parses `(expr, expr, ...)` as positional local expressions.
// Named-arg form is rejected because local calls have positional semantics only.
func (p *parser) parseLocalArgList() []ast.LocalExpr {
	p.expect(lexer.TokLParen)
	args := make([]ast.LocalExpr, 0, 2) // most DSL calls take two arguments
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
