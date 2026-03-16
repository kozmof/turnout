package lexer

import (
	"os"
	"testing"
)

// ── helpers ──────────────────────────────────────────────────────────────────

func mustTokenize(t *testing.T, src string) []Token {
	t.Helper()
	toks, ds := Tokenize("<test>", src)
	if ds.HasErrors() {
		t.Fatalf("unexpected lex errors: %v", ds)
	}
	return toks
}

func kinds(toks []Token) []TokenKind {
	ks := make([]TokenKind, len(toks))
	for i, tok := range toks {
		ks[i] = tok.Kind
	}
	return ks
}

func values(toks []Token) []string {
	vs := make([]string, len(toks))
	for i, tok := range toks {
		vs[i] = tok.Value
	}
	return vs
}

// filterEOF strips the trailing TokEOF for readability in table tests.
func filterEOF(toks []Token) []Token {
	if len(toks) > 0 && toks[len(toks)-1].Kind == TokEOF {
		return toks[:len(toks)-1]
	}
	return toks
}

// ── punctuation and operators ─────────────────────────────────────────────────

func TestPunctuation(t *testing.T) {
	toks := filterEOF(mustTokenize(t, "{ } [ ] ( ) , : . | + &"))
	want := []TokenKind{
		TokLBrace, TokRBrace, TokLBracket, TokRBracket,
		TokLParen, TokRParen, TokComma, TokColon, TokDot,
		TokPipe, TokPlus, TokAmpersand,
	}
	if len(toks) != len(want) {
		t.Fatalf("got %d tokens, want %d: %v", len(toks), len(want), kinds(toks))
	}
	for i, k := range want {
		if toks[i].Kind != k {
			t.Errorf("toks[%d]: got %v, want %v", i, toks[i].Kind, k)
		}
	}
}

func TestOperators(t *testing.T) {
	cases := []struct {
		src  string
		kind TokenKind
		val  string
	}{
		{"=", TokEquals, "="},
		{"=>", TokArrow, "=>"},
		{">=", TokGTE, ">="},
		{"<=", TokLTE, "<="},
	}
	for _, tc := range cases {
		toks := filterEOF(mustTokenize(t, tc.src))
		if len(toks) != 1 || toks[0].Kind != tc.kind || toks[0].Value != tc.val {
			t.Errorf("src=%q: got %v %q, want %v %q", tc.src, toks[0].Kind, toks[0].Value, tc.kind, tc.val)
		}
	}
}

// ── sigils ────────────────────────────────────────────────────────────────────

func TestSigils(t *testing.T) {
	cases := []struct {
		src  string
		kind TokenKind
		val  string
	}{
		{"<~>", TokSigilBiDir, "<~>"},
		{"<~", TokSigilEgress, "<~"},
		{"~>", TokSigilIngress, "~>"},
	}
	for _, tc := range cases {
		toks := filterEOF(mustTokenize(t, tc.src))
		if len(toks) != 1 || toks[0].Kind != tc.kind || toks[0].Value != tc.val {
			t.Errorf("src=%q: got kind=%v val=%q", tc.src, toks[0].Kind, toks[0].Value)
		}
	}
}

func TestSigilLongestMatch(t *testing.T) {
	// <~> must be preferred over <~
	toks := filterEOF(mustTokenize(t, "<~>income"))
	if toks[0].Kind != TokSigilBiDir {
		t.Errorf("expected TokSigilBiDir, got %v", toks[0].Kind)
	}
	if toks[1].Kind != TokIdent || toks[1].Value != "income" {
		t.Errorf("expected TokIdent(income), got %v %q", toks[1].Kind, toks[1].Value)
	}
}

func TestSigilTypedKey(t *testing.T) {
	// ~>income:number = _
	toks := filterEOF(mustTokenize(t, "~>income:number = _"))
	wantKinds := []TokenKind{
		TokSigilIngress, TokIdent, TokColon, TokIdent, TokEquals, TokUnderscore,
	}
	wantVals := []string{"~>", "income", ":", "number", "=", "_"}
	for i, k := range wantKinds {
		if toks[i].Kind != k {
			t.Errorf("toks[%d]: got kind %v, want %v", i, toks[i].Kind, k)
		}
		if toks[i].Value != wantVals[i] {
			t.Errorf("toks[%d]: got val %q, want %q", i, toks[i].Value, wantVals[i])
		}
	}
}

// ── types ─────────────────────────────────────────────────────────────────────

