package parser_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/names"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
)

// codesFor parses src and returns the diagnostic codes it produced.
func codesFor(t *testing.T, src string) []diag.ErrorCode {
	t.Helper()
	_, ds := parser.ParseFile("test.tu", src)
	codes := make([]diag.ErrorCode, 0, len(ds))
	for _, d := range ds {
		codes = append(codes, d.Code)
	}
	return codes
}

func hasErrorCode(codes []diag.ErrorCode, want diag.ErrorCode) bool {
	for _, c := range codes {
		if c == want {
			return true
		}
	}
	return false
}

// actionCompute wraps binding declarations in an action-level compute block.
func actionCompute(body string) string {
	return minimalTurnFile(`  action "a" {
    compute "p" {
` + body + `
    }
  }`)
}

// nextCompute wraps binding declarations in a transition compute block.
func nextCompute(body string) string {
	return minimalTurnFile(`  action "a" {
    compute "p" { v:bool := true }
    next {
      compute "n" {
` + body + `
      }
      action = b
    }
  }
  action "b" {
    compute "q" { v:bool := true }
  }`)
}

// TestInlineIngressSourcesByContext is the context table from NEW_SYNTAX.md 3.
// The four ingress sources are not interchangeable — the wire model has disjoint
// field sets for action and transition prepare entries — so each is accepted
// only where it is representable, and rejected at its own token elsewhere.
func TestInlineIngressSourcesByContext(t *testing.T) {
	tests := []struct {
		name    string
		src     string
		wantErr diag.ErrorCode // "" means it must parse cleanly
	}{
		{"state path in action", actionCompute(`        x:number := <~ @ns.val`), ""},
		{"hook in action", actionCompute(`        x:number := <~ hook("feed")`), ""},
		{"literal in action", actionCompute(`        x:number := <~ 300`), diag.CodeParseSyntaxError},
		{"action() in action", actionCompute(`        x:number := <~ action(other)`), diag.CodeParseSyntaxError},

		{"state path in next", nextCompute(`          x:bool := <~ @ns.flag`), ""},
		{"action() in next", nextCompute(`          x:bool := <~ action(v)`), ""},
		{"literal in next", nextCompute(`          x:bool := <~ true`), ""},
		{"hook in next", nextCompute(`          x:bool := <~ hook("feed")`), diag.CodeTransitionHook},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			codes := codesFor(t, tc.src)
			if tc.wantErr == "" {
				if len(codes) != 0 {
					t.Errorf("expected a clean parse, got %v", codes)
				}
				return
			}
			if !hasErrorCode(codes, tc.wantErr) {
				t.Errorf("got %v, want %s", codes, tc.wantErr)
			}
		})
	}
}

// TestInlineEgressRequiresStatePath covers the `~>` error branch: the arrow
// points at a destination, and the only destination is a state path.
func TestInlineEgressRequiresStatePath(t *testing.T) {
	codes := codesFor(t, actionCompute(`        x:number := (1) ~> notapath`))
	if !hasErrorCode(codes, diag.CodeParseSyntaxError) {
		t.Errorf("got %v, want a syntax error", codes)
	}
}

func TestComputedEgressRequiresParenthesizedRHS(t *testing.T) {
	if codes := codesFor(t, actionCompute(`        x:number := 1 ~> @ns.val`)); !hasErrorCode(codes, diag.CodeParseSyntaxError) {
		t.Errorf("unparenthesized egress: got %v, want ParseSyntaxError", codes)
	}
	tf := mustParse(t, actionCompute(`        x:number := (left + right) ~> @ns.val`))
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	if b.Egress == nil || b.Egress.Path != "ns.val" {
		t.Fatalf("egress = %v, want ns.val", b.Egress)
	}
	if _, ok := b.RHS.(*ast.InfixRHS); !ok {
		t.Fatalf("RHS = %T, want *ast.InfixRHS", b.RHS)
	}
}

func TestTopLevelParenthesesAreEgressOnly(t *testing.T) {
	codes := codesFor(t, actionCompute(`        x:number := (1)`))
	if !hasErrorCode(codes, diag.CodeParseSyntaxError) {
		t.Errorf("got %v, want ParseSyntaxError", codes)
	}
}

func TestAnonymousEgressParses(t *testing.T) {
	tf := mustParse(t, actionCompute(`        (left + right) ~> @ns.val
        done:bool := true`))
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	if !b.Anonymous || b.Name != "" || b.Type != ast.FieldTypeInvalid {
		t.Fatalf("anonymous binding = %#v", b)
	}
	if b.Egress == nil || b.Egress.Path != "ns.val" {
		t.Fatalf("egress = %v, want ns.val", b.Egress)
	}
}

// TestInlineIOBothArrows covers the form that replaces the retired `<~>`: both
// directions on one line, each naming its own path.
func TestInlineIOBothArrows(t *testing.T) {
	tf := mustParse(t, actionCompute(`        priority:number := <~ @ns.val ~> @ns.snapshot`))
	b := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0]
	if b.Sigil != ast.SigilBiDir {
		t.Errorf("sigil = %v, want bidirectional", b.Sigil)
	}
	in, ok := b.Ingress.(*ast.IngressState)
	if !ok || in.Path != "ns.val" {
		t.Errorf("ingress = %v, want @ns.val", b.Ingress)
	}
	if b.Egress == nil || b.Egress.Path != "ns.snapshot" {
		t.Errorf("egress = %v, want @ns.snapshot", b.Egress)
	}
}

