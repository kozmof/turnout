package parser_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// ─── helpers ─────────────────────────────────────────────────────────────────

// matchScene wraps a next block in an action whose prog declares the three
// bindings the match subjects resolve against.
func matchScene(nextBlock string) string {
	return `state {
  routing {
    tier:str = ""
    region:str = ""
    urgent:bool = false
  }
}
scene "s" {
  entry_action = classify
  next_policy  = "first-match"

  action "classify" {
    compute "classify_graph" {
      tier:str <~ @routing.tier
      region:str <~ @routing.region
      urgent:bool <~ @routing.urgent
      ready:bool := true
    }

` + nextBlock + `
  }

  action "escalate" { compute "e" { done:bool := true } }
  action "review"   { compute "r" { done:bool := true } }
  action "archive"  { compute "a" { done:bool := true } }
}
`
}

// matchRulesOf parses a scene and returns the first action's expanded next
// rules. It is separate from nextRulesOf because the match subjects have to
// resolve against real bindings in the action's prog.
func matchRulesOf(t *testing.T, nextBlock string) []*ast.NextRule {
	t.Helper()
	tf := mustParse(t, matchScene(nextBlock))
	return tf.Scenes[0].Actions[0].Next
}

// matchBindingNames returns the declared binding names of a transition prog.
func matchBindingNames(prog *ast.ProgBlock) []string {
	names := make([]string, 0, len(prog.Bindings))
	for _, b := range prog.Bindings {
		names = append(names, b.Name)
	}
	return names
}

// ─── expansion ───────────────────────────────────────────────────────────────

// TestNextMatchExpandsOneRulePerArm pins the core contract: a match block is
// surface sugar that produces exactly the next rules an author would write by
// hand, in arm order, which is evaluation order under first-match.
func TestNextMatchExpandsOneRulePerArm(t *testing.T) {
	rules := matchRulesOf(t, `    next on (tier, region, urgent) match {
      ("gold", "eu", true) => escalate,
      ("gold", _, false)   => review,
      _ => archive
    }`)

	if len(rules) != 3 {
		t.Fatalf("rules = %d, want 3", len(rules))
	}
	for i, want := range []string{"escalate", "review", "archive"} {
		if rules[i].ActionID != want {
			t.Errorf("rules[%d].ActionID = %q, want %q", i, rules[i].ActionID, want)
		}
		if !rules[i].FromMatch {
			t.Errorf("rules[%d].FromMatch = false, want true", i)
		}
	}

	// Arm 0 constrains all three subjects.
	c0 := rules[0].Compute
	if c0 == nil {
		t.Fatal("rules[0].Compute is nil")
	}
	if got, want := c0.Prog.Name, "__local_escalate_match_0"; got != want {
		t.Errorf("prog name = %q, want %q", got, want)
	}
	if got, want := c0.Condition, "__local_escalate_go_0"; got != want {
		t.Errorf("condition = %q, want %q", got, want)
	}
	wantBindings := []string{"tier", "region", "urgent", "__local_escalate_go_0"}
	got := matchBindingNames(c0.Prog)
	if len(got) != len(wantBindings) {
		t.Fatalf("bindings = %v, want %v", got, wantBindings)
	}
	for i := range wantBindings {
		if got[i] != wantBindings[i] {
			t.Errorf("bindings[%d] = %q, want %q", i, got[i], wantBindings[i])
		}
	}

	// Ingress bindings carry the sigil and input RHS the block form produces,
	// and their types come from the literals in each column.
	wantTypes := []ast.FieldType{ast.FieldTypeStr, ast.FieldTypeStr, ast.FieldTypeBool}
	for i, b := range c0.Prog.Bindings[:3] {
		if b.Sigil != ast.SigilIngress {
			t.Errorf("binding %q: sigil = %v, want SigilIngress", b.Name, b.Sigil)
		}
		if _, ok := b.RHS.(*ast.SigilInputRHS); !ok {
			t.Errorf("binding %q: RHS = %T, want *ast.SigilInputRHS", b.Name, b.RHS)
		}
		if b.Type != wantTypes[i] {
			t.Errorf("binding %q: type = %v, want %v", b.Name, b.Type, wantTypes[i])
		}
	}

	// The condition binding carries the `:=` marker and is bool.
	cond := c0.Prog.Bindings[3]
	if cond.Marker != ast.MarkerCond {
		t.Errorf("condition marker = %v, want MarkerCond", cond.Marker)
	}
	if cond.Type != ast.FieldTypeBool {
		t.Errorf("condition type = %v, want bool", cond.Type)
	}

	// Every ingressed subject gets a matching from_action prepare entry.
	if rules[0].Prepare == nil || len(rules[0].Prepare.Entries) != 3 {
		t.Fatalf("prepare entries = %v, want 3", rules[0].Prepare)
	}
	for i, e := range rules[0].Prepare.Entries {
		src, ok := e.Source.(*ast.FromAction)
		if !ok {
			t.Fatalf("entry[%d].Source = %T, want *ast.FromAction", i, e.Source)
		}
		if src.BindingName != e.BindingName {
			t.Errorf("entry[%d]: from_action %q does not match binding %q", i, src.BindingName, e.BindingName)
		}
	}
}

