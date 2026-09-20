package parser

import (
	"strings"
	"testing"
)

// FuzzParseFile feeds arbitrary bytes into the full lexer→parser pipeline and
// verifies that it never panics. Diagnostics are intentionally ignored — the
// fuzz target only checks for panic-freedom under arbitrary input.
func FuzzParseFile(f *testing.F) {
	seeds := []string{
		`state { ns { count:number = 0 } } scene "s" { entry_action = a action "a" {} }`,
		`state_file = "state.tu" scene "s" { entry_action = a }`,
		``,
		`scene "s" {}`,
		`state {}`,
		`@@@ invalid @@@`,
		"state { ns { x:number = 0 } }\nscene \"s\" {\n  entry_action = \"a\"\n  action \"a\" {\n    compute { root = \"v\" prog \"p\" { v:number = 1 } }\n    merge { v { to_state = ns.x } }\n  }\n}",
		"state { ns { x:str = \"\" } }\nscene \"s\" { entry_action = \"a\" action \"a\" { text = <<-EOT\nhello\nEOT\n} }",
		`state { ns { b:bool = false } } scene "s" { entry_action = a action "a" { compute "p" { v:bool = true r:bool := #if v -> v | false } } }`,
		"state { ns { n:number = 0 } }\nscene \"s\" { entry_action = \"a\"\n  action \"a\" {\n    compute { root = \"r\"\n      prog \"p\" {\n        x:number = 1\n        r:number = #case x { 1 -> 10 _ -> 0 }\n      }\n    }\n  }\n}",
		`{ { { { { {`,
		`} } } } } }`,
		// Nesting deep enough to matter. The seeds above are the right idea at
		// the wrong magnitude: the expression and literal grammars are mutually
		// recursive, and six of anything never reaches the depth where that
		// stops being free. A few thousand does, and the mutator grows a seed
		// rather than inventing one, so the corpus has to start somewhere near
		// the cliff for a bounded run to find it. Exceeding the cap is a
		// diagnostic; exceeding the stack is a fatal error no recover() catches.
		deeplyNested("(", ")", 5000),
		deeplyNested("[", "]", 5000),
		`<~> <~ ~> <~>`,
		"\"\\n\\t\\r\\\"\\\\\"",
		`arr<number> arr<str> arr<bool> arr<invalid>`,
	}
	for _, s := range seeds {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, src string) {
		// ParseFile must never panic regardless of input.
		ParseFile("<fuzz>", src)
	})
}

// deeplyNested builds a source whose binding RHS nests `depth` levels. The
// pipeline is what routes a parenthesised expression into the local-expression
// grammar, which is the recursive one; an array literal needs no pipeline,
// because a STATE default reaches parseLiteral directly.
func deeplyNested(open, close string, depth int) string {
	nested := strings.Repeat(open, depth) + "1" + strings.Repeat(close, depth)
	if open == "[" {
		return "state { s { a:arr<number> = " + strings.Repeat(open, depth) +
			strings.Repeat(close, depth) + " } }\n" +
			"scene \"s\" { entry_action = a action \"a\" { compute \"c\" { v:number := 1 } } }"
	}
	return "state { s { a:number = 0 } }\n" +
		"scene \"s\" { entry_action = a action \"a\" { compute \"c\" { v:number := 1 |> add(" +
		nested + ") } } }"
}
