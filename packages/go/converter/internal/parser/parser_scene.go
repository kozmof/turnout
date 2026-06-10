package parser

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lexer"
)

// ─── parseActionBlock ────────────────────────────────────────────────────────

func (p *parser) parseActionBlock() *ast.ActionBlock {
	kwTok, _ := p.expect(lexer.TokKwAction)
	pos := p.posOf(kwTok)

	labelTok, _ := p.expect(lexer.TokStringLit)
	if _, ok := p.expect(lexer.TokLBrace); !ok {
		p.syncToBlockItem(lexer.TokKwAction, lexer.TokKwScene, lexer.TokRBrace)
		return &ast.ActionBlock{Pos: pos, ID: labelTok.Value}
	}

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
			if p.peek().Kind == lexer.TokLBrace {
				p.skipBlock()
			}
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
	if _, ok := p.expect(lexer.TokLBrace); !ok {
		p.syncToBlockItem(lexer.TokKwScene, lexer.TokKwRoute, lexer.TokRBrace)
		return &ast.SceneBlock{Pos: pos, ID: labelTok.Value}
	}

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
			parsed := p.parseViewBlock()
			if sb.View != nil {
				p.Append(diag.ErrorAt(
					p.file, parsed.Pos.Line, parsed.Pos.Col,
					diag.CodeOverviewDuplicate,
					"scene %q: duplicate view block; only one view \"overview\" block is allowed", sb.ID,
				))
			} else {
				sb.View = parsed
			}
		case lexer.TokKwAction:
			sb.Actions = append(sb.Actions, p.parseActionBlock())
		default:
			p.errorf(t, "unexpected token %s %q in scene block", kindName(t.Kind), t.Value)
			p.advance()
			if p.peek().Kind == lexer.TokLBrace {
				p.skipBlock()
			}
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
