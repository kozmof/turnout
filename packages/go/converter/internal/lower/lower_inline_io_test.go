package lower_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"google.golang.org/protobuf/proto"
)

// TestInlineIOMatchesBlockForm is the central contract of NEW_SYNTAX.md 3:
// inline IO is a spelling, not a semantic change. The two forms must lower to
// the same action model, so migrating a file cannot alter its behaviour.
func TestInlineIOMatchesBlockForm(t *testing.T) {
	inline := mustLower(t, minimal(`  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        income:number <~ @ns.val
        out:number := (income) ~> @ns.val
      }
    }
  }`))
	block := mustLower(t, minimal(`  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        income:number
        out:number := income
      }
    }
    prepare {
      income { from_state = ns.val }
    }
    merge {
      out { to_state = ns.val }
    }
  }`))
	if !proto.Equal(inline.Scenes[0].Actions[0], block.Scenes[0].Actions[0]) {
		t.Errorf("inline and block forms lowered differently:\ninline: %v\nblock:  %v",
			inline.Scenes[0].Actions[0], block.Scenes[0].Actions[0])
	}
}

// TestInlineIOSynthesizesEntries pins the shape the hoisting produces.
func TestInlineIOSynthesizesEntries(t *testing.T) {
	tm := mustLower(t, minimal(`  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        income:number <~ @ns.val
        out:number := (income) ~> @ns.val
      }
    }
  }`))
	a := tm.Scenes[0].Actions[0]
	if len(a.Prepare) != 1 || a.Prepare[0].Binding != "income" || a.Prepare[0].GetFromState() != "ns.val" {
		t.Errorf("prepare = %v, want one from_state entry for income", a.Prepare)
	}
	if len(a.Merge) != 1 || a.Merge[0].Binding != "out" || a.Merge[0].ToState != "ns.val" {
		t.Errorf("merge = %v, want one to_state entry for out", a.Merge)
	}
}

// TestInlineIOHookSource covers a hook ingress reaching the prepare entry.
func TestInlineIOHookSource(t *testing.T) {
	tm := mustLower(t, minimal(`  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        line:str <~ hook("manifest_feed")
        out:str := line
      }
    }
  }`))
	p := tm.Scenes[0].Actions[0].Prepare
	if len(p) != 1 || p[0].GetFromHook() != "manifest_feed" {
		t.Errorf("prepare = %v, want from_hook = manifest_feed", p)
	}
}

// TestInlineIONextSources covers the transition-only ingress sources reaching
// the next rule's prepare entries.
func TestInlineIONextSources(t *testing.T) {
	tm := mustLower(t, minimal(`  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        ready:bool := true
      }
    }
    next {
      compute {
        prog "n" {
          from_act:bool <~ action(ready)
          ceiling:number <~ 300
          from_st:bool <~ @ns.flag
          go:bool := from_act
        }
      }
      action = b
    }
  }
  action "b" {
    compute { prog "q" { v:bool := true } }
  }`))
	entries := tm.Scenes[0].Actions[0].Next[0].Prepare
	if len(entries) != 3 {
		t.Fatalf("prepare entries = %d, want 3", len(entries))
	}
	byName := map[string]int{}
	for i, e := range entries {
		byName[e.Binding] = i
	}
	if e := entries[byName["from_act"]]; e.GetFromAction() != "ready" {
		t.Errorf("from_act source = %v, want from_action=ready", e)
	}
	if e := entries[byName["ceiling"]]; e.FromLiteral == nil {
		t.Errorf("ceiling source = %v, want a literal", e)
	}
	if e := entries[byName["from_st"]]; e.GetFromState() != "ns.flag" {
		t.Errorf("from_st source = %v, want from_state=ns.flag", e)
	}
}

// TestInlineAndBlockIOConflict covers the precedence rule: a binding declares
// its input or output inline or in a block, never both, because the two could
// disagree about the destination.
func TestInlineAndBlockIOConflict(t *testing.T) {
	t.Run("input", func(t *testing.T) {
		ds := lowerWithErrors(t, minimal(`  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        income:number <~ @ns.val
        out:number := income
      }
    }
    prepare {
      income { from_state = ns.val }
    }
  }`))
		if !hasLowerDiagCode(ds, diag.CodeDuplicateInlineIO) {
			t.Errorf("want DuplicateInlineIO, got %v", ds)
		}
	})

	t.Run("output", func(t *testing.T) {
		ds := lowerWithErrors(t, minimal(`  entry_actions = [a]
  action "a" {
    compute {
      prog "p" {
        out:number := (1) ~> @ns.val
      }
    }
    merge {
      out { to_state = ns.val }
    }
  }`))
		if !hasLowerDiagCode(ds, diag.CodeDuplicateInlineIO) {
			t.Errorf("want DuplicateInlineIO, got %v", ds)
		}
	})
}

// TestInlineEgressInTransitionRejected covers the transition rule: a STATE write
// belongs to the action, not to the transition that selects it.
func TestInlineEgressInTransitionRejected(t *testing.T) {
	ds := lowerWithErrors(t, minimal(`  entry_actions = [a]
  action "a" {
    compute { prog "p" { v:bool := true } }
    next {
      compute {
        prog "n" {
          x:number = (1) ~> @ns.val
          go:bool := true
        }
      }
      action = b
    }
  }
  action "b" {
    compute { prog "q" { v:bool := true } }
  }`))
	if !hasLowerDiagCode(ds, diag.CodeTransitionOutputSigil) {
		t.Errorf("want TransitionOutputSigil, got %v", ds)
	}
}
