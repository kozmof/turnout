package parser

import (
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lexer"
	"github.com/kozmof/turnout/packages/go/converter/internal/names"
)

// ─── next … match ────────────────────────────────────────────────────────────
//
// `next on (foo, bar, baz) match { ("yes", "cat", _) => act, _ => other }`
// abbreviates one `next { }` rule per arm. Selecting among sibling actions
// otherwise needs one boolean flag per target, computed in the action's prog
// only to be named by a transition; the flags hide the fact that the branches
// partition a single subject.
//
// This is pure surface sugar. Every arm expands into exactly the rule an author
// would have written by hand, so nothing downstream — lower, emit, the wire
// model, the runtime — can tell the two spellings apart.

// matchSubject is one name in the `on (...)` list, kept with its position so a
// bad subject reports at the subject rather than at the block.
type matchSubject struct {
	Pos  ast.Pos
	Name string
}

// matchElem is one column of one arm. Lit is nil for `_`.
type matchElem struct {
	Pos ast.Pos
	Lit ast.Literal
}

// matchArm is one `<pattern> => <action>` row. Elems is nil when the arm is
// unconditional — either the bare `_` fallback or a tuple of all wildcards.
type matchArm struct {
	Pos      ast.Pos
	Elems    []matchElem
	ActionID string
	Uncond   bool
}

// atNextMatch reports whether the tokens after `next` open a match block.
//
// `on` is deliberately not a keyword: adding it to keywordTable would rename
// every existing binding called `on`. Matching it by value here costs one
// comparison and keeps the word available everywhere else, the same way the
// retired `next <action> if <cond>` form is recognised in parseNextSugar.
func (p *parser) atNextMatch() bool {
	if p.peek().Kind != lexer.TokIdent || p.peek().Value != "on" {
		return false
	}
	switch p.peekAt(1).Kind {
	case lexer.TokLParen:
		return true
	case lexer.TokIdent:
		// `next on foo match { ... }` — a single bare subject.
		return p.peekAt(2).Kind == lexer.TokKwMatch
	}
	return false
}

func (p *parser) parseNextMatchBlock(pos ast.Pos) []*ast.NextRule {
	p.advance() // consume `on`

	subjects := p.parseNextMatchSubjects()
	if _, ok := p.expect(lexer.TokKwMatch); !ok {
		p.syncToBlockItem(lexer.TokKwNext, lexer.TokKwAction, lexer.TokRBrace)
		return nil
	}
	if _, ok := p.expect(lexer.TokLBrace); !ok {
		p.syncToBlockItem(lexer.TokKwNext, lexer.TokKwAction, lexer.TokRBrace)
		return nil
	}

	// A subject list that failed to parse has no width to check arms against,
	// so arity checking is switched off rather than reporting every arm.
	arity := len(subjects)
	if arity == 0 {
		arity = -1
	}

	var arms []matchArm
	for p.peek().Kind != lexer.TokRBrace && p.peek().Kind != lexer.TokEOF {
		arm, ok := p.parseNextMatchArm(arity)
		if ok {
			arms = append(arms, arm)
		}
		if p.peek().Kind == lexer.TokComma {
			p.advance()
		}
	}
	p.expect(lexer.TokRBrace)

	if len(subjects) == 0 || len(arms) == 0 {
		return nil
	}
	return p.expandMatchArms(pos, subjects, arms)
}

// parseNextMatchSubjects parses `foo` or `(foo, bar, baz)`.
func (p *parser) parseNextMatchSubjects() []matchSubject {
	if p.peek().Kind != lexer.TokLParen {
		s, ok := p.parseNextMatchSubject()
		if !ok {
			return nil
		}
		return []matchSubject{s}
	}
	p.advance() // consume '('

	var subjects []matchSubject
	seen := map[string]bool{}
	for p.peek().Kind != lexer.TokRParen && p.peek().Kind != lexer.TokEOF {
		if s, ok := p.parseNextMatchSubject(); ok {
			// A repeat would expand to two bindings of the same name in one
			// generated prog. That is caught downstream, but by then the message
			// names a compiler-generated prog and carries no position; here it
			// can point at the repeated subject.
			if seen[s.Name] {
				p.Append(diag.ErrorAt(p.file, s.Pos.Line, s.Pos.Col, diag.CodeDuplicateBinding,
					"match subject %q is listed twice; each subject matches one column", s.Name))
			}
			// The repeat is kept in the list even after reporting, so the arms
			// are still checked against the width the author wrote rather than
			// every one of them reporting a bogus arity error too.
			seen[s.Name] = true
			subjects = append(subjects, s)
		}
		if p.peek().Kind != lexer.TokComma {
			break
		}
		p.advance()
	}
	p.expect(lexer.TokRParen)
	return subjects
}

