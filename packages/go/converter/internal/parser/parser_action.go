package parser

import (
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lexer"
	"github.com/kozmof/turnout/packages/go/converter/internal/names"
)

var (
	publishBlockStarters = []lexer.TokenKind{lexer.TokKwHook}
)

// parseInlineIngress parses the `<~ <source>` clause, or returns nil if absent.
//
// Which sources are legal depends on the enclosing compute block, and the two
// contexts are parsed by different functions, so the check lands on the exact
// token with the same precision as the block-form diagnostics it replaces:
//
//	action compute: <~ @ns.field | <~ hook("name")
//	next compute:   <~ @ns.field | <~ action(binding) | <~ 300
func (p *parser) parseInlineIngress() ast.InlineIngress {
	if p.peek().Kind != lexer.TokSigilEgress {
		return nil
	}
	arrow := p.advance() // consume <~
	pos := p.posOf(arrow)

	switch t := p.peek(); {
	case t.Kind == lexer.TokAt:
		p.advance()
		return &ast.IngressState{Pos: pos, Path: p.parseStatePath()}

	case t.Kind == lexer.TokKwHook:
		p.advance()
		p.expect(lexer.TokLParen)
		nameTok, _ := p.expect(lexer.TokStringLit)
		p.expect(lexer.TokRParen)
		if p.inNextCompute {
			p.Append(diag.ErrorAt(p.file, t.Line, t.Col, diag.CodeTransitionHook,
				"hook() is not allowed inside a transition compute; use @state.path, action(binding), or a literal"))
			return &ast.IngressState{Pos: pos}
		}
		return &ast.IngressHook{Pos: pos, HookName: nameTok.Value}

	case t.Kind == lexer.TokKwAction:
		p.advance()
		p.expect(lexer.TokLParen)
		refTok, _ := p.expectIdent()
		p.expect(lexer.TokRParen)
		if !p.inNextCompute {
			p.errorf(t, "action() is only valid inside a transition compute; an action-level binding reads from @state.path or hook()")
			return &ast.IngressState{Pos: pos}
		}
		return &ast.IngressAction{Pos: pos, BindingName: refTok.Value}

	default:
		lit := p.parseLiteral()
		if !p.inNextCompute {
			p.errorf(t, "a literal ingress is only valid inside a transition compute; at action level write `%s = <literal>` as an ordinary binding", "name:type")
			return &ast.IngressState{Pos: pos}
		}
		return &ast.IngressLiteral{Pos: pos, Value: lit}
	}
}

// parseInlineEgress parses the `~> @ns.field` clause, or returns nil if absent.
func (p *parser) parseInlineEgress() *ast.InlineEgress {
	if p.peek().Kind != lexer.TokSigilIngress {
		return nil
	}
	arrow := p.advance() // consume ~>
	pos := p.posOf(arrow)
	if p.peek().Kind != lexer.TokAt {
		p.errorf(p.peek(), "expected a state path after ~>, e.g. `~> @investigation.phase`")
		return &ast.InlineEgress{Pos: pos}
	}
	p.advance() // consume @
	return &ast.InlineEgress{Pos: pos, Path: p.parseStatePath()}
}

// parseStatePath parses the dotted path after `@`, e.g. `investigation.phase`.
func (p *parser) parseStatePath() string {
	nsTok, ok := p.expectIdent()
	if !ok {
		return ""
	}
	path := nsTok.Value
	for p.peek().Kind == lexer.TokDot {
		p.advance()
		fieldTok, ok := p.expectIdent()
		if !ok {
			return path
		}
		path += "." + fieldTok.Value
	}
	return path
}

// ─── parseBindingDecl ────────────────────────────────────────────────────────