func TestArrType(t *testing.T) {
	cases := []string{"arr<number>", "arr<str>", "arr<bool>"}
	for _, tc := range cases {
		toks := filterEOF(mustTokenize(t, tc))
		if len(toks) != 1 || toks[0].Kind != TokType || toks[0].Value != tc {
			t.Errorf("src=%q: got kind=%v val=%q", tc, toks[0].Kind, toks[0].Value)
		}
	}
}

func TestScalarTypeAsIdent(t *testing.T) {
	// number, str, bool are NOT keywords — they lex as TokIdent
	for _, word := range []string{"number", "str", "bool"} {
		toks := filterEOF(mustTokenize(t, word))
		if len(toks) != 1 || toks[0].Kind != TokIdent {
			t.Errorf("%q: expected TokIdent, got %v", word, toks[0].Kind)
		}
	}
}

func TestTypedKeyWithArr(t *testing.T) {
	// xs:arr<number> = [1, 2]
	toks := filterEOF(mustTokenize(t, `xs:arr<number> = [1, 2]`))
	wantKinds := []TokenKind{
		TokIdent, TokColon, TokType, TokEquals, TokLBracket,
		TokNumberLit, TokComma, TokNumberLit, TokRBracket,
	}
	for i, k := range wantKinds {
		if toks[i].Kind != k {
			t.Errorf("toks[%d]: got %v, want %v", i, toks[i].Kind, k)
		}
	}
	if toks[2].Value != "arr<number>" {
		t.Errorf("expected arr<number>, got %q", toks[2].Value)
	}
}

// ── literals ──────────────────────────────────────────────────────────────────

func TestBoolLiteral(t *testing.T) {
	for _, word := range []string{"true", "false"} {
		toks := filterEOF(mustTokenize(t, word))
		if len(toks) != 1 || toks[0].Kind != TokBoolLit || toks[0].Value != word {
			t.Errorf("%q: got kind=%v val=%q", word, toks[0].Kind, toks[0].Value)
		}
	}
}

func TestNumberLiterals(t *testing.T) {
	cases := []struct{ src, val string }{
		{"0", "0"},
		{"42", "42"},
		{"50000", "50000"},
		{"3.14", "3.14"},
		{"0.5", "0.5"},
	}
	for _, tc := range cases {
		toks := filterEOF(mustTokenize(t, tc.src))
		if len(toks) != 1 || toks[0].Kind != TokNumberLit || toks[0].Value != tc.val {
			t.Errorf("%q: got kind=%v val=%q", tc.src, toks[0].Kind, toks[0].Value)
		}
	}
}

func TestStringLiteral(t *testing.T) {
	cases := []struct{ src, want string }{
		{`"hello"`, "hello"},
		{`"APR-"`, "APR-"},
		{`"first-match"`, "first-match"},
		{`"0001"`, "0001"},
		{`"\n"`, "\n"},
		{`"\t"`, "\t"},
		{`"\""`, "\""},
	}
	for _, tc := range cases {
		toks := filterEOF(mustTokenize(t, tc.src))
		if len(toks) != 1 || toks[0].Kind != TokStringLit || toks[0].Value != tc.want {
			t.Errorf("%q: got kind=%v val=%q, want %q", tc.src, toks[0].Kind, toks[0].Value, tc.want)
		}
	}
}

// ── underscore ────────────────────────────────────────────────────────────────

func TestUnderscore(t *testing.T) {
	// standalone _ is TokUnderscore
	toks := filterEOF(mustTokenize(t, "_"))
	if len(toks) != 1 || toks[0].Kind != TokUnderscore {
		t.Errorf("expected TokUnderscore, got %v", toks[0].Kind)
	}
}

func TestUnderscorePrefixedIdent(t *testing.T) {
	// _foo is TokIdent, __reserved is TokIdent
	for _, src := range []string{"_foo", "__reserved", "_1"} {
		toks := filterEOF(mustTokenize(t, src))
		if len(toks) != 1 || toks[0].Kind != TokIdent || toks[0].Value != src {
			t.Errorf("%q: got kind=%v val=%q", src, toks[0].Kind, toks[0].Value)
		}
	}
}

// ── special forms ─────────────────────────────────────────────────────────────

func TestHashPipe(t *testing.T) {
	toks := filterEOF(mustTokenize(t, "#pipe"))
	if len(toks) != 1 || toks[0].Kind != TokHashPipe {
		t.Errorf("expected TokHashPipe, got %v", toks[0].Kind)
	}
}

