package parser_test

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
)

// The nesting depths here are far past the cap on purpose. A test at the
// boundary proves the diagnostic fires; only a test at a depth that used to
// exhaust the stack proves the cap is reached before the recursion is. Before
// the cap these two inputs killed the process with `fatal error: stack
// overflow`, which recover() cannot catch, so a regression here would not fail
// this test — it would fail the whole package run. That is the intended signal.
const overflowingDepth = 1_500_000

func sceneWithBinding(rhs string) string {
	return "state { s { a:number = 0 } }\n" +
		"scene \"x\" {\n entry_action = go\n action \"go\" {\n  compute \"c\" {\n" +
		"   v:number := " + rhs + "\n  }\n }\n}\n"
}

func hasCode(ds diag.Diagnostics, code diag.ErrorCode) bool {
	for _, d := range ds {
		if d.Code == code {
			return true
		}
	}
	return false
}

// Expression nesting reaches the parser through the local-expression cycle:
// parseLocalTupleExpr → parseLocalExpr → parseLocalPrec → parseLocalPrimary →
// parseLocalTupleExpr. A pipeline is the shortest way into it from a binding.
func TestDeeplyNestedExpressionIsDiagnosed(t *testing.T) {
	nested := strings.Repeat("(", overflowingDepth) + "1" + strings.Repeat(")", overflowingDepth)
	_, ds := parser.ParseFile("deep.tu", sceneWithBinding("1 |> add("+nested+")"))

	if !hasCode(ds, diag.CodeExpressionTooDeep) {
		t.Fatalf("expected ExpressionTooDeep, got %v", ds)
	}
}

// Array literals are a second descent into the same cycle, and one that needs
// no expression at all: a STATE default reaches parseLiteral directly. It
// shares the counter, so it shares the diagnostic.
func TestDeeplyNestedArrayLiteralIsDiagnosed(t *testing.T) {
	nested := strings.Repeat("[", overflowingDepth) + strings.Repeat("]", overflowingDepth)
	src := "state { s { a:arr<number> = " + nested + " } }\n" +
		"scene \"x\" { entry_action = go\n action \"go\" { compute \"c\" { v:number := 1 } } }\n"
	_, ds := parser.ParseFile("deep.tu", src)

	if !hasCode(ds, diag.CodeExpressionTooDeep) {
		t.Fatalf("expected ExpressionTooDeep, got %v", ds)
	}
}

// One over-deep expression is one mistake. Reporting it once per unwinding
// frame would bury every other error in the file under a hundred copies of it,
// which is what the diagnostic cap would then truncate the file's real errors
// down to.
func TestDeeplyNestedExpressionReportsOnce(t *testing.T) {
	nested := strings.Repeat("(", 4000) + "1" + strings.Repeat(")", 4000)
	_, ds := parser.ParseFile("deep.tu", sceneWithBinding("1 |> add("+nested+")"))

	count := 0
	for _, d := range ds {
		if d.Code == diag.CodeExpressionTooDeep {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected exactly one ExpressionTooDeep diagnostic, got %d in %v", count, ds)
	}
}

// The grammar nests three ways, and only one of them is a bracket. A call and
// an `if` nest through a name, so recovery that consumed only the name left the
// argument list behind and every level of it came back as a syntax error — one
// real diagnostic followed by ninety-nine that say nothing, and then the
// TooManyDiagnostics sentinel, which makes a single over-deep expression read
// as a file riddled with mistakes.
func TestEveryNestingShapeReportsOnlyItsOwnError(t *testing.T) {
	const depth = 300_000
	for _, tc := range []struct{ name, rhs string }{
		{"tuples", strings.Repeat("(", depth) + "1" + strings.Repeat(")", depth)},
		{"calls", strings.Repeat("add(1,", depth) + "1" + strings.Repeat(")", depth)},
		{"ifs", strings.Repeat("if(true,1,", depth) + "1" + strings.Repeat(")", depth)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, ds := parser.ParseFile("deep.tu", sceneWithBinding("1 |> add("+tc.rhs+")"))
			if len(ds) != 1 || ds[0].Code != diag.CodeExpressionTooDeep {
				t.Fatalf("expected exactly one ExpressionTooDeep, got %d diagnostics: %v", len(ds), ds)
			}
		})
	}
}

// The cap has to leave room for expressions people actually write. Nesting
// this shallow is ordinary and must still parse.
func TestOrdinaryNestingStillParses(t *testing.T) {
	nested := strings.Repeat("(", 32) + "1" + strings.Repeat(")", 32)
	_, ds := parser.ParseFile("ok.tu", sceneWithBinding("1 |> add("+nested+")"))

	if ds.HasErrors() {
		t.Fatalf("expected 32-deep nesting to parse, got %v", ds)
	}
}
