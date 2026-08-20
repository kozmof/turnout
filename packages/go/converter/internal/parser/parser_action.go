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
//
// Like egress, the clause must continue the line its binding is declared on;
// see parseInlineEgress for why an arrow opening a line is ambiguous.
func (p *parser) parseInlineIngress() ast.InlineIngress {
	if p.peek().Kind != lexer.TokSigilEgress {
		return nil
	}
	// `<~ name:type` is a sigil leading the *next* binding, not this binding's
	// ingress clause: no ingress source is a bare identifier. Leaving it
	// unconsumed hands it to parseBindingDecl, which reports it against the
	// binding that carries it.
	if p.peekAt(1).Kind == lexer.TokIdent && p.peekAt(2).Kind == lexer.TokColon {
		return nil
	}
	// A source opening its own line is the shape both readings fit. It is taken
	// as this binding's ingress, since that is what it would mean were the line
	// joined, but not silently: nothing else recovers the intent.
	if !p.continuesLine(p.peek()) {
		p.errorf(p.peek(), "`<~` must be on the same line as the binding it feeds")
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
//
// The clause must continue the line its binding's value ends on. Everywhere
// else the grammar ignores newlines, but `~>` also leads a binding in the
// retired spelling, so an arrow opening a line is ambiguous: it reads as this
// binding's destination and as the next binding's sigil, and the two mean
// opposite things. The line settles it.
func (p *parser) parseInlineEgress() *ast.InlineEgress {
	if p.peek().Kind != lexer.TokSigilIngress {
		return nil
	}
	// `~> name:type` is a sigil leading the *next* binding, not this binding's
	// egress clause: an egress destination is always a state path. Leaving it
	// unconsumed hands it to parseBindingDecl, which reports it against the
	// binding that carries it.
	if p.peekAt(1).Kind == lexer.TokIdent && p.peekAt(2).Kind == lexer.TokColon {
		return nil
	}
	// A `~> @ns.field` opening its own line is the shape both readings fit. It
	// is taken as this binding's egress, since that is what it would mean were
	// the line joined, but not silently: nothing else recovers the intent.
	if !p.continuesLine(p.peek()) {
		p.errorf(p.peek(), "`~>` must be on the same line as the binding it writes from")
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

	// A sigil belongs after the binding it applies to. Consume a leading one so
	// the binding itself still parses and the rest of the block is checked in
	// the same pass.
	if t.Kind == lexer.TokSigilIngress || t.Kind == lexer.TokSigilEgress || t.Kind == lexer.TokSigilBiDir {
		p.errorf(t, "unexpected %s before binding name", kindName(t.Kind))
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
	bare := false
	if ingress != nil {
		// An ingress binding takes its value from the source, so a RHS would be
		// a second, conflicting definition.
		if p.peek().Kind == lexer.TokEquals {
			p.errorf(p.peek(), "binding %q takes its value from its `<~` source; remove '= ...'", nameTok.Value)
			p.advance()
			p.parseRHS() // consume and discard
		}
		rhs = &ast.SigilInputRHS{}
	} else if (!result && p.peek().Kind != lexer.TokEquals) ||
		(result && p.peek().Kind == lexer.TokRBrace) {
		// A bare `name:type` used to be an input fed by the action's prepare
		// block. With the blocks retired it has no source at all, and lowering
		// would give it the type's zero value — a silent wrong answer at runtime
		// rather than a parse failure. Name it here, where the position is exact.
		bare = true
		rhs = &ast.SigilInputRHS{}
		source := "`<~ @ns.field` or `<~ hook(\"name\")`"
		if p.inNextCompute {
			source = "`<~ action(binding)`, `<~ @ns.field`, or `<~ <literal>`"
		}
		p.Append(diag.ErrorAt(p.file, pos.Line, pos.Col, diag.CodeMissingBindingSource,
			"binding %q has no value: give it a source with %s, or compute one with `= expr`",
			nameTok.Value, source))
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
	if egress != nil && !wrappedEgressRHS && ingress == nil && !bare {
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
			// prog is not a surface block: its bindings belong directly inside
			// compute. Skip it whole so its bindings do not parse as items of a
			// block that cannot hold them.
			p.errorf(t, "unexpected prog block inside compute")
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
//
// An action compute block with no `:=` at all may end in an anonymous egress
// instead; promoteTrailingEgress turns that into the result before the scan, so
// everything below applies to it unchanged.
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
		if promoted := promoteTrailingEgress(prog, want); promoted != nil {
			return promoted.Name
		}
		p.Append(diag.ErrorAt(p.file, prog.Pos.Line, prog.Pos.Col, missingCode,
			"compute %q: missing := result binding%s", prog.Name, missingResultHint(prog, want)))
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
		hint := ""
		if isAnonymousEgress(last) {
			// The trailing write would have been the result had the block carried no
			// `:=` at all, so the fix is a choice between two spellings rather than
			// only "move the marked binding down".
			hint = "; a trailing `(expr) ~> @ns.field` is the result only when the block has no := at all"
		}
		p.Append(diag.ErrorAt(p.file, m.Pos.Line, m.Pos.Col, diag.CodeMarkerNotLast,
			"compute %q: := must designate the last binding; binding %q is not last%s",
			prog.Name, m.Name, hint))
	}

	return m.Name
}

// promoteTrailingEgress makes a trailing anonymous egress the compute result:
// `(true) ~> @triage.paged` as the last item of an action compute block means
// `__result:bool := (true) ~> @triage.paged`. It returns the promoted binding, or
// nil when the block does not qualify.
//
// The binding keeps Anonymous set — that is what tells lowering to take its type
// from the destination STATE field — but it is named here rather than in
// lowering, because compute.root is derived from a name at parse time.
//
// A transition compute is never promoted, which is what `want` decides. Its
// result is a branch condition and an egress writes to STATE, which a transition
// may not do, so promoting would accept the result and then reject the write; the
// missing-condition diagnostic is the more direct answer.
func promoteTrailingEgress(prog *ast.ProgBlock, want ast.BindingMarker) *ast.BindingDecl {
	if want != ast.MarkerRoot {
		return nil
	}
	last := prog.Bindings[len(prog.Bindings)-1]
	if !isAnonymousEgress(last) {
		return nil
	}
	last.Marker = ast.MarkerRoot
	last.Name = names.GeneratedResultName
	return last
}

// isAnonymousEgress reports whether b is a write-only `(expr) ~> @ns.field` item
// with a destination. A missing destination is already reported by
// parseAnonymousEgress, and promoting one would name a binding that has nowhere
// to write.
func isAnonymousEgress(b *ast.BindingDecl) bool {
	return b.Anonymous && b.Egress != nil && b.Egress.Path != ""
}

// missingResultHint names the shorthand when the block looks like it was reaching
// for it — it holds an anonymous egress, just not as its last item. In a
// transition it says why that shorthand is not on offer at all, which is the
// question an author who just used it in an action will have.
func missingResultHint(prog *ast.ProgBlock, want ast.BindingMarker) string {
	held := false
	for _, b := range prog.Bindings {
		if isAnonymousEgress(b) {
			held = true
			break
		}
	}
	if !held {
		return ""
	}
	if want == ast.MarkerCond {
		return "; a transition cannot write to STATE, so a `(expr) ~> @ns.field` write cannot be its condition"
	}
	return "; mark one with `:=`, or move a `(expr) ~> @ns.field` write last to make it the result"
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

// parseNextBlock parses one `next` item of an action. It returns a slice
// because the `on ... to` form abbreviates a whole run of rules; the block and sugar
// forms return one.
func (p *parser) parseNextBlock() []*ast.NextRule {
	kwTok, _ := p.expect(lexer.TokKwNext)
	pos := p.posOf(kwTok)
	// Dispatch form: `next on <subjects> to { ... }` — one rule per arm.
	if p.atNextMatch() {
		return p.parseNextMatchBlock(pos)
	}
	// Sugar form (NEW_SYNTAX.md 1.4): `next <action>` / `next <cond> -> <action>`,
	// distinguished from the block form by the absence of an opening brace.
	if p.peek().Kind == lexer.TokIdent || p.peek().Kind == lexer.TokStringLit {
		return []*ast.NextRule{p.parseNextSugar(pos)}
	}
	if _, ok := p.expect(lexer.TokLBrace); !ok {
		p.syncToBlockItem(lexer.TokKwNext, lexer.TokKwAction, lexer.TokRBrace)
		return []*ast.NextRule{{Pos: pos}}
	}

	var compute *ast.NextComputeBlock
	var actionID string

	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		t := p.peek()
		switch t.Kind {
		case lexer.TokKwCompute:
			compute = p.parseNextComputeBlock()
		case lexer.TokKwAction:
			p.advance()
			p.expect(lexer.TokEquals)
			actionID = p.parseRefVal()
		case lexer.TokKwPublish:
			p.Append(diag.ErrorAt(p.file, t.Line, t.Col, diag.CodeTransitionPublish,
				"publish blocks are not allowed inside next { } transition blocks"))
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

	return []*ast.NextRule{{Pos: pos, Compute: compute, ActionID: actionID}}
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
		// `if` is a plain identifier to the lexer, so catch it by value: it
		// reads as a guard, and reporting it as an unexpected identifier would
		// leave its condition to parse as a binding of the enclosing action.
		if t.Kind == lexer.TokIdent && t.Value == "if" {
			p.errorf(t, "unexpected if in next; write `next <condition> -> <action>`")
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
