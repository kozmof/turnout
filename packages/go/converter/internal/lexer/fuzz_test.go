package lexer

import "testing"

// FuzzTokenize feeds arbitrary bytes into the lexer and verifies that it never
// panics and always returns a token stream ending with TokEOF.
func FuzzTokenize(f *testing.F) {
	// Seed corpus: representative Turn DSL fragments covering the interesting
	// lexer paths — sigils, heredocs, triple-quotes, hash keywords, operators.
	seeds := []string{
		`state { ns { count:number = 0 } }`,
		`scene "s" { entry_actions = ["a"] action "a" {} }`,
		`<~> v:number = 1`,
		`~> v:str = "hello"`,
		`<~ v:bool = true`,
		"<<-EOT\nhello world\nEOT",
		`"""multi\nline"""`,
		`#pipe #if #case #it`,
		`=> >= <= == != + - * / %`,
		`arr<number> arr<str> arr<bool>`,
		``,
		"\x00\x01\x02\x03\x04\x05\x06\x07",
		"<<-\nhello\n",
		`"unterminated`,
		`"""unterminated`,
		`~`,
		`!`,
	}
	for _, s := range seeds {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, src string) {
		toks, _ := Tokenize("<fuzz>", src)
		if len(toks) == 0 {
			t.Fatal("Tokenize returned empty token slice (must always contain at least TokEOF)")
		}
		if toks[len(toks)-1].Kind != TokEOF {
			t.Fatalf("last token is %v, expected TokEOF", toks[len(toks)-1].Kind)
		}
	})
}
