package lexer

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

func TestIrregularLexMalformedInputs(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		src        string
		wantCode   string
		wantSubstr string
	}{
		{
			name:       "bang_without_equals",
			src:        "!",
			wantCode:   "LexError",
			wantSubstr: "did you mean '!='?",
		},
		{
			name:       "tilde_without_gt",
			src:        "~",
			wantCode:   "LexError",
			wantSubstr: "expected '~>'",
		},
		{
			name:       "unexpected_character",
			src:        "@",
			wantCode:   "LexError",
			wantSubstr: "unexpected character '@'",
		},
		{
			name:       "missing_heredoc_delimiter",
			src:        "<<-\n",
			wantCode:   "LexError",
			wantSubstr: "heredoc missing delimiter identifier",
		},
		{
			name:       "unterminated_string",
			src:        `"no closing quote`,
			wantCode:   "LexError",
			wantSubstr: "unterminated string literal",
		},
		{
			name:       "unterminated_triple_quote",
			src:        "\"\"\"\nno closing quote",
			wantCode:   "LexError",
			wantSubstr: "unterminated triple-quoted string",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			toks, ds := Tokenize("<test>", tc.src)
			if !ds.HasErrors() {
				t.Fatal("expected lex errors")
			}
			if ds[0].Code != tc.wantCode {
				t.Fatalf("first diagnostic code = %q, want %q", ds[0].Code, tc.wantCode)
			}
			if !strings.Contains(ds[0].Message, tc.wantSubstr) {
				t.Fatalf("first diagnostic = %q, want substring %q", ds[0].Message, tc.wantSubstr)
			}
			if len(toks) == 0 || toks[len(toks)-1].Kind != TokEOF {
				t.Fatalf("expected trailing EOF token, got %v", toks)
			}
		})
	}
}

func TestIrregularLexTracksPositionsAcrossLines(t *testing.T) {
	t.Parallel()

	_, ds := Tokenize("<test>", "@\n@\n!")
	if len(ds) != 3 {
		t.Fatalf("diagnostic count = %d, want 3", len(ds))
	}

	want := []struct {
		line int
		col  int
	}{
		{line: 1, col: 1},
		{line: 2, col: 1},
		{line: 3, col: 1},
	}
	for i, tc := range want {
		if ds[i].Line != tc.line || ds[i].Col != tc.col {
			t.Fatalf("diag[%d] position = %d:%d, want %d:%d", i, ds[i].Line, ds[i].Col, tc.line, tc.col)
		}
	}
}

func TestUnexpectedCharacterBurstIsCapped(t *testing.T) {
	t.Parallel()

	toks, ds := Tokenize("<test>", strings.Repeat("@", 1000))
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
	if len(toks) == 0 || toks[len(toks)-1].Kind != TokEOF {
		t.Fatalf("expected trailing EOF token, got %v", toks)
	}
}
