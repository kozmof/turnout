package parser

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/lexer"
)

// ─── Route block parsing ──────────────────────────────────────────────────────

// parseRouteBlock parses `route "<id>" { match { ... } }`.
func (p *parser) parseRouteBlock() *ast.RouteBlock {
	pos := p.posOf(p.peek())
	p.advance() // consume the route keyword
	idTok, _ := p.expect(lexer.TokStringLit)
	p.expect(lexer.TokLBrace)
	rb := &ast.RouteBlock{Pos: pos, ID: idTok.Value}
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		switch t.Kind {
		case lexer.TokKwEntry:
			if rb.EntrySceneID != "" {
				p.errorf(t, "duplicate entry declaration in route %q", rb.ID)
				p.advance()
				p.advance() // skip the string literal too
				continue
			}
			p.advance() // consume 'entry'
			idTok, _ := p.expect(lexer.TokStringLit)
			rb.EntrySceneID = idTok.Value
		case lexer.TokKwMatch:
			if rb.Match != nil {
				p.errorf(t, "duplicate match block in route %q", rb.ID)
				p.skipBlock()
				continue
			}
			rb.Match = p.parseMatchBlock()
		default:
			p.errorf(t, "expected 'entry' or 'match' in route block, got %s %q", kindName(t.Kind), t.Value)
			p.advance()
		}
	}
	p.expect(lexer.TokRBrace)
	return rb
}

// parseMatchBlock parses `match { <arm>... }`.
func (p *parser) parseMatchBlock() *ast.MatchBlock {
	pos := p.posOf(p.peek())
	p.advance() // consume the match keyword
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