// parseBindingDecl parses one binding declaration inside a compute block:
// name ':' type ('=' ordinary | ':=' result)
// Inputs use `<~ source` and have no RHS. Computed egress requires the complete
// RHS wrapper `(expr) ~> @path` after either assignment operator.
func (p *parser) parseBindingDecl() *ast.BindingDecl {
	t := p.peek()
	pos := p.posOf(t)

	// A sigil in the leading position is the pre-v2 spelling. It cannot simply be
	// reported as a syntax error: the arrows inverted when they moved to infix
	// position (`~>` was ingress, and with `@path` on the right it is egress), so
	// a half-migrated file can still parse while meaning the opposite thing.
	// Name the migration explicitly instead.
	if t := p.peek(); t.Kind == lexer.TokSigilIngress || t.Kind == lexer.TokSigilEgress || t.Kind == lexer.TokSigilBiDir {
		p.Append(diag.ErrorAt(p.file, t.Line, t.Col, diag.CodeLegacySigilPosition,
			"old sigil position: %s now follows the binding and points at its destination — write `name:type <~ @ns.field` for input and `name:type = (expr) ~> @ns.field` for output; see migration notes", t.Value))
		p.advance()
	}

	nameTok, ok := p.expectIdent()
	if !ok {
		p.syncToBlockItem(lexer.TokIdent, lexer.TokSigilBiDir, lexer.TokSigilEgress, lexer.TokSigilIngress)
		return nil
	}

	p.expect(lexer.TokColon)
	ft, declared, ok := p.parseBindingType()
	if !ok {
		p.syncToBlockItem(lexer.TokIdent, lexer.TokSigilBiDir, lexer.TokSigilEgress, lexer.TokSigilIngress)
		return nil
	}

	marker := ast.MarkerNone
	result := p.peek().Kind == lexer.TokResult
	if result {
		p.advance()
		marker = ast.MarkerRoot
		if p.inNextCompute {
			marker = ast.MarkerCond
		}
	}

	// Inline IO: `name:type <~ <source>` and/or an assigned `(expr) ~> @ns.field`.
	ingress := p.parseInlineIngress()

	var rhs ast.BindingRHS
	wrappedEgressRHS := false
	if ingress != nil {
		// An ingress binding takes its value from the source, so a RHS would be
		// a second, conflicting definition.
		if p.peek().Kind == lexer.TokEquals {
			p.errorf(p.peek(), "binding %q takes its value from its `<~` source; remove '= ...'", nameTok.Value)
			p.advance()
			p.parseRHS() // consume and discard
		}
		rhs = &ast.SigilInputRHS{}
	} else if !result && p.peek().Kind != lexer.TokEquals {
		// A bare `name:type` is an input declaration whose source lives in the
		// action's prepare block. With the prefix sigils retired, this is what the
		// block form looks like; a missing prepare entry is caught downstream by
		// the same check that always covered it.
		rhs = &ast.SigilInputRHS{}
	} else if result && p.peek().Kind == lexer.TokRBrace {
		// A block-backed input may be the compute result without an inline source.
		rhs = &ast.SigilInputRHS{}
	} else {
		if !result {
			p.expect(lexer.TokEquals)
		}
		if p.peek().Kind == lexer.TokLParen {
			wrappedEgressRHS = true
			p.advance()
			rhs = p.parseRHS()
			p.expect(lexer.TokRParen)
		} else {
			rhs = p.parseRHS()
		}
	}

	egress := p.parseInlineEgress()
	assignment := "="
	if result {
		assignment = ":="
	}
	if egress != nil && !wrappedEgressRHS && ingress == nil {
		p.Append(diag.ErrorAt(p.file, egress.Pos.Line, egress.Pos.Col, diag.CodeParseSyntaxError,
			"computed egress binding %q must parenthesize its complete RHS; write `%s:%s %s (expr) ~> @state.path`",
			nameTok.Value, nameTok.Value, ft, assignment))
	}
	if wrappedEgressRHS && egress == nil {
		p.Append(diag.ErrorAt(p.file, pos.Line, pos.Col, diag.CodeParseSyntaxError,
			"top-level parenthesized RHS is reserved for computed egress; write `%s:%s %s expr` or `%s:%s %s (expr) ~> @state.path`",
			nameTok.Value, ft, assignment, nameTok.Value, ft, assignment))
	}

	sigil := ast.SigilNone
	switch {
	case ingress != nil && egress != nil:
		sigil = ast.SigilBiDir
	case ingress != nil:
		sigil = ast.SigilIngress
	case egress != nil:
		sigil = ast.SigilEgress
	}

	return &ast.BindingDecl{
		Pos:          pos,
		Sigil:        sigil,
		Ingress:      ingress,
		Egress:       egress,
		Marker:       marker,
		Name:         nameTok.Value,
		Type:         ft,
		DeclaredType: declared,
		RHS:          rhs,
	}
}

// parseAnonymousEgress parses a write-only prog item: `(expr) ~> @ns.field`.
// Its type and compiler-reserved binding name are assigned during lowering.
func (p *parser) parseAnonymousEgress() *ast.BindingDecl {
	open := p.advance()
	rhs := p.parseRHS()
	p.expect(lexer.TokRParen)
	egress := p.parseInlineEgress()
	if egress == nil {
		p.Append(diag.ErrorAt(p.file, open.Line, open.Col, diag.CodeParseSyntaxError,
			"anonymous parenthesized expression must write to STATE; add `~> @state.path`"))
	}
	return &ast.BindingDecl{
		Pos:       p.posOf(open),
		Sigil:     ast.SigilEgress,
		Anonymous: true,
		Type:      ast.FieldTypeInvalid,
		RHS:       rhs,
		Egress:    egress,
	}
}

