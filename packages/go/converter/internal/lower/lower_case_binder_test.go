package lower_test

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
)

// A pattern binder is visible only inside its own arm (pipe-if-case-it.md §5.7).
// The lowerer implements that by alpha-renaming the binder to the subject temp
// rather than emitting a prog binding named after it. These tests hold that
// property: without it, the multi-threshold spelling below is a DuplicateBinding
// error and the binder outlives the case.

// lowerDiags parses and lowers src, returning the diagnostics rather than
// failing on them, so tests can assert that a source lowers cleanly *or* that it
// produces a specific error.
func lowerDiags(t *testing.T, src string) (*turnoutpb.TurnModel, []string) {
	t.Helper()
	tf, ds := parser.ParseFile("test.tu", src)
	if ds.HasErrors() {
		msgs := make([]string, 0, len(ds))
		for _, d := range ds {
			msgs = append(msgs, d.Format())
		}
		return nil, msgs
	}
	lr, ds2 := lower.LowerResolvingState(tf, "")
	msgs := make([]string, 0, len(ds2))
	for _, d := range ds2 {
		msgs = append(msgs, d.Format())
	}
	if lr == nil {
		return nil, msgs
	}
	return lr.Model, msgs
}

func bindingNameList(bs []*turnoutpb.BindingModel) []string {
	names := make([]string, len(bs))
	for i, b := range bs {
		names[i] = b.Name
	}
	return names
}

func TestCaseBinderReusedAcrossArms(t *testing.T) {
	tm, diags := lowerDiags(t, minimal(`  entry_action = a
  action "a" {
    compute "p" {
      v:number <~ @ns.val
      band:str := case(
        v,
        x if x >= 10 -> "high",
        x if x >= 5  -> "mid",
        _            -> "low"
      )
    }
  }`))
	if len(diags) != 0 {
		t.Fatalf("expected clean lowering, got: %s", strings.Join(diags, "; "))
	}
	for _, name := range bindingNameList(tm.Scenes[0].Actions[0].Compute.Prog.Bindings) {
		if name == "x" {
			t.Fatalf("binder %q leaked into the prog as a binding; bindings: %v",
				name, bindingNameList(tm.Scenes[0].Actions[0].Compute.Prog.Bindings))
		}
	}
}

func TestCaseBinderReusedAcrossFourArms(t *testing.T) {
	_, diags := lowerDiags(t, minimal(`  entry_action = a
  action "a" {
    compute "p" {
      v:number <~ @ns.val
      band:str := case(
        v,
        n if n >= 30 -> "d",
        n if n >= 20 -> "c",
        n if n >= 10 -> "b",
        n if n >= 5  -> "a",
        _            -> "none"
      )
    }
  }`))
	if len(diags) != 0 {
		t.Fatalf("expected clean lowering, got: %s", strings.Join(diags, "; "))
	}
}

func TestCaseBinderNotVisibleAfterCase(t *testing.T) {
	// The lower stage does not resolve plain (non-local) references, so this is a
	// validate-stage diagnostic. Run both to assert the binder is genuinely out of
	// scope after its case rather than merely absent from the emitted bindings.
	tm, diags := lowerDiags(t, minimal(`  entry_action = a
  action "a" {
    compute "p" {
      v:number <~ @ns.val
      band:str  = case(v, x -> "bound", _ -> "none")
      leak:number := x + 1
    }
  }`))
	if tm == nil {
		t.Fatalf("lowering failed: %s", strings.Join(diags, "; "))
	}
	var joined []string
	for _, d := range validate.Validate(validate.ValidateInput{Model: tm}) {
		joined = append(joined, d.Format())
	}
	if !strings.Contains(strings.Join(joined, "; "), "UndefinedRef") {
		t.Fatalf("expected UndefinedRef for a binder referenced after its case, got: %s",
			strings.Join(joined, "; "))
	}
}