func (p *parser) parseNextMatchSubject() (matchSubject, bool) {
	t := p.peek()
	if t.Kind != lexer.TokIdent {
		p.errorf(t, "expected a binding name in the match subject list, got %s %q", kindName(t.Kind), t.Value)
		return matchSubject{}, false
	}
	subPos := p.posOf(t)
	name := p.parseRefVal()
	// Same restriction the `next <cond> -> <action>` sugar carries: a subject is
	// resolved with from_action against this action's prog, which has no dotted
	// names in it.
	if strings.Contains(name, ".") {
		p.Append(diag.ErrorAt(p.file, subPos.Line, subPos.Col, diag.CodeNextComputeInvalid,
			"match subject %q must be a bare binding of this action's compute prog; "+
				"richer conditions need the next { } block form", name))
		return matchSubject{}, false
	}
	return matchSubject{Pos: subPos, Name: name}, true
}

// parseNextMatchArm parses one `<pattern> => <action>` row. arity is the subject
// count, against which every arm is checked; it is negative when the subject
// list itself failed to parse, which suppresses a cascade of arity errors that
// would bury the real one.
func (p *parser) parseNextMatchArm(arity int) (matchArm, bool) {
	armPos := p.posOf(p.peek())
	pattern := p.parseCasePattern()

	arm := matchArm{Pos: armPos}
	if _, ok := pattern.(*ast.WildcardCasePattern); ok {
		arm.Uncond = true
	} else {
		// A scalar pattern is a 1-tuple, so a one-subject list can be written
		// `"yes" => act` as well as `("yes") => act`.
		sub := []ast.LocalCasePattern{pattern}
		if tuple, ok := pattern.(*ast.TupleCasePattern); ok {
			sub = tuple.Elems
		}
		// Element kinds are narrowed before arity, so an arm written with a
		// binder or a guard is told what is unsupported rather than being
		// counted as one element and reported as the wrong width.
		elems, ok := p.nextMatchElems(sub)
		if !ok {
			p.skipTo(lexer.TokComma, lexer.TokRBrace)
			return matchArm{}, false
		}
		if arity >= 0 && len(elems) != arity {
			p.Append(diag.ErrorAt(p.file, armPos.Line, armPos.Col, diag.CodeNextMatchArity,
				"match arm has %d pattern element(s) but the subject list has %d",
				len(elems), arity))
			p.skipTo(lexer.TokComma, lexer.TokRBrace)
			return matchArm{}, false
		}
		arm.Elems = elems
	}

	// An all-wildcard tuple constrains nothing, so it is the same rule as the
	// bare `_` fallback and is held to the same placement rules.
	if !arm.Uncond && !anyConstrained(arm.Elems) {
		arm.Uncond = true
		arm.Elems = nil
	}

	// `parseCaseArm` would accept a guard here; guards are parsed explicitly so
	// the arm reports what is unsupported instead of an unexpected token.
	if t := p.peek(); t.Kind == lexer.TokIdent && t.Value == "if" {
		p.Append(diag.ErrorAt(p.file, t.Line, t.Col, diag.CodeUnsupportedConstruct,
			"guards are not supported in a next match block; use the next { } block form"))
		p.skipTo(lexer.TokArrow, lexer.TokComma, lexer.TokRBrace)
	}

	if _, ok := p.expect(lexer.TokArrow); !ok {
		p.skipTo(lexer.TokComma, lexer.TokRBrace)
		return matchArm{}, false
	}
	arm.ActionID = p.parseRefVal()
	if arm.ActionID == "" {
		return matchArm{}, false
	}
	return arm, true
}

