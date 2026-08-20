package parser

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lexer"
)

// Block-item starter-token sets used by syncToBlockItem for consistent error
// recovery. Each slice names the keyword tokens that can begin a sibling item
// within the corresponding block, so recovery stops at the next valid statement
// rather than skipping to the closing brace.
var (
	sceneBlockStarters = []lexer.TokenKind{lexer.TokKwEntryAction, lexer.TokKwOverview, lexer.TokKwAction}
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
				p.Append(diag.ErrorAt(p.file, t.Line, t.Col, diag.CodeActionTextDuplicate,
					"action %q: at most one text block allowed; remove the duplicate", ab.ID))
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
				p.Append(diag.ErrorAt(p.file, t.Line, t.Col, diag.CodeActionTextDuplicate,
					"action %q: at most one text block allowed; remove the duplicate", ab.ID))
			} else {
				ab.Text = &tv
			}
		case lexer.TokKwCompute:
			ab.Compute = p.parseComputeBlock()
		case lexer.TokKwPublish:
			ab.Publish = p.parsePublishBlock()
		case lexer.TokKwNext:
			ab.Next = append(ab.Next, p.parseNextBlock()...)
		default:
			p.errorf(t, "unexpected token %s %q in action block", kindName(t.Kind), t.Value)
			p.skipUnexpectedItem()
		}
	}
	p.expect(lexer.TokRBrace)
	return ab
}

// ─── parseViewBlock ──────────────────────────────────────────────────────────

// parseOverviewBlock parses `overview <mode> { a |-> b  a |-> c }`.
//
// The flow is a real part of the token stream rather than a heredoc string, so
// every edge carries a source position and the whole block is highlightable.
// The block is unlabelled: it is always the overview, which is what retired
// SCN_OVERVIEW_UNKNOWN_VIEW.
func (p *parser) parseOverviewBlock() *ast.ViewBlock {
	kwTok, _ := p.expect(lexer.TokKwOverview)
	pos := p.posOf(kwTok)

	vb := &ast.ViewBlock{Pos: pos, Name: "overview"}
	// The enforce mode is an optional bare identifier before the brace.
	if p.peek().Kind == lexer.TokIdent {
		vb.Enforce = p.advance().Value
	}
	if _, ok := p.expect(lexer.TokLBrace); !ok {
		p.syncToBlockItem(sceneBlockStarters...)
		return vb
	}

	seenNodes := make(map[string]bool)
	seenEdges := make(map[ast.FlowEdge]bool)
	addNode := func(name string) {
		if !seenNodes[name] {
			seenNodes[name] = true
			vb.Nodes = append(vb.Nodes, name)
		}
	}
	addEdge := func(e ast.FlowEdge) {
		key := ast.FlowEdge{From: e.From, To: e.To} // dedup ignores position
		if !seenEdges[key] {
			seenEdges[key] = true
			vb.Edges = append(vb.Edges, e)
		}
	}

	// Each statement is a chain `a |-> b |-> c`, or a bare node. Chains wire
	// sequentially (a→b, b→c) and every segment but the last becomes a node —
	// the same rules the heredoc flow used, so migrated files keep their graph.
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		fromTok := p.peek()
		if fromTok.Kind != lexer.TokIdent {
			p.errorf(fromTok, "expected an action name in overview block, got %s %q", kindName(fromTok.Kind), fromTok.Value)
			p.syncToBlockItem(sceneBlockStarters...)
			return vb
		}
		p.advance()

		if p.peek().Kind != lexer.TokFlowArrow {
			addNode(fromTok.Value) // bare node statement
			continue
		}
		for p.peek().Kind == lexer.TokFlowArrow {
			arrowTok := p.advance()
			toTok := p.peek()
			if toTok.Kind != lexer.TokIdent {
				p.Append(diag.ErrorAt(p.file, arrowTok.Line, arrowTok.Col,
					diag.CodeOverviewEdgeNoTarget,
					"overview edge |-> has no target action name"))
				return vb
			}
			p.advance()
			addNode(fromTok.Value) // every segment but the last is a node
			addEdge(ast.FlowEdge{Pos: p.posOf(arrowTok), From: fromTok.Value, To: toTok.Value})
			fromTok = toTok
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
		case lexer.TokKwEntryAction:
			p.advance()
			p.expect(lexer.TokEquals)
			sb.EntryAction = p.parseRefVal()
		case lexer.TokKwOverview:
			parsed := p.parseOverviewBlock()
			if sb.View != nil {
				p.Append(diag.ErrorAt(
					p.file, parsed.Pos.Line, parsed.Pos.Col,
					diag.CodeOverviewDuplicate,
					"scene %q: duplicate overview block; only one is allowed per scene", sb.ID,
				))
			} else {
				sb.View = parsed
			}
		case lexer.TokKwAction:
			sb.Actions = append(sb.Actions, p.parseActionBlock())
		default:
			p.errorf(t, "unexpected token %s %q in scene block", kindName(t.Kind), t.Value)
			p.syncToBlockItem(sceneBlockStarters...)
		}
	}
	p.expect(lexer.TokRBrace)
	return sb
}
