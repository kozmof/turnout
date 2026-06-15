package parser

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lexer"
)

var (
	nextBlockStarters    = []lexer.TokenKind{lexer.TokKwCompute, lexer.TokKwPrepare, lexer.TokKwAction}
	publishBlockStarters = []lexer.TokenKind{lexer.TokKwHook}
)

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
		p.syncToBlockItem(lexer.TokIdent, lexer.TokSigilBiDir, lexer.TokSigilEgress, lexer.TokSigilIngress)
		return nil
	}

	p.expect(lexer.TokColon)
	ft, ok := p.parseFieldType(diag.CodeParseSyntaxError)
	if !ok {
		p.syncToBlockItem(lexer.TokIdent, lexer.TokSigilBiDir, lexer.TokSigilEgress, lexer.TokSigilIngress)
		return nil
	}

	// Input sigils (~> and <~>) have no RHS.
	if sigil == ast.SigilIngress || sigil == ast.SigilBiDir {
		if p.peek().Kind == lexer.TokEquals {
			p.errorf(p.peek(), "input sigil declaration %q must not have a right-hand side; remove '= ...'", nameTok.Value)
			p.advance()    // consume =
			p.parseRHS()   // consume and discard the erroneous RHS
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
	rhs := p.parseRHS()

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
	if _, ok := p.expect(lexer.TokLBrace); !ok {
		p.syncToBlockItem(lexer.TokKwProg, lexer.TokRBrace)
		return &ast.ProgBlock{Pos: pos, Name: nameTok.Value}
	}

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
	if _, ok := p.expect(lexer.TokLBrace); !ok {
		p.syncToBlockItem(lexer.TokKwCompute, lexer.TokKwAction, lexer.TokKwNext, lexer.TokRBrace)
		return &ast.ComputeBlock{Pos: pos}
	}

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
			if prog != nil {
				p.Append(diag.ErrorAt(p.file, t.Line, t.Col, diag.CodeDuplicateProg,
					"compute block may contain at most one prog block"))
				p.advance() // consume 'prog'
				p.advance() // consume name string
				p.skipBlock()
				continue
			}
			prog = p.parseProgBlock()
		default:
			p.errorf(t, "unexpected token %s %q in compute block", kindName(t.Kind), t.Value)
			p.syncToBlockItem(lexer.TokKwRoot, lexer.TokKwProg)
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
			if p.peek().Kind == lexer.TokLBrace {
				p.skipBlock()
			}
			continue
		}
		nameTok := p.advance()
		entryPos := p.posOf(nameTok)
		p.expect(lexer.TokLBrace)

		var src ast.ActionPrepareSource
		for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
			fk := p.peek()
			switch fk.Kind {
			case lexer.TokKwFromState:
				p.advance()
				p.expect(lexer.TokEquals)
				val := p.parseRefVal()
				if src != nil {
					p.Append(diag.ErrorAt(p.file, fk.Line, fk.Col, diag.CodeInvalidPrepareSource,
						"prepare entry %q already has a source; only one of from_state or from_hook is allowed", nameTok.Value))
				} else {
					src = &ast.FromState{Pos: p.posOf(fk), Path: val}
				}
			case lexer.TokKwFromHook:
				p.advance()
				p.expect(lexer.TokEquals)
				hookTok, _ := p.expect(lexer.TokStringLit)
				if src != nil {
					p.Append(diag.ErrorAt(p.file, fk.Line, fk.Col, diag.CodeInvalidPrepareSource,
						"prepare entry %q already has a source; only one of from_state or from_hook is allowed", nameTok.Value))
				} else {
					src = &ast.FromHook{Pos: p.posOf(fk), HookName: hookTok.Value}
				}
			case lexer.TokKwFromLiteral:
				p.errorf(fk, "from_literal is not allowed in action-level prepare; use from_state or from_hook")
				p.advance()
				p.expect(lexer.TokEquals)
				p.parseLiteral() // consume and discard
			default:
				p.errorf(fk, "unexpected token %s in prepare entry", kindName(fk.Kind))
				p.syncToBlockItem(lexer.TokKwFromState, lexer.TokKwFromHook, lexer.TokKwFromLiteral)
			}
		}
		p.expect(lexer.TokRBrace)

		if src == nil {
			p.errorf(nameTok, "prepare entry %q has no source (from_state or from_hook)", nameTok.Value)
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
			if p.peek().Kind == lexer.TokLBrace {
				p.skipBlock()
			}
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
				p.syncToBlockItem(lexer.TokKwToState)
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
			p.syncToBlockItem(publishBlockStarters...)
		}
	}
	p.expect(lexer.TokRBrace)
	return &ast.PublishBlock{Pos: pos, Hooks: hooks}
}

// ─── parseNextBlock ──────────────────────────────────────────────────────────

func (p *parser) parseNextBlock() *ast.NextRule {
	kwTok, _ := p.expect(lexer.TokKwNext)
	pos := p.posOf(kwTok)
	if _, ok := p.expect(lexer.TokLBrace); !ok {
		p.syncToBlockItem(lexer.TokKwNext, lexer.TokKwAction, lexer.TokRBrace)
		return &ast.NextRule{Pos: pos}
	}

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
		case lexer.TokKwMerge, lexer.TokKwPublish:
			p.Append(diag.ErrorAt(p.file, t.Line, t.Col, diag.CodeTransitionMerge,
				"merge and publish blocks are not allowed inside next { } transition blocks"))
			p.advance() // consume the keyword
			if p.peek().Kind == lexer.TokLBrace {
				p.skipBlock()
			}
		default:
			p.errorf(t, "unexpected token %s in next block", kindName(t.Kind))
			p.skipUnexpectedItem()
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
			p.syncToBlockItem(lexer.TokKwCondition, lexer.TokKwProg)
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
			if p.peek().Kind == lexer.TokLBrace {
				p.skipBlock()
			}
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
			case lexer.TokKwFromHook:
				p.Append(diag.ErrorAt(p.file, fk.Line, fk.Col, diag.CodeTransitionHook,
					"from_hook is not allowed inside transition prepare blocks; use from_state, from_action, or from_literal"))
				p.advance() // consume from_hook
				p.expect(lexer.TokEquals)
				p.advance() // consume the hook name value
			default:
				p.errorf(fk, "unexpected token %s in next prepare entry", kindName(fk.Kind))
				p.syncToBlockItem(lexer.TokKwFromAction, lexer.TokKwFromState, lexer.TokKwFromLiteral)
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
