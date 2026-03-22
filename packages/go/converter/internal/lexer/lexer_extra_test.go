package lexer

import (
	"strings"
	"testing"

	"github.com/turnout/converter/internal/diag"
)

// TestBangWithoutEquals verifies that '!' not followed by '=' produces an error.
func TestBangWithoutEquals(t *testing.T) {
	_, ds := Tokenize("<test>", "!")
	if !ds.HasErrors() {
		t.Error("expected lex error for standalone '!'")
	}
}

// TestTildeWithoutGT verifies that '~' not followed by '>' produces an error.
func TestTildeWithoutGT(t *testing.T) {
	_, ds := Tokenize("<test>", "~")
	if !ds.HasErrors() {
		t.Error("expected lex error for standalone '~'")
	}
}

// TestUnexpectedCharacter verifies that truly unknown characters produce errors.
func TestUnexpectedCharacter(t *testing.T) {
	_, ds := Tokenize("<test>", "@")
	if !ds.HasErrors() {
		t.Error("expected lex error for '@'")
	}
}

// TestEscapeR verifies that \r inside a string literal maps to a carriage-return byte.
func TestEscapeR(t *testing.T) {
	toks, ds := Tokenize("<test>", `"\r"`)
	if ds.HasErrors() {
		t.Fatalf("unexpected lex errors: %v", ds)
	}
	toks = filterEOF(toks)
	if len(toks) != 1 || toks[0].Kind != TokStringLit {
		t.Fatalf("expected 1 string literal, got %v", toks)
	}
	if toks[0].Value != "\r" {
		t.Errorf("\\r escape: got %q, want carriage-return", toks[0].Value)
	}
}

// TestUnknownEscapeChar verifies that an unrecognized escape sequence (\x) is
// preserved verbatim as '\' followed by 'x'.
func TestUnknownEscapeChar(t *testing.T) {
	toks, ds := Tokenize("<test>", `"\x"`)
	if ds.HasErrors() {
		t.Fatalf("unexpected lex errors: %v", ds)
	}
	toks = filterEOF(toks)
	if len(toks) != 1 || toks[0].Kind != TokStringLit {
		t.Fatalf("expected 1 string literal, got %v", toks)
	}
	if toks[0].Value != `\x` {
		t.Errorf("unknown escape: got %q, want %q", toks[0].Value, `\x`)
	}
}

// TestHeredocMissingDelimiter verifies that <<- with no delimiter identifier
// on the opening line produces a lex error.
func TestHeredocMissingDelimiter(t *testing.T) {
	_, ds := Tokenize("<test>", "<<-\n")
	if !ds.HasErrors() {
		t.Error("expected lex error for heredoc with empty delimiter")
	}
}

// TestArrInvalidTypeParam verifies that arr<unknown> (invalid type parameter)
// causes the lexer to restore its position and emit arr as a plain identifier,
// followed by the remaining tokens (<, unknown, >).
func TestArrInvalidTypeParam(t *testing.T) {
	toks := filterEOF(mustTokenize(t, "arr<unknown>"))
	// arr → TokIdent, < → TokLT, unknown → TokIdent, > → TokGT
	if len(toks) != 4 {
		t.Fatalf("expected 4 tokens for arr<unknown>, got %d: %v", len(toks), toks)
	}
	if toks[0].Kind != TokIdent || toks[0].Value != "arr" {
		t.Errorf("toks[0]: got %v %q, want TokIdent 'arr'", toks[0].Kind, toks[0].Value)
	}
	if toks[1].Kind != TokLT {
		t.Errorf("toks[1]: got %v, want TokLT", toks[1].Kind)
	}
	if toks[2].Kind != TokIdent || toks[2].Value != "unknown" {
		t.Errorf("toks[2]: got %v %q, want TokIdent 'unknown'", toks[2].Kind, toks[2].Value)
	}
	if toks[3].Kind != TokGT {
		t.Errorf("toks[3]: got %v, want TokGT", toks[3].Kind)
	}
}

// TestTripleQuoteCRLFLeading verifies that a CRLF immediately after the opening
// triple-quote is stripped (the spec trims one leading newline).
func TestTripleQuoteCRLFLeading(t *testing.T) {
	// Opening """ then \r\n then content then closing """
	src := "\"\"\"\r\nhello\n\"\"\""
	toks, ds := Tokenize("<test>", src)
	if ds.HasErrors() {
		t.Fatalf("unexpected lex errors: %v", ds)
	}
	toks = filterEOF(toks)
	if len(toks) != 1 || toks[0].Kind != TokTripleQuote {
		t.Fatalf("expected TokTripleQuote, got %v", toks)
	}
	// Leading \r\n stripped; trailing \n stripped by spec
	if toks[0].Value != "hello" {
		t.Errorf("got %q, want %q", toks[0].Value, "hello")
	}
}