func TestCaseBinderResolvesToSubjectValue(t *testing.T) {
	tm, diags := lowerDiags(t, minimal(`  entry_action = a
  action "a" {
    compute "p" {
      v:number <~ @ns.val
      doubled:number := case(v, x -> x + x, _ -> 0)
    }
  }`))
	if len(diags) != 0 {
		t.Fatalf("expected clean lowering, got: %s", strings.Join(diags, "; "))
	}
	bindings := tm.Scenes[0].Actions[0].Compute.Prog.Bindings

	// The arm body must add the subject temp to itself. Skip the identity combines
	// (`add(ref, lit 0)`) the lowerer emits for single references and find the one
	// add whose operands are both references.
	var addArgs []*turnoutpb.ArgModel
	for _, b := range bindings {
		c := b.GetExpr().GetCombine()
		if c == nil || c.Fn != "add" || len(c.Args) != 2 {
			continue
		}
		if c.Args[0].GetRef() != "" && c.Args[1].GetRef() != "" {
			addArgs = c.Args
			break
		}
	}
	if len(addArgs) != 2 {
		t.Fatalf("no ref-to-ref add combine found; bindings: %v", bindingNameList(bindings))
	}
	// Each operand is lowered into its own identity temp, so follow one hop to the
	// binding it actually reads. Both must land on the same subject temp: that is
	// what "the binder is the subject" means once the prog binding is gone.
	left := throughIdentity(bindings, addArgs[0].GetRef())
	right := throughIdentity(bindings, addArgs[1].GetRef())
	if left == "" || left != right {
		t.Fatalf("binder operands resolve to %q and %q, want both to name the same subject temp", left, right)
	}
	if !strings.Contains(left, "subject") {
		t.Errorf("binder resolved to %q, want the generated subject temp", left)
	}
	if findBindingOrNil(bindings, left) == nil {
		t.Errorf("subject temp %q is referenced but not declared", left)
	}
}

// throughIdentity follows a single identity combine (`fn(ref, identity-literal)`)
// to the binding it reads, and returns name unchanged for any other shape.
func throughIdentity(bs []*turnoutpb.BindingModel, name string) string {
	b := findBindingOrNil(bs, name)
	if b == nil {
		return name
	}
	c := b.GetExpr().GetCombine()
	if c == nil || len(c.Args) != 2 {
		return name
	}
	if c.Args[0].GetRef() != "" && c.Args[1].GetLit() != nil {
		return c.Args[0].GetRef()
	}
	return name
}

// A binder in a nested case shadows an enclosing arm's binder of the same name;
// the inner reference must resolve to the inner subject, not the outer one.
func TestNestedCaseBinderShadowsOuter(t *testing.T) {
	tm, diags := lowerDiags(t, minimal(`  entry_action = a
  action "a" {
    compute "p" {
      v:number <~ @ns.val
      w:number  = 7
      out:number := case(
        v,
        x -> case(w, x -> x, _ -> 0),
        _ -> 0
      )
    }
  }`))
	if len(diags) != 0 {
		t.Fatalf("expected clean lowering, got: %s", strings.Join(diags, "; "))
	}
	bindings := tm.Scenes[0].Actions[0].Compute.Prog.Bindings

	// Two subject temps are emitted, one per case. The inner arm body must be an
	// identity on the inner subject — the one lowered from `w`, not from `v`.
	inner := findSubjectTempFor(bindings, "w")
	if inner == "" {
		t.Fatalf("no subject temp lowered from w; bindings: %v", bindingNameList(bindings))
	}
	if !referencesBinding(bindings, inner) {
		t.Errorf("inner subject temp %q is never referenced — the outer binder captured the inner one", inner)
	}
}

func findBindingOrNil(bs []*turnoutpb.BindingModel, name string) *turnoutpb.BindingModel {
	for _, b := range bs {
		if b.Name == name {
			return b
		}
	}
	return nil
}

// findSubjectTempFor returns the name of the generated subject binding whose
// identity combine reads ref.
func findSubjectTempFor(bs []*turnoutpb.BindingModel, ref string) string {
	for _, b := range bs {
		if !strings.Contains(b.Name, "subject") {
			continue
		}
		for _, arg := range b.GetExpr().GetCombine().GetArgs() {
			if arg.GetRef() == ref {
				return b.Name
			}
		}
	}
	return ""
}

// referencesBinding reports whether any binding other than name itself names it
// as a combine or cond operand.
func referencesBinding(bs []*turnoutpb.BindingModel, name string) bool {
	for _, b := range bs {
		if b.Name == name {
			continue
		}
		expr := b.GetExpr()
		for _, arg := range expr.GetCombine().GetArgs() {
			if arg.GetRef() == name {
				return true
			}
		}
		if cond := expr.GetCond(); cond != nil {
			for _, arg := range []*turnoutpb.ArgModel{cond.GetCondition(), cond.GetThen(), cond.GetElseBranch()} {
				if arg.GetRef() == name || arg.GetFuncRef() == name {
					return true
				}
			}
		}
	}
	return false
}