// ─── parseProgBody ───────────────────────────────────────────────────────────

// parseProgBody parses the `{ <binding-decl>... }` body of a compute block and
// returns the ProgBlock the model still expects. `pos` and `name` come from the
// enclosing compute header — the surface language has no separate prog block,
// but the lowered model keeps the compute/prog split.
func (p *parser) parseProgBody(pos ast.Pos, name string) *ast.ProgBlock {
	var bindings []*ast.BindingDecl
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		if t := p.peek(); t.Kind == lexer.TokKwProg {
			// The old nested spelling. Name the replacement in the message,
			// reusing the prog's own label when it has one.
			label := name
			if lbl := p.peekAt(1); lbl.Kind == lexer.TokStringLit {
				label = lbl.Value
			}
			p.Append(diag.ErrorAt(p.file, t.Line, t.Col, diag.CodeLegacyProgBlock,
				"prog blocks were merged into compute; write compute %q { ... } "+
					"with the bindings directly inside", label))
			p.advance() // consume 'prog'
			if p.peek().Kind == lexer.TokStringLit {
				p.advance() // consume name string
			}
			p.skipBlock()
			continue
		}
		var bd *ast.BindingDecl
		if p.peek().Kind == lexer.TokLParen {
			bd = p.parseAnonymousEgress()
		} else {
			bd = p.parseBindingDecl()
		}
		if bd != nil {
			bindings = append(bindings, bd)
		}
	}
	p.expect(lexer.TokRBrace)

	return &ast.ProgBlock{Pos: pos, Name: name, Bindings: bindings}
}

// ─── parseComputeBlock ───────────────────────────────────────────────────────

func (p *parser) parseComputeBlock() *ast.ComputeBlock {
	kwTok, _ := p.expect(lexer.TokKwCompute)
	pos := p.posOf(kwTok)

	nameTok, _ := p.expect(lexer.TokStringLit)
	if _, ok := p.expect(lexer.TokLBrace); !ok {
		p.syncToBlockItem(lexer.TokKwCompute, lexer.TokKwAction, lexer.TokKwNext, lexer.TokRBrace)
		return &ast.ComputeBlock{Pos: pos}
	}

	prog := p.parseProgBody(pos, nameTok.Value)
	root := p.deriveMarker(prog, ast.MarkerRoot)
	return &ast.ComputeBlock{Pos: pos, Root: root, Prog: prog}
}