// TestNextMatchWildcardColumnIsNotIngressed covers the sparse arm: a `_` column
// constrains nothing, so it costs no binding, no prepare entry, and no term in
// the condition.
func TestNextMatchWildcardColumnIsNotIngressed(t *testing.T) {
	rules := matchRulesOf(t, `    next on (tier, region, urgent) match {
      ("gold", _, false) => review,
      _ => archive
    }`)

	prog := rules[0].Compute.Prog
	want := []string{"tier", "urgent", "__local_review_go_0"}
	got := matchBindingNames(prog)
	if len(got) != len(want) {
		t.Fatalf("bindings = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("bindings[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	if len(rules[0].Prepare.Entries) != 2 {
		t.Errorf("prepare entries = %d, want 2", len(rules[0].Prepare.Entries))
	}
}

// TestNextMatchFallbackIsUnconditional covers the `_` arm: it abbreviates the
// bare `next <action>` rule, which carries no compute at all.
func TestNextMatchFallbackIsUnconditional(t *testing.T) {
	rules := matchRulesOf(t, `    next on tier match {
      "gold" => escalate,
      _ => archive
    }`)

	last := rules[len(rules)-1]
	if last.ActionID != "archive" {
		t.Fatalf("last rule targets %q, want archive", last.ActionID)
	}
	if last.Compute != nil {
		t.Errorf("fallback rule has a compute block; want an unconditional rule")
	}
	if last.Prepare != nil {
		t.Errorf("fallback rule has a prepare block; want an unconditional rule")
	}
}

// TestNextMatchAllWildcardTupleIsFallback covers `(_, _)`: it constrains
// nothing, so it is the same rule as a bare `_` and is held to the same
// placement rules.
func TestNextMatchAllWildcardTupleIsFallback(t *testing.T) {
	rules := matchRulesOf(t, `    next on (tier, region) match {
      ("gold", "eu") => escalate,
      (_, _) => archive
    }`)

	if len(rules) != 2 {
		t.Fatalf("rules = %d, want 2", len(rules))
	}
	if rules[1].Compute != nil {
		t.Errorf("all-wildcard arm produced a compute block; want an unconditional rule")
	}
}

// TestNextMatchSingleColumnNormalizesToInfixRHS covers the normalization the
// expression parser performs for a one-operator expression: a single constrained
// column must emit InfixRHS, not a one-branch NestedInfixRHS, so a match arm and
// a hand-written rule lower through the same path.
func TestNextMatchSingleColumnNormalizesToInfixRHS(t *testing.T) {
	rules := matchRulesOf(t, `    next on tier match {
      "gold" => escalate,
      _ => archive
    }`)

	prog := rules[0].Compute.Prog
	cond := prog.Bindings[len(prog.Bindings)-1]
	infix, ok := cond.RHS.(*ast.InfixRHS)
	if !ok {
		t.Fatalf("condition RHS = %T, want *ast.InfixRHS", cond.RHS)
	}
	if infix.Op != ast.InfixEq {
		t.Errorf("op = %v, want InfixEq", infix.Op)
	}
	if ref, ok := infix.LHS.(*ast.RefArg); !ok || ref.Name != "tier" {
		t.Errorf("LHS = %#v, want RefArg{tier}", infix.LHS)
	}
	if _, ok := infix.RHS.(*ast.LitArg); !ok {
		t.Errorf("RHS = %T, want *ast.LitArg", infix.RHS)
	}
}

// TestNextMatchMultiColumnBuildsAndOverEq covers the condition shape for a
// multi-column arm. The tree is constructed rather than parsed, so `&` sits
// above `==` by shape and the comparison-vs-and precedence question never
// arises.
func TestNextMatchMultiColumnBuildsAndOverEq(t *testing.T) {
	rules := matchRulesOf(t, `    next on (tier, region, urgent) match {
      ("gold", "eu", true) => escalate,
      _ => archive
    }`)

	prog := rules[0].Compute.Prog
	cond := prog.Bindings[len(prog.Bindings)-1]
	nested, ok := cond.RHS.(*ast.NestedInfixRHS)
	if !ok {
		t.Fatalf("condition RHS = %T, want *ast.NestedInfixRHS", cond.RHS)
	}
	// ((tier == "gold" & region == "eu") & urgent == true)
	if nested.Root.Op != ast.InfixAnd {
		t.Fatalf("root op = %v, want InfixAnd", nested.Root.Op)
	}
	right, ok := nested.Root.RHS.(*ast.InfixBranch)
	if !ok || right.Op != ast.InfixEq {
		t.Errorf("root RHS = %#v, want an InfixEq branch", nested.Root.RHS)
	}
	left, ok := nested.Root.LHS.(*ast.InfixBranch)
	if !ok || left.Op != ast.InfixAnd {
		t.Fatalf("root LHS = %#v, want an InfixAnd branch", nested.Root.LHS)
	}
	for _, leaf := range []ast.InfixNode{left.LHS, left.RHS} {
		if b, ok := leaf.(*ast.InfixBranch); !ok || b.Op != ast.InfixEq {
			t.Errorf("leaf = %#v, want an InfixEq branch", leaf)
		}
	}
}

// TestNextMatchScalarPatternAgainstOneSubject covers the 1-tuple normalization:
// with a single subject, `"gold" =>` and `("gold") =>` mean the same thing, and
// the subject list may be written with or without parentheses.
func TestNextMatchScalarPatternAgainstOneSubject(t *testing.T) {
	for name, block := range map[string]string{
		"bare subject, scalar pattern": `    next on tier match {
      "gold" => escalate,
      _ => archive
    }`,
		"paren subject, tuple pattern": `    next on (tier) match {
      ("gold") => escalate,
      _ => archive
    }`,
		"bare subject, tuple pattern": `    next on tier match {
      ("gold") => escalate,
      _ => archive
    }`,
	} {
		t.Run(name, func(t *testing.T) {
			rules := matchRulesOf(t, block)
			if len(rules) != 2 {
				t.Fatalf("rules = %d, want 2", len(rules))
			}
			if rules[0].Compute == nil || len(rules[0].Compute.Prog.Bindings) != 2 {
				t.Fatalf("arm 0 prog = %v, want one ingress plus one condition", rules[0].Compute)
			}
		})
	}
}

// TestNextMatchRepeatedTargetGetsDistinctNames covers two arms selecting the
// same action: the generated prog and condition names are keyed by arm index,
// so they cannot collide.
func TestNextMatchRepeatedTargetGetsDistinctNames(t *testing.T) {
	rules := matchRulesOf(t, `    next on (tier, region) match {
      ("gold", "eu") => escalate,
      ("gold", "us") => escalate,
      _ => archive
    }`)

	a, b := rules[0].Compute, rules[1].Compute
	if a.Prog.Name == b.Prog.Name {
		t.Errorf("both arms generated prog %q", a.Prog.Name)
	}
	if a.Condition == b.Condition {
		t.Errorf("both arms generated condition %q", a.Condition)
	}
}

// TestNextMatchTrailingComma covers the optional comma after the last arm.
func TestNextMatchTrailingComma(t *testing.T) {
	rules := matchRulesOf(t, `    next on tier match {
      "gold" => escalate,
      _ => archive,
    }`)
	if len(rules) != 2 {
		t.Fatalf("rules = %d, want 2", len(rules))
	}
}

// ─── diagnostics ─────────────────────────────────────────────────────────────

func TestNextMatchDiagnostics(t *testing.T) {
	tests := []struct {
		name  string
		block string
		want  diag.ErrorCode
	}{
		{
			name: "arm wider than the subject list",
			block: `    next on (tier, region) match {
      ("gold", "eu", true) => escalate,
      _ => archive
    }`,
			want: diag.CodeNextMatchArity,
		},
		{
			name: "arm narrower than the subject list",
			block: `    next on (tier, region) match {
      "gold" => escalate,
      _ => archive
    }`,
			want: diag.CodeNextMatchArity,
		},
		{
			name: "variable binder",
			block: `    next on tier match {
      x => escalate,
      _ => archive
    }`,
			want: diag.CodeUnsupportedConstruct,
		},
		{
			name: "nested tuple pattern",
			block: `    next on (tier, region) match {
      ("gold", ("eu", "us")) => escalate,
      _ => archive
    }`,
			want: diag.CodeUnsupportedConstruct,
		},
		{
			name: "template pattern",
			block: `    next on tier match {
      Sku { region: "eu" } => escalate,
      _ => archive
    }`,
			want: diag.CodeUnsupportedConstruct,
		},
		{
			name: "guard",
			block: `    next on (tier, region) match {
      ("gold", "eu") if urgent => escalate,
      _ => archive
    }`,
			want: diag.CodeUnsupportedConstruct,
		},
		{
			name: "column literals disagree on type",
			block: `    next on tier match {
      "gold" => escalate,
      3 => review,
      _ => archive
    }`,
			want: diag.CodeArgTypeMismatch,
		},
		{
			name: "no fallback arm",
			block: `    next on tier match {
      "gold" => escalate
    }`,
			want: diag.CodeNonExhaustiveMatch,
		},
		{
			name: "two fallback arms",
			block: `    next on tier match {
      "gold" => escalate,
      _ => archive,
      _ => review
    }`,
			want: diag.CodeDuplicateFallback,
		},
		{
			name: "arm after the fallback",
			block: `    next on tier match {
      _ => archive,
      "gold" => escalate
    }`,
			want: diag.CodeUnreachableArm,
		},
		{
			name: "repeated subject",
			block: `    next on (tier, tier) match {
      ("gold", "silver") => escalate,
      _ => archive
    }`,
			want: diag.CodeDuplicateBinding,
		},
		{
			name: "dotted subject",
			block: `    next on (routing.tier) match {
      "gold" => escalate,
      _ => archive
    }`,
			want: diag.CodeNextComputeInvalid,
		},
		{
			name: "subject is not a name",
			block: `    next on ("tier") match {
      "gold" => escalate,
      _ => archive
    }`,
			want: diag.CodeParseSyntaxError,
		},
		{
			name: "missing arrow",
			block: `    next on tier match {
      "gold" escalate,
      _ => archive
    }`,
			want: diag.CodeParseSyntaxError,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			codes := codesFor(t, matchScene(tc.block))
			if !hasErrorCode(codes, tc.want) {
				t.Errorf("codes = %v, want one of them to be %s", codes, tc.want)
			}
		})
	}
}

// TestNextMatchRequiresFirstMatch covers the policy check. Arm order is what
// makes arms exclusive; under all-match the `_` arm fires alongside whichever
// arm matched, so the combination is rejected.
func TestNextMatchRequiresFirstMatch(t *testing.T) {
	src := `state {
  routing { tier:str = "" }
}
scene "s" {
  entry_action = classify
  next_policy  = "all-match"

  action "classify" {
    compute "c" {
      tier:str <~ @routing.tier
      ready:bool := true
    }

    next on tier match {
      "gold" => escalate,
      _ => archive
    }
  }

  action "escalate" { compute "e" { done:bool := true } }
  action "archive"  { compute "a" { done:bool := true } }
}
`
	codes := codesFor(t, src)
	if !hasErrorCode(codes, diag.CodeNextMatchPolicy) {
		t.Errorf("codes = %v, want NextMatchPolicy", codes)
	}

	// One diagnostic per match block, not one per expanded rule.
	n := 0
	for _, c := range codes {
		if c == diag.CodeNextMatchPolicy {
			n++
		}
	}
	if n != 1 {
		t.Errorf("NextMatchPolicy reported %d times, want 1", n)
	}
}

// TestNextMatchPolicyDeclaredAfterAction covers the ordering the check was
// placed at scene level for: `next_policy` may be written below the action that
// uses the match block, so the check cannot run at expansion time.
func TestNextMatchPolicyDeclaredAfterAction(t *testing.T) {
	src := `state {
  routing { tier:str = "" }
}
scene "s" {
  entry_action = classify

  action "classify" {
    compute "c" {
      tier:str <~ @routing.tier
      ready:bool := true
    }

    next on tier match {
      "gold" => escalate,
      _ => archive
    }
  }

  action "escalate" { compute "e" { done:bool := true } }
  action "archive"  { compute "a" { done:bool := true } }

  next_policy = "all-match"
}
`
	if !hasErrorCode(codesFor(t, src), diag.CodeNextMatchPolicy) {
		t.Error("a match block was accepted in an all-match scene declaring its policy last")
	}
}

// ─── regressions ─────────────────────────────────────────────────────────────

// TestNextMatchLeavesOtherFormsAlone pins that the three existing spellings
// still parse to exactly one rule each now that parseNextBlock returns a slice.
func TestNextMatchLeavesOtherFormsAlone(t *testing.T) {
	tests := map[string]string{
		"bare sugar":    `    next archive`,
		"guarded sugar": `    next ready -> archive`,
		"block form":    `    next { compute "t" { go:bool := true } action = archive }`,
	}
	for name, block := range tests {
		t.Run(name, func(t *testing.T) {
			rules := matchRulesOf(t, block)
			if len(rules) != 1 {
				t.Fatalf("rules = %d, want 1", len(rules))
			}
			if rules[0].FromMatch {
				t.Error("FromMatch = true, want false for a non-match form")
			}
			if rules[0].ActionID != "archive" {
				t.Errorf("ActionID = %q, want archive", rules[0].ActionID)
			}
		})
	}
}

// TestOnIsNotReserved covers the contextual keyword decision: `on` stays an
// ordinary identifier, so a binding may still be named it.
func TestOnIsNotReserved(t *testing.T) {
	src := `state {
  routing { on:bool = false }
}
scene "s" {
  entry_action = classify

  action "classify" {
    compute "c" {
      on:bool <~ @routing.on
      ready:bool := on
    }

    next on -> archive
    next archive
  }

  action "archive" { compute "a" { done:bool := true } }
}
`
	tf := mustParse(t, src)
	rules := tf.Scenes[0].Actions[0].Next
	if len(rules) != 2 {
		t.Fatalf("rules = %d, want 2", len(rules))
	}
	if rules[0].Compute == nil {
		t.Fatal("`next on -> archive` did not parse as the guarded sugar form")
	}
}