// nextMatchElems narrows case patterns to the literal / wildcard subset a
// transition can express. A binder has nothing to bind to — the arm body is an
// action id, not an expression — and a template pattern would pull the
// template-matching lowering path into a transition prog.
func (p *parser) nextMatchElems(patterns []ast.LocalCasePattern) ([]matchElem, bool) {
	elems := make([]matchElem, len(patterns))
	for i, pat := range patterns {
		switch x := pat.(type) {
		case *ast.WildcardCasePattern:
			elems[i] = matchElem{Pos: x.Pos}
		case *ast.LiteralCasePattern:
			elems[i] = matchElem{Pos: x.Pos, Lit: x.Value}
		case *ast.VarBinderPattern:
			p.Append(diag.ErrorAt(p.file, x.Pos.Line, x.Pos.Col, diag.CodeUnsupportedConstruct,
				"match element %q: a next match arm accepts only literals and `_`; "+
					"variable binders need the next { } block form", x.Name))
			return nil, false
		case *ast.TupleCasePattern:
			// A tuple nested inside a tuple: the subject list is flat, so there
			// is nothing for the inner arity to line up against.
			p.Append(diag.ErrorAt(p.file, x.Pos.Line, x.Pos.Col, diag.CodeUnsupportedConstruct,
				"nested tuple patterns are not supported in a next match block; "+
					"the subject list is flat"))
			return nil, false
		case *ast.TemplateCasePattern:
			p.Append(diag.ErrorAt(p.file, x.Pos.Line, x.Pos.Col, diag.CodeUnsupportedConstruct,
				"template pattern %q: a next match arm accepts only literals and `_`; "+
					"template matching needs the next { } block form", x.TypeName))
			return nil, false
		default:
			p.errorf(p.peek(), "unsupported pattern in next match arm")
			return nil, false
		}
	}
	return elems, true
}

func anyConstrained(elems []matchElem) bool {
	for _, e := range elems {
		if e.Lit != nil {
			return true
		}
	}
	return false
}

// expandMatchArms turns the parsed arms into next rules in arm order, which is
// evaluation order under first-match.
func (p *parser) expandMatchArms(pos ast.Pos, subjects []matchSubject, arms []matchArm) []*ast.NextRule {
	colTypes := p.nextMatchColumnTypes(subjects, arms)
	p.checkArmPlacement(pos, arms)

	rules := make([]*ast.NextRule, 0, len(arms))
	for i, arm := range arms {
		rule := &ast.NextRule{
			Pos:      arm.Pos,
			ActionID: arm.ActionID,
		}
		if !arm.Uncond {
			p.buildMatchRule(rule, i, subjects, colTypes, arm)
		}
		rules = append(rules, rule)
	}
	return rules
}

// nextMatchColumnTypes infers each subject's field type from the literals written
// in its column. A column left wildcard in every arm has no type and generates
// no binding, so it never reaches a rule.
func (p *parser) nextMatchColumnTypes(subjects []matchSubject, arms []matchArm) []ast.FieldType {
	types := make([]ast.FieldType, len(subjects))
	for col := range subjects {
		types[col] = ast.FieldTypeInvalid
		for _, arm := range arms {
			if col >= len(arm.Elems) || arm.Elems[col].Lit == nil {
				continue
			}
			elem := arm.Elems[col]
			ft, ok := ast.LiteralFieldType(elem.Lit)
			if !ok {
				p.Append(diag.ErrorAt(p.file, elem.Pos.Line, elem.Pos.Col, diag.CodeArgTypeMismatch,
					"match subject %q: pattern literal has no inferable type", subjects[col].Name))
				continue
			}
			if types[col] == ast.FieldTypeInvalid {
				types[col] = ft
				continue
			}
			if types[col] != ft {
				p.Append(diag.ErrorAt(p.file, elem.Pos.Line, elem.Pos.Col, diag.CodeArgTypeMismatch,
					"match subject %q: pattern literal has type %s but an earlier arm matches it as %s",
					subjects[col].Name, ft, types[col]))
			}
		}
	}
	return types
}