func TestHashIf(t *testing.T) {
	toks := filterEOF(mustTokenize(t, "#if"))
	if len(toks) != 1 || toks[0].Kind != TokHashIf {
		t.Errorf("expected TokHashIf, got %v", toks[0].Kind)
	}
}

func TestHashComment(t *testing.T) {
	// A comment produces no tokens
	toks := filterEOF(mustTokenize(t, "# this is a comment\nfoo"))
	if len(toks) != 1 || toks[0].Kind != TokIdent || toks[0].Value != "foo" {
		t.Errorf("expected single TokIdent(foo) after comment, got %v", toks)
	}
}

func TestHashPipeNotComment(t *testing.T) {
	// #pipe followed by ( is TokHashPipe, not a comment
	toks := filterEOF(mustTokenize(t, "#pipe(x:v)"))
	if toks[0].Kind != TokHashPipe {
		t.Errorf("expected TokHashPipe, got %v", toks[0].Kind)
	}
}

// ── keywords ──────────────────────────────────────────────────────────────────

func TestKeywords(t *testing.T) {
	cases := []struct {
		src  string
		kind TokenKind
	}{
		{"state", TokKwState},
		{"state_file", TokKwStateFile},
		{"scene", TokKwScene},
		{"action", TokKwAction},
		{"compute", TokKwCompute},
		{"prepare", TokKwPrepare},
		{"merge", TokKwMerge},
		{"publish", TokKwPublish},
		{"next", TokKwNext},
		{"prog", TokKwProg},
		{"root", TokKwRoot},
		{"condition", TokKwCondition},
		{"entry_actions", TokKwEntryActions},
		{"next_policy", TokKwNextPolicy},
		{"from_state", TokKwFromState},
		{"from_action", TokKwFromAction},
		{"from_hook", TokKwFromHook},
		{"from_literal", TokKwFromLiteral},
		{"to_state", TokKwToState},
		{"hook", TokKwHook},
		{"view", TokKwView},
		{"flow", TokKwFlow},
		{"enforce", TokKwEnforce},
		{"text", TokKwText},
	}
	for _, tc := range cases {
		toks := filterEOF(mustTokenize(t, tc.src))
		if len(toks) != 1 || toks[0].Kind != tc.kind {
			t.Errorf("%q: got kind=%v, want %v", tc.src, toks[0].Kind, tc.kind)
		}
	}
}

// ── heredoc ───────────────────────────────────────────────────────────────────

func TestHeredoc(t *testing.T) {
	src := "flow = <<-EOT\n  hello\n  world\nEOT\n"
	toks := filterEOF(mustTokenize(t, src))
	// expect: TokKwFlow, TokEquals, TokHeredoc
	if len(toks) != 3 {
		t.Fatalf("expected 3 tokens, got %d: %v", len(toks), toks)
	}
	if toks[2].Kind != TokHeredoc {
		t.Errorf("expected TokHeredoc, got %v", toks[2].Kind)
	}
	want := "hello\nworld"
	if toks[2].Value != want {
		t.Errorf("heredoc body: got %q, want %q", toks[2].Value, want)
	}
}

func TestHeredocIndentStrip(t *testing.T) {
	// The <<- form strips common leading whitespace
	src := "x = <<-EOT\n    line1\n    line2\n  EOT\n"
	toks := filterEOF(mustTokenize(t, src))
	hd := toks[len(toks)-1]
	if hd.Kind != TokHeredoc {
		t.Fatalf("last token is not TokHeredoc: %v", hd)
	}
	// Both lines have 4 spaces; common indent = 4 → stripped
	want := "line1\nline2"
	if hd.Value != want {
		t.Errorf("got %q, want %q", hd.Value, want)
	}
}

// ── triple-quoted strings ─────────────────────────────────────────────────────

func TestTripleQuote(t *testing.T) {
	src := `"""
Logic overview:
- step one
- step two
"""`
	toks := filterEOF(mustTokenize(t, src))
	if len(toks) != 1 || toks[0].Kind != TokTripleQuote {
		t.Fatalf("expected single TokTripleQuote, got %v", toks)
	}
	want := "Logic overview:\n- step one\n- step two"
	if toks[0].Value != want {
		t.Errorf("got %q, want %q", toks[0].Value, want)
	}
}

// ── disambiguation: single-ref form vs literal vs infix ───────────────────────