// TestTripleQuoteCRLFTrailing verifies that a CRLF immediately before the
// closing triple-quote is stripped.
func TestTripleQuoteCRLFTrailing(t *testing.T) {
	src := "\"\"\"\nhello\r\n\"\"\""
	toks, ds := Tokenize("<test>", src)
	if ds.HasErrors() {
		t.Fatalf("unexpected lex errors: %v", ds)
	}
	toks = filterEOF(toks)
	if len(toks) != 1 || toks[0].Kind != TokTripleQuote {
		t.Fatalf("expected TokTripleQuote, got %v", toks)
	}
	if toks[0].Value != "hello" {
		t.Errorf("got %q, want %q", toks[0].Value, "hello")
	}
}

// TestHeredocCRLFLineEndings verifies that the heredoc scanner handles CRLF
// line endings in the body correctly.
func TestHeredocCRLFLineEndings(t *testing.T) {
	// Heredoc with CRLF line endings
	src := "x = <<-EOT\r\n  hello\r\n  EOT\r\n"
	toks := filterEOF(mustTokenize(t, src))
	var hd Token
	for _, tok := range toks {
		if tok.Kind == TokHeredoc {
			hd = tok
			break
		}
	}
	if hd.Kind != TokHeredoc {
		t.Fatal("expected TokHeredoc token")
	}
	if hd.Value != "hello" {
		t.Errorf("heredoc body = %q, want %q", hd.Value, "hello")
	}
}

// TestOperatorsExtra covers operator tokens not tested in TestOperators.
func TestOperatorsExtra(t *testing.T) {
	cases := []struct {
		src  string
		kind TokenKind
		val  string
	}{
		{"==", TokEqEq, "=="},
		{"!=", TokNeq, "!="},
		{"-", TokMinus, "-"},
		{"*", TokStar, "*"},
		{"/", TokSlash, "/"},
		{"%", TokPercent, "%"},
	}
	for _, tc := range cases {
		toks := filterEOF(mustTokenize(t, tc.src))
		if len(toks) != 1 || toks[0].Kind != tc.kind || toks[0].Value != tc.val {
			t.Errorf("src=%q: got %v %q, want %v %q",
				tc.src, toks[0].Kind, toks[0].Value, tc.kind, tc.val)
		}
	}
}

// TestHashPipeNotExact verifies that #pipefoo (extra ident chars) is treated
// as a line comment, not as #pipe.
func TestHashPipeNotExact(t *testing.T) {
	// #pipefoo is a comment (not #pipe)
	toks := filterEOF(mustTokenize(t, "#pipefoo\nident"))
	if len(toks) != 1 || toks[0].Kind != TokIdent || toks[0].Value != "ident" {
		t.Errorf("expected single TokIdent after #pipefoo comment, got %v", toks)
	}
}

// TestHashIfNotExact verifies that #iffoo is treated as a comment.
func TestHashIfNotExact(t *testing.T) {
	toks := filterEOF(mustTokenize(t, "#iffoo\nval"))
	if len(toks) != 1 || toks[0].Kind != TokIdent || toks[0].Value != "val" {
		t.Errorf("expected single TokIdent after #iffoo comment, got %v", toks)
	}
}

// TestNumberFollowedByDot verifies that "42." (no digit after dot) does NOT
// consume the dot as part of the number.
func TestNumberFollowedByDotNoDigit(t *testing.T) {
	// "42." — the dot is not preceded by a digit on the right, so not decimal
	toks := filterEOF(mustTokenize(t, "42.x"))
	// expect: NumberLit(42), Dot, Ident(x)
	if len(toks) < 1 || toks[0].Kind != TokNumberLit || toks[0].Value != "42" {
		t.Errorf("toks[0]: got %v %q, want TokNumberLit '42'", toks[0].Kind, toks[0].Value)
	}
	if len(toks) < 2 || toks[1].Kind != TokDot {
		t.Errorf("toks[1]: got %v, want TokDot", toks[1].Kind)
	}
}

// TestUnterminatedStringEOF verifies that a string ending at EOF (without \n)
// also generates an unterminated-string error.
func TestUnterminatedStringEOF(t *testing.T) {
	_, ds := Tokenize("<test>", `"no closing quote`)
	if !ds.HasErrors() {
		t.Error("expected lex error for string without closing quote at EOF")
	}
}

func TestUnterminatedTripleQuoteEOF(t *testing.T) {
	_, ds := Tokenize("<test>", "\"\"\"\nno closing quote")
	if !ds.HasErrors() {
		t.Fatal("expected lex error for triple-quoted string without closing delimiter")
	}
	if ds[0].Code != "LexError" || ds[0].Message != "unterminated triple-quoted string" {
		t.Fatalf("unexpected diagnostic: %+v", ds[0])
	}
}

func TestUnexpectedCharacterBurstIsCapped(t *testing.T) {
	_, ds := Tokenize("<test>", strings.Repeat("@", 1000))
	if !ds.HasErrors() {
		t.Fatal("expected lex errors")
	}
	if len(ds) != maxDiagnostics+1 {
		t.Fatalf("diag count = %d, want %d", len(ds), maxDiagnostics+1)
	}
	last := ds[len(ds)-1]
	if last.Code != diag.CodeTooManyDiagnostics {
		t.Fatalf("last diagnostic code = %q, want %q", last.Code, diag.CodeTooManyDiagnostics)
	}
}
