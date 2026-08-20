package validate_test

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// caseProgram assembles a program with the given type declarations, a subject
// binding `s`, and a root case binding over `s` with the given arm text.
func caseProgram(typeDecls, subjectDecl, arms string) string {
	return typeDecls + `
state { app { score:number = 0 } }
scene "sc" {
  entry_action = a
  action "a" {
    compute "p" {
      n: number = 1
      ` + subjectDecl + `
      r: str := case(
        s,
        ` + arms + `
      )
    }
  }
}
`
}

const statusType = `type Status = "pending" | "running" | "done"`

func TestCaseExhaustiveUnion(t *testing.T) {
	src := caseProgram(statusType, `s: Status = "pending"`,
		`"pending" -> "a", "running" -> "b", "done" -> "c"`)
	ds := pipeline(src)
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestCaseNonExhaustiveUnion(t *testing.T) {
	src := caseProgram(statusType, `s: Status = "pending"`,
		`"pending" -> "a", "done" -> "c"`)
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeNonExhaustiveMatch) {
		t.Errorf("expected NonExhaustiveMatch, got %v", ds)
	}
	// diagnostic should name the missing member
	if !anyMsgContains(ds, `"running"`) {
		t.Errorf("expected diagnostic to mention missing \"running\": %v", ds)
	}
}

func TestCaseWildcardCompletion(t *testing.T) {
	src := caseProgram(statusType, `s: Status = "pending"`,
		`"pending" -> "a", _ -> "z"`)
	ds := pipeline(src)
	if hasCode(ds, diag.CodeNonExhaustiveMatch) {
		t.Errorf("wildcard should make match exhaustive: %v", ds)
	}
}

func TestCaseBinderCompletion(t *testing.T) {
	src := caseProgram(statusType, `s: Status = "pending"`,
		`"pending" -> "a", other -> other`)
	ds := pipeline(src)
	if hasCode(ds, diag.CodeNonExhaustiveMatch) {
		t.Errorf("binder should make match exhaustive: %v", ds)
	}
}

func TestCaseDuplicateLiteral(t *testing.T) {
	src := caseProgram(statusType, `s: Status = "pending"`,
		`"pending" -> "a", "pending" -> "b", "running" -> "c", "done" -> "d"`)
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeDuplicateCasePattern) {
		t.Errorf("expected DuplicateCasePattern, got %v", ds)
	}
}

func TestCaseWildcardShadowing(t *testing.T) {
	// Arms after a wildcard are rejected earlier, by the parser's "wildcard must
	// be the last arm" rule (§17.2 shadowing, enforced structurally).
	src := caseProgram(statusType, `s: Status = "pending"`,
		`_ -> "z", "done" -> "d"`)
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeUnsupportedConstruct) {
		t.Errorf("expected an error for an arm after a wildcard, got %v", ds)
	}
}

func TestCaseBinderShadowing(t *testing.T) {
	src := caseProgram(statusType, `s: Status = "pending"`,
		`v -> v, "done" -> "d"`)
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeUnreachableArm) {
		t.Errorf("expected UnreachableArm after binder, got %v", ds)
	}
}

func TestCaseGuardedArmNotCatchAll(t *testing.T) {
	// A guarded binder does not cover everything, so a following literal arm is
	// reachable and the match may still be non-exhaustive.
	src := caseProgram(statusType, `s: Status = "pending"`,
		`v if n > 0 -> v, "pending" -> "a", "running" -> "b", "done" -> "c"`)
	ds := pipeline(src)
	if hasCode(ds, diag.CodeUnreachableArm) {
		t.Errorf("literal arm after a guarded binder should be reachable: %v", ds)
	}
	if hasCode(ds, diag.CodeNonExhaustiveMatch) {
		t.Errorf("all members are covered by the unguarded literal arms: %v", ds)
	}
}

func TestCaseGuardedLiteralStillNonExhaustive(t *testing.T) {
	// Only guarded arms cover "running"/"done": still non-exhaustive.
	src := caseProgram(statusType, `s: Status = "pending"`,
		`"pending" -> "a", "running" if n > 0 -> "b", "done" -> "c"`)
	ds := pipeline(src)
	if !hasCode(ds, diag.CodeNonExhaustiveMatch) {
		t.Errorf("guarded arm should not complete coverage: %v", ds)
	}
	if !anyMsgContains(ds, `"running"`) {
		t.Errorf("expected \"running\" reported missing: %v", ds)
	}
}

func TestCasePlainStrNotChecked(t *testing.T) {
	// A subject with no finite declared type is not exhaustiveness-checked.
	src := caseProgram(``, `s: str = "x"`,
		`"pending" -> "a"`)
	ds := pipeline(src)
	if hasCode(ds, diag.CodeNonExhaustiveMatch) {
		t.Errorf("plain str subject should not be exhaustiveness-checked: %v", ds)
	}
}

func anyMsgContains(ds diag.Diagnostics, sub string) bool {
	for _, d := range ds {
		if strings.Contains(d.Format(), sub) {
			return true
		}
	}
	return false
}