// checkArmPlacement enforces the ordering the expansion depends on: exactly one
// unconditional arm, and nothing after it. Without one the block can fall
// through to no transition at all, which the model reads as the scene reaching
// terminal state — a silent outcome for an explicitly written match.
func (p *parser) checkArmPlacement(pos ast.Pos, arms []matchArm) {
	uncond := -1
	for i, arm := range arms {
		switch {
		case !arm.Uncond:
			if uncond >= 0 {
				p.Append(diag.ErrorAt(p.file, arm.Pos.Line, arm.Pos.Col, diag.CodeUnreachableArm,
					"unreachable match arm; the `_` arm above it already matches everything"))
			}
		case uncond >= 0:
			p.Append(diag.ErrorAt(p.file, arm.Pos.Line, arm.Pos.Col, diag.CodeDuplicateFallback,
				"duplicate `_` arm; a next match block takes at most one"))
		default:
			uncond = i
		}
	}
	if uncond < 0 {
		p.Append(diag.ErrorAt(p.file, pos.Line, pos.Col, diag.CodeNonExhaustiveMatch,
			"next match block has no `_` arm; add one so every case selects a transition"))
	}
}

// buildMatchRule fills in the compute and prepare blocks for one constrained
// arm. Only the subjects this arm actually constrains are ingressed, so a `_`
// column costs nothing in the emitted prog.
func (p *parser) buildMatchRule(rule *ast.NextRule, armIdx int, subjects []matchSubject, colTypes []ast.FieldType, arm matchArm) {
	var bindings []*ast.BindingDecl
	var entries []*ast.NextPrepareEntry
	var cond ast.InfixNode

	for col, elem := range arm.Elems {
		if elem.Lit == nil {
			continue
		}
		subject := subjects[col]
		bindings = append(bindings, &ast.BindingDecl{
			Pos:   arm.Pos,
			Sigil: ast.SigilIngress,
			Name:  subject.Name,
			Type:  colTypes[col],
			RHS:   &ast.SigilInputRHS{},
		})
		entries = append(entries, &ast.NextPrepareEntry{
			Pos:         arm.Pos,
			BindingName: subject.Name,
			Source:      &ast.FromAction{Pos: arm.Pos, BindingName: subject.Name},
		})
		eq := &ast.InfixBranch{
			Pos: elem.Pos,
			Op:  ast.InfixEq,
			LHS: &ast.InfixLeaf{Arg: &ast.RefArg{Name: subject.Name}},
			RHS: &ast.InfixLeaf{Arg: &ast.LitArg{Value: elem.Lit}},
		}
		if cond == nil {
			cond = eq
			continue
		}
		cond = &ast.InfixBranch{Pos: arm.Pos, Op: ast.InfixAnd, LHS: cond, RHS: eq}
	}

	// The arm index, not a fixed 0, keeps two arms that target the same action
	// from generating the same prog and condition names.
	goName := names.LocalName(arm.ActionID, "go", armIdx)
	root := cond.(*ast.InfixBranch)

	// A single equality is what the expression parser would normalise to
	// InfixRHS, so the one-column case emits exactly what a hand-written rule
	// emits. Building the tree directly also settles operator precedence by
	// construction: the `&` nodes sit above the `==` nodes by shape.
	var rhs ast.BindingRHS
	if root.Op == ast.InfixEq {
		rhs = &ast.InfixRHS{Op: root.Op, LHS: root.LHS.(*ast.InfixLeaf).Arg, RHS: root.RHS.(*ast.InfixLeaf).Arg}
	} else {
		rhs = &ast.NestedInfixRHS{Pos: arm.Pos, Root: root}
	}

	bindings = append(bindings, &ast.BindingDecl{
		Pos:    arm.Pos,
		Marker: ast.MarkerCond,
		Name:   goName,
		Type:   ast.FieldTypeBool,
		RHS:    rhs,
	})

	rule.Compute = &ast.NextComputeBlock{
		Pos:       arm.Pos,
		Condition: goName,
		Prog: &ast.ProgBlock{
			Pos:      arm.Pos,
			Name:     names.LocalName(arm.ActionID, "match", armIdx),
			Bindings: bindings,
		},
	}
	rule.Prepare = &ast.NextPrepareBlock{Pos: arm.Pos, Entries: entries}
}