// TestInlineIngressRejectsRHS covers the conflict between a `<~` source and an
// explicit right-hand side: the binding cannot have two definitions.
func TestInlineIngressRejectsRHS(t *testing.T) {
	codes := codesFor(t, actionCompute(`        x:number := <~ @ns.val = 5`))
	if !hasErrorCode(codes, diag.CodeParseSyntaxError) {
		t.Errorf("got %v, want a syntax error", codes)
	}
}

// TestStatePathSegments covers multi-segment and malformed paths.
func TestStatePathSegments(t *testing.T) {
	tf := mustParse(t, actionCompute(`        x:number := <~ @ns.val`))
	in := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0].Ingress.(*ast.IngressState)
	if in.Path != "ns.val" {
		t.Errorf("path = %q, want ns.val", in.Path)
	}
	if codes := codesFor(t, actionCompute(`        x:number := <~ @ns.`)); !hasErrorCode(codes, diag.CodeParseSyntaxError) {
		t.Errorf("trailing dot: got %v, want a syntax error", codes)
	}
}

// TestHookIngressName checks the hook name is captured from the call.
func TestHookIngressName(t *testing.T) {
	tf := mustParse(t, actionCompute(`        x:number := <~ hook("manifest_feed")`))
	h, ok := tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0].Ingress.(*ast.IngressHook)
	if !ok || h.HookName != "manifest_feed" {
		t.Errorf("ingress = %v, want hook(manifest_feed)", tf.Scenes[0].Actions[0].Compute.Prog.Bindings[0].Ingress)
	}
}

// ─── promoted result: a trailing anonymous egress ────────────────────────────

// TestTrailingEgressBecomesResult covers the shorthand for a result nothing
// reads: an action compute block with no `:=` whose last item is an anonymous
// egress means `__result:<dest type> := (expr) ~> @ns.field`. The binding stays
// Anonymous, which is what tells lowering to take its type from the destination.
func TestTrailingEgressBecomesResult(t *testing.T) {
	tf := mustParse(t, actionCompute(`        (1) ~> @ns.val`))
	c := tf.Scenes[0].Actions[0].Compute
	if c.Root != names.GeneratedResultName {
		t.Errorf("root = %q, want %q", c.Root, names.GeneratedResultName)
	}
	b := c.Prog.Bindings[0]
	if b.Name != names.GeneratedResultName || b.Marker != ast.MarkerRoot || !b.Anonymous {
		t.Errorf("promoted binding = %#v", b)
	}
}

// TestTrailingEgressPromotesOnlyTheLastItem checks that the earlier writes are
// untouched: they stay unnamed for lowering to number, and only the last one
// carries the result marker.
func TestTrailingEgressPromotesOnlyTheLastItem(t *testing.T) {
	tf := mustParse(t, actionCompute(`        (1) ~> @ns.val
        (2) ~> @ns.val`))
	bindings := tf.Scenes[0].Actions[0].Compute.Prog.Bindings
	if bindings[0].Name != "" || bindings[0].Marker != ast.MarkerNone {
		t.Errorf("first write = %#v, want unnamed and unmarked", bindings[0])
	}
	if bindings[1].Name != names.GeneratedResultName {
		t.Errorf("last write = %q, want %q", bindings[1].Name, names.GeneratedResultName)
	}
}

// TestExplicitResultSuppressesPromotion covers the ordering rule the shorthand
// leaves alone: with a `:=` present the trailing write is not a second result,
// and the block is the same MarkerNotLast error it was before.
func TestExplicitResultSuppressesPromotion(t *testing.T) {
	codes := codesFor(t, actionCompute(`        done:bool := true
        (1) ~> @ns.val`))
	if !hasErrorCode(codes, diag.CodeMarkerNotLast) {
		t.Errorf("got %v, want MarkerNotLast", codes)
	}
	// A promotion here would have marked the trailing write as a second result.
	if hasErrorCode(codes, diag.CodeDuplicateMarker) {
		t.Errorf("got %v, want no DuplicateMarker: the trailing write must not be promoted", codes)
	}
}

// TestTrailingEgressNotPromotedWhenNotLast keeps the MissingRootMarker error for
// a block that holds an anonymous egress somewhere other than its last line.
func TestTrailingEgressNotPromotedWhenNotLast(t *testing.T) {
	codes := codesFor(t, actionCompute(`        (1) ~> @ns.val
        x:bool = true`))
	if !hasErrorCode(codes, diag.CodeMissingRootMarker) {
		t.Errorf("got %v, want MissingRootMarker", codes)
	}
}

// TestTrailingEgressNotPromotedInTransition covers the scope limit: a transition
// result is a branch condition, and a transition cannot write to STATE, so the
// missing-condition error stands rather than accepting the write and rejecting it
// one stage later.
func TestTrailingEgressNotPromotedInTransition(t *testing.T) {
	codes := codesFor(t, nextCompute(`        (true) ~> @ns.val`))
	if !hasErrorCode(codes, diag.CodeMissingConditionMarker) {
		t.Errorf("got %v, want MissingConditionMarker", codes)
	}
	// Promoting here would have produced a result whose role is wrong for a
	// transition instead of naming the real problem.
	if hasErrorCode(codes, diag.CodeMarkerContext) {
		t.Errorf("got %v, want no MarkerContext: the write must not be promoted", codes)
	}
}