// deriveMarker scans prog's bindings for the `:=` result and returns its
// binding name, emitting diagnostics when the result rules are violated.
// `want` selects the contextual role used in this
// context (MarkerRoot in action compute, MarkerCond in next compute). The
// invariant enforced: exactly one result, with the expected contextual role,
// on the last binding of the prog.
func (p *parser) deriveMarker(prog *ast.ProgBlock, want ast.BindingMarker) string {
	missingCode := diag.CodeMissingRootMarker
	markerStr := ast.MarkerRoot.String()
	if want == ast.MarkerCond {
		missingCode = diag.CodeMissingConditionMarker
		markerStr = ast.MarkerCond.String()
	}

	if prog == nil || len(prog.Bindings) == 0 {
		return ""
	}

	var marked []*ast.BindingDecl
	for _, b := range prog.Bindings {
		if b.Marker != ast.MarkerNone {
			marked = append(marked, b)
		}
	}

	if len(marked) == 0 {
		p.Append(diag.ErrorAt(p.file, prog.Pos.Line, prog.Pos.Col, missingCode,
			"compute %q: missing := result binding", prog.Name))
		return ""
	}

	if len(marked) > 1 {
		second := marked[1]
		p.Append(diag.ErrorAt(p.file, second.Pos.Line, second.Pos.Col, diag.CodeDuplicateMarker,
			"compute %q: at most one := result is allowed per compute block; binding %q is a second result",
			prog.Name, second.Name))
	}

	m := marked[0]
	if m.Marker != want {
		p.Append(diag.ErrorAt(p.file, m.Pos.Line, m.Pos.Col, diag.CodeMarkerContext,
			"compute %q: result role %s on binding %q is not valid here; expected %s",
			prog.Name, m.Marker, m.Name, markerStr))
	}

	if last := prog.Bindings[len(prog.Bindings)-1]; last != m {
		p.Append(diag.ErrorAt(p.file, m.Pos.Line, m.Pos.Col, diag.CodeMarkerNotLast,
			"compute %q: := must designate the last binding; binding %q is not last",
			prog.Name, m.Name))
	}

	return m.Name
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
	// Sugar form (NEW_SYNTAX.md 1.4): `next <action>` / `next <cond> -> <action>`,
	// distinguished from the block form by the absence of an opening brace.
	if p.peek().Kind == lexer.TokIdent || p.peek().Kind == lexer.TokStringLit {
		return p.parseNextSugar(pos)
	}
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

// parseNextSugar parses `next <action>` and `next <cond> -> <action>`, expanding
// the conditional form into exactly the block form it abbreviates: a synthesized
// prog holding the ingress binding and the `:=` condition, plus the from_action
// prepare entry that feeds it. Lowering sees no difference between the two.
//
// The guard reads in evaluation order, matching `|=>` in overview blocks and
// `=>` in route match arms. Which form a line takes only becomes clear at the
// token after the first reference, so the head is parsed before it is known
// whether it named the condition or the target.
//
// The condition must be a bare boolean binding of the enclosing action's prog;
// richer conditions keep the block form.
func (p *parser) parseNextSugar(pos ast.Pos) *ast.NextRule {
	// A quoted head can only be a target: a condition names a binding, and
	// binding names are never written as strings.
	if p.peek().Kind == lexer.TokStringLit {
		return &ast.NextRule{Pos: pos, ActionID: p.parseRefVal()}
	}

	condPos := p.posOf(p.peek())
	head := p.parseRefVal()

	if t := p.peek(); t.Kind != lexer.TokTransArrow {
		// The `if` form this replaced is still what a reader reaches for, and
		// `if` is a plain identifier to the lexer, so catch it by value and say
		// what to write instead rather than reporting an unexpected token.
		if t.Kind == lexer.TokIdent && t.Value == "if" {
			p.Append(diag.ErrorAt(p.file, t.Line, t.Col, diag.CodeLegacyTransitionIf,
				"the `next <action> if <condition>` form was removed; write `next <condition> -> <action>`"))
			p.advance() // consume `if`
			// Drop the trailing condition too, so the rest of the action still
			// parses and the author sees every error in the file at once.
			if p.peek().Kind == lexer.TokIdent {
				p.advance()
			}
		}
		return &ast.NextRule{Pos: pos, ActionID: head}
	}
	p.advance() // consume `->`

	cond := head
	if strings.Contains(cond, ".") {
		p.Append(diag.ErrorAt(p.file, condPos.Line, condPos.Col, diag.CodeNextComputeInvalid,
			"transition condition %q must be a bare binding of this action's compute prog; "+
				"richer conditions need the next { } block form", cond))
		return &ast.NextRule{Pos: pos, ActionID: p.parseRefVal()}
	}

	actionID := p.parseRefVal()
	if actionID == "" {
		return &ast.NextRule{Pos: pos}
	}
	rule := &ast.NextRule{Pos: pos, ActionID: actionID}

	// The synthesized condition binding needs a name that cannot collide with a
	// user binding; names.LocalName is the established generator for that.
	goName := names.LocalName(actionID, "go", 0)

	rule.Compute = &ast.NextComputeBlock{
		Pos:       pos,
		Condition: goName,
		Prog: &ast.ProgBlock{
			Pos:  pos,
			Name: names.LocalName(actionID, "next", 0),
			Bindings: []*ast.BindingDecl{
				{
					Pos:   condPos,
					Sigil: ast.SigilIngress,
					Name:  cond,
					Type:  ast.FieldTypeBool,
					RHS:   &ast.SigilInputRHS{},
				},
				{
					Pos:    condPos,
					Marker: ast.MarkerCond,
					Name:   goName,
					Type:   ast.FieldTypeBool,
					RHS:    &ast.SingleRefRHS{RefName: cond},
				},
			},
		},
	}
	rule.Prepare = &ast.NextPrepareBlock{
		Pos: pos,
		Entries: []*ast.NextPrepareEntry{{
			Pos:         condPos,
			BindingName: cond,
			Source:      &ast.FromAction{Pos: condPos, BindingName: cond},
		}},
	}
	return rule
}

func (p *parser) parseNextComputeBlock() *ast.NextComputeBlock {
	kwTok, _ := p.expect(lexer.TokKwCompute)
	pos := p.posOf(kwTok)
	// Inline IO accepts a different set of ingress sources inside a transition.
	p.inNextCompute = true
	defer func() { p.inNextCompute = false }()

	nameTok, _ := p.expect(lexer.TokStringLit)
	if _, ok := p.expect(lexer.TokLBrace); !ok {
		p.syncToBlockItem(lexer.TokKwCompute, lexer.TokKwAction, lexer.TokKwNext, lexer.TokRBrace)
		return &ast.NextComputeBlock{Pos: pos}
	}

	prog := p.parseProgBody(pos, nameTok.Value)
	condition := p.deriveMarker(prog, ast.MarkerCond)
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
