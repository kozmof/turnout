package parser

import "testing"

// FuzzParseFile feeds arbitrary bytes into the full lexer→parser pipeline and
// verifies that it never panics. Diagnostics are intentionally ignored — the
// fuzz target only checks for panic-freedom under arbitrary input.
func FuzzParseFile(f *testing.F) {
	seeds := []string{
		`state { ns { count:number = 0 } } scene "s" { entry_actions = ["a"] action "a" {} }`,
		`state_file = "state.turn" scene "s" { entry_actions = ["a"] }`,
		``,
		`scene "s" {}`,
		`state {}`,
		`@@@ invalid @@@`,
		"state { ns { x:number = 0 } }\nscene \"s\" {\n  entry_actions = [\"a\"]\n  action \"a\" {\n    compute { root = \"v\" prog \"p\" { <~ v:number = 1 } }\n    merge { v { to_state = ns.x } }\n  }\n}",
		"state { ns { x:str = \"\" } }\nscene \"s\" { entry_actions = [\"a\"] action \"a\" { text = <<-EOT\nhello\nEOT\n} }",
		`state { ns { b:bool = false } } scene "s" { entry_actions = ["a"] action "a" { compute { prog "p" { v:bool = true |^| r:bool = #if v => v | false } } } }`,
		"state { ns { n:number = 0 } }\nscene \"s\" { entry_actions = [\"a\"]\n  action \"a\" {\n    compute { root = \"r\"\n      prog \"p\" {\n        x:number = 1\n        r:number = #case x { 1 => 10 _ => 0 }\n      }\n    }\n  }\n}",
		`{ { { { { {`,
		`} } } } } }`,
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