func TestDisambiguationInfix(t *testing.T) {
	// income_ok:bool = income >= min_income
	toks := filterEOF(mustTokenize(t, "income_ok:bool = income >= min_income"))
	wantKinds := []TokenKind{
		TokIdent, TokColon, TokIdent, TokEquals,
		TokIdent, TokGTE, TokIdent,
	}
	if len(toks) != len(wantKinds) {
		t.Fatalf("got %d tokens, want %d", len(toks), len(wantKinds))
	}
	for i, k := range wantKinds {
		if toks[i].Kind != k {
			t.Errorf("toks[%d]: got %v, want %v", i, toks[i].Kind, k)
		}
	}
}

func TestDisambiguationFuncCall(t *testing.T) {
	// sum:number = add(v1, v2)
	toks := filterEOF(mustTokenize(t, "sum:number = add(v1, v2)"))
	wantKinds := []TokenKind{
		TokIdent, TokColon, TokIdent, TokEquals,
		TokIdent, TokLParen, TokIdent, TokComma, TokIdent, TokRParen,
	}
	for i, k := range wantKinds {
		if toks[i].Kind != k {
			t.Errorf("toks[%d]: got %v, want %v", i, toks[i].Kind, k)
		}
	}
}

// ── line/col tracking ─────────────────────────────────────────────────────────

func TestLineColTracking(t *testing.T) {
	src := "foo\nbar"
	toks := filterEOF(mustTokenize(t, src))
	if toks[0].Line != 1 || toks[0].Col != 1 {
		t.Errorf("foo: want line=1 col=1, got line=%d col=%d", toks[0].Line, toks[0].Col)
	}
	if toks[1].Line != 2 || toks[1].Col != 1 {
		t.Errorf("bar: want line=2 col=1, got line=%d col=%d", toks[1].Line, toks[1].Col)
	}
}

func TestColTracking(t *testing.T) {
	toks := filterEOF(mustTokenize(t, "a b c"))
	for i, expectedCol := range []int{1, 3, 5} {
		if toks[i].Col != expectedCol {
			t.Errorf("toks[%d]: want col=%d, got col=%d", i, expectedCol, toks[i].Col)
		}
	}
}

// ── error cases ───────────────────────────────────────────────────────────────

func TestUnterminatedString(t *testing.T) {
	_, ds := Tokenize("<test>", `"unterminated`)
	if !ds.HasErrors() {
		t.Error("expected lex error for unterminated string, got none")
	}
}

func TestStandaloneLT(t *testing.T) {
	toks, ds := Tokenize("<test>", "x < y")
	if ds.HasErrors() {
		t.Errorf("unexpected lex error for standalone <: %v", ds)
	}
	// expect: IDENT(<) TokLT IDENT(y) EOF  — standalone < emits TokLT
	found := false
	for _, tok := range toks {
		if tok.Kind == TokLT {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected TokLT token for standalone <")
	}
}

func TestStandaloneGT(t *testing.T) {
	toks, ds := Tokenize("<test>", "x > y")
	if ds.HasErrors() {
		t.Errorf("unexpected lex error for standalone >: %v", ds)
	}
	// expect: IDENT(x) TokGT IDENT(y) EOF  — standalone > emits TokGT
	found := false
	for _, tok := range toks {
		if tok.Kind == TokGT {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected TokGT token for standalone >")
	}
}

// ── integration: real example files ──────────────────────────────────────────

func TestExampleFileSceneGraph(t *testing.T) {
	src, err := os.ReadFile("../../../../../spec/examples/scene-graph-with-actions.turn")
	if err != nil {
		t.Skipf("example file not found: %v", err)
	}
	toks, ds := Tokenize("scene-graph-with-actions.turn", string(src))
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("%s", d.Format())
		}
		t.FailNow()
	}
	if len(toks) == 0 {
		t.Fatal("no tokens produced")
	}
	// Spot-check: last token is EOF
	if toks[len(toks)-1].Kind != TokEOF {
		t.Errorf("last token is not TokEOF: %v", toks[len(toks)-1].Kind)
	}
}

func TestExampleFileDetective(t *testing.T) {
	src, err := os.ReadFile("../../../../../spec/examples/detective-phase.turn")
	if err != nil {
		t.Skipf("example file not found: %v", err)
	}
	toks, ds := Tokenize("detective-phase.turn", string(src))
	if ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("%s", d.Format())
		}
		t.FailNow()
	}
	if len(toks) == 0 {
		t.Fatal("no tokens produced")
	}
	if toks[len(toks)-1].Kind != TokEOF {
		t.Errorf("last token is not TokEOF: %v", toks[len(toks)-1].Kind)
	}
}
