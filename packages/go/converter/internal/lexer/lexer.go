package lexer

import (
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// TokenKind classifies a token produced by the Turn DSL lexer.
type TokenKind int

const (
	TokEOF       TokenKind = iota
	TokIdent               // bare identifier (not a keyword)
	TokType                // arr<number> | arr<str> | arr<bool>
	TokStringLit           // "..."
	TokNumberLit           // 42 | 3.14
	TokBoolLit             // true | false

	// Sigils — longest match first in source
	TokSigilBiDir   // <~>
	TokSigilEgress  // <~
	TokSigilIngress // ~>

	// Punctuation
	TokLBrace    // {
	TokRBrace    // }
	TokLBracket  // [
	TokRBracket  // ]
	TokLParen    // (
	TokRParen    // )
	TokComma     // ,
	TokColon     // :
	TokEquals    // =
	TokDot       // .
	TokArrow     // =>
	TokPipe      // |
	TokAmpersand // &
	TokGTE       // >=
	TokLTE       // <=
	TokPlus      // +
	TokMinus     // -
	TokStar      // *
	TokSlash     // /
	TokPercent   // %
	TokGT        // >  (standalone, not >=)
	TokLT        // <  (standalone, not <=, <~, <~>, <<-)
	TokEqEq      // ==
	TokNeq       // !=

	// Special forms
	TokHashPipe    // #pipe
	TokHashIf      // #if
	TokHashCase    // #case
	TokHashIt      // #it
	TokUnderscore  // _ (wildcard in #case patterns, fallback in route match)
	TokHeredoc     // <<-EOT...EOT  — Value holds stripped body
	TokTripleQuote // """..."""     — Value holds trimmed body

	// Keywords
	TokKwState
	TokKwStateFile
	TokKwScene
	TokKwAction
	TokKwCompute
	TokKwPrepare
	TokKwMerge
	TokKwPublish
	TokKwNext
	TokKwProg
	TokKwRoot
	TokKwCondition
	TokKwEntryActions
	TokKwNextPolicy
	TokKwFromState
	TokKwFromAction
	TokKwFromHook
	TokKwFromLiteral
	TokKwToState
	TokKwHook
	TokKwView
	TokKwFlow
	TokKwEnforce
	TokKwText
	TokKwRoute
	TokKwMatch
)

// Token is a single lexed token.
type Token struct {
	Kind  TokenKind
	Value string // raw text (or processed body for heredoc / triple-quote)
	Line  int
	Col   int
}

// Tokenize lexes the Turn DSL source src and returns the token stream.
// file is the source file name used in diagnostic positions.
func Tokenize(file, src string) ([]Token, diag.Diagnostics) {
	l := &lex{
		file: file,
		src:  []rune(src),
		line: 1,
		col:  1,
	}
	l.run()
	return l.toks, l.diags
}

// ────────────────────────────────────────────────────────────
// Internal lexer state
// ────────────────────────────────────────────────────────────

type lex struct {
	file   string
	src    []rune
	pos    int
	line   int
	col    int
	toks   []Token
	diags  diag.Diagnostics
	halted bool
}

const maxDiagnostics = 100

// pos snapshot for speculative scanning / backtracking
type snapshot struct{ pos, line, col int }

func (l *lex) save() snapshot     { return snapshot{l.pos, l.line, l.col} }
func (l *lex) restore(s snapshot) { l.pos = s.pos; l.line = s.line; l.col = s.col }

func (l *lex) atEnd() bool { return l.pos >= len(l.src) }

func (l *lex) peek() rune {
	if l.atEnd() {
		return 0
	}
	return l.src[l.pos]
}

func (l *lex) peekAt(n int) rune {
	if l.pos+n >= len(l.src) {
		return 0
	}
	return l.src[l.pos+n]
}

func (l *lex) advance() rune {
	if l.atEnd() {
		return 0
	}
	c := l.src[l.pos]
	l.pos++
	if c == '\n' {
		l.line++
		l.col = 1
	} else {
		l.col++
	}
	return c
}

func (l *lex) emit(kind TokenKind, value string, line, col int) {
	l.toks = append(l.toks, Token{Kind: kind, Value: value, Line: line, Col: col})
}

func (l *lex) errorf(line, col int, format string, args ...any) {
	if l.halted {
		return
	}
	if len(l.diags) >= maxDiagnostics {
		l.diags = append(l.diags, diag.ErrorAt(
			l.file,
			line,
			col,
			diag.CodeTooManyDiagnostics,
			"too many lexical errors; stopping after %d diagnostics",
			maxDiagnostics,
		))
		l.pos = len(l.src)
		l.halted = true
		return
	}
	l.diags = append(l.diags, diag.ErrorAt(l.file, line, col, "LexError", format, args...))
}

// ────────────────────────────────────────────────────────────
// Keyword table
// ────────────────────────────────────────────────────────────

var keywords = map[string]TokenKind{
	"state":         TokKwState,
	"state_file":    TokKwStateFile,
	"scene":         TokKwScene,
	"action":        TokKwAction,
	"compute":       TokKwCompute,
	"prepare":       TokKwPrepare,
	"merge":         TokKwMerge,
	"publish":       TokKwPublish,
	"next":          TokKwNext,
	"prog":          TokKwProg,
	"root":          TokKwRoot,
	"condition":     TokKwCondition,
	"entry_actions": TokKwEntryActions,
	"next_policy":   TokKwNextPolicy,
	"from_state":    TokKwFromState,
	"from_action":   TokKwFromAction,
	"from_hook":     TokKwFromHook,
	"from_literal":  TokKwFromLiteral,
	"to_state":      TokKwToState,
	"hook":          TokKwHook,
	"view":          TokKwView,
	"flow":          TokKwFlow,
	"enforce":       TokKwEnforce,
	"text":          TokKwText,
	"route":         TokKwRoute,
	"match":         TokKwMatch,
}

// ────────────────────────────────────────────────────────────
// Top-level scan loop
// ────────────────────────────────────────────────────────────

func (l *lex) run() {
	for {
		l.skipWhitespace()
		if l.atEnd() {
			break
		}
		l.scanToken()
	}
	l.emit(TokEOF, "", l.line, l.col)
}

func (l *lex) skipWhitespace() {
	for !l.atEnd() {
		c := l.peek()
		if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
			l.advance()
		} else {
			break
		}
	}
}

func (l *lex) scanToken() {
	ln, co := l.line, l.col
	c := l.peek()

	switch {
	case c == '{':
		l.advance()
		l.emit(TokLBrace, "{", ln, co)

	case c == '}':
		l.advance()
		l.emit(TokRBrace, "}", ln, co)

	case c == '[':
		l.advance()
		l.emit(TokLBracket, "[", ln, co)

	case c == ']':
		l.advance()
		l.emit(TokRBracket, "]", ln, co)

	case c == '(':
		l.advance()
		l.emit(TokLParen, "(", ln, co)

	case c == ')':
		l.advance()
		l.emit(TokRParen, ")", ln, co)

	case c == ',':
		l.advance()
		l.emit(TokComma, ",", ln, co)

	case c == '.':
		l.advance()
		l.emit(TokDot, ".", ln, co)

	case c == '+':
		l.advance()
		l.emit(TokPlus, "+", ln, co)

	case c == '-':
		l.advance()
		l.emit(TokMinus, "-", ln, co)

	case c == '*':
		l.advance()
		l.emit(TokStar, "*", ln, co)

	case c == '/':
		l.advance()
		l.emit(TokSlash, "/", ln, co)

	case c == '%':
		l.advance()
		l.emit(TokPercent, "%", ln, co)

	case c == '!':
		l.advance()
		if l.peek() == '=' {
			l.advance()
			l.emit(TokNeq, "!=", ln, co)
		} else {
			l.errorf(ln, co, "unexpected '!' — did you mean '!='?")
		}

	case c == '&':
		l.advance()
		l.emit(TokAmpersand, "&", ln, co)

	case c == ':':
		l.advance()
		l.emit(TokColon, ":", ln, co)

	case c == '|':
		l.advance()
		l.emit(TokPipe, "|", ln, co)

	case c == '=':
		l.advance()
		if l.peek() == '>' {
			l.advance()
			l.emit(TokArrow, "=>", ln, co)
		} else if l.peek() == '=' {
			l.advance()
			l.emit(TokEqEq, "==", ln, co)
		} else {
			l.emit(TokEquals, "=", ln, co)
		}

	case c == '>':
		l.advance()
		if l.peek() == '=' {
			l.advance()
			l.emit(TokGTE, ">=", ln, co)
		} else {
			l.emit(TokGT, ">", ln, co)
		}

	case c == '<':
		l.scanLAngle(ln, co)

	case c == '~':
		if l.peekAt(1) == '>' {
			l.advance()
			l.advance()
			l.emit(TokSigilIngress, "~>", ln, co)
		} else {
			l.advance()
			l.errorf(ln, co, "unexpected '~' — expected '~>'")
		}

	case c == '"':
		l.scanQuotedString(ln, co)

	case c == '#':
		l.scanHash(ln, co)

	case c == '_':
		// Standalone placeholder unless immediately followed by an ident char.
		if isIdentChar(l.peekAt(1)) {
			l.scanIdent(ln, co)
		} else {
			l.advance()
			l.emit(TokUnderscore, "_", ln, co)
		}

	case isDigit(c):
		l.scanNumber(ln, co)

	case isIdentStart(c):
		l.scanIdent(ln, co)

	default:
		l.advance()
		l.errorf(ln, co, "unexpected character %q", c)
	}
}

// ────────────────────────────────────────────────────────────
// < — heredoc, sigils, <=
// ────────────────────────────────────────────────────────────

func (l *lex) scanLAngle(ln, co int) {
	c1 := l.peekAt(1)
	c2 := l.peekAt(2)
	switch {
	case c1 == '<' && c2 == '-':
		l.scanHeredoc(ln, co)
	case c1 == '~' && c2 == '>':
		l.advance()
		l.advance()
		l.advance()
		l.emit(TokSigilBiDir, "<~>", ln, co)
	case c1 == '~':
		l.advance()
		l.advance()
		l.emit(TokSigilEgress, "<~", ln, co)
	case c1 == '=':
		l.advance()
		l.advance()
		l.emit(TokLTE, "<=", ln, co)
	default:
		l.advance()
		l.emit(TokLT, "<", ln, co)
	}
}

// ────────────────────────────────────────────────────────────
// Heredoc  <<-DELIM\n...\nDELIM
// ────────────────────────────────────────────────────────────

func (l *lex) scanHeredoc(ln, co int) {
	// Consume <<-
	l.advance()
	l.advance()
	l.advance()

	// Read delimiter identifier (rest of opening line)
	var delimBuf strings.Builder
	for !l.atEnd() && l.peek() != '\n' && l.peek() != '\r' {
		delimBuf.WriteRune(l.advance())
	}
	delim := strings.TrimSpace(delimBuf.String())
	if delim == "" {
		l.errorf(ln, co, "heredoc missing delimiter identifier")
		return
	}

	// Consume the newline after the delimiter marker
	if l.peek() == '\r' {
		l.advance()
	}
	if l.peek() == '\n' {
		l.advance()
	}

	// Collect body lines until a line whose trimmed content equals delim
	var rawLines []string
	for !l.atEnd() {
		var lineBuf strings.Builder
		for !l.atEnd() && l.peek() != '\n' && l.peek() != '\r' {
			lineBuf.WriteRune(l.advance())
		}
		// consume CRLF / LF
		if l.peek() == '\r' {
			l.advance()
		}
		if l.peek() == '\n' {
			l.advance()
		}
		lineStr := lineBuf.String()
		if strings.TrimSpace(lineStr) == delim {
			break // end-of-heredoc marker reached
		}
		rawLines = append(rawLines, lineStr)
	}

	// <<- strips common leading whitespace from body lines
	minIndent := -1
	for _, rl := range rawLines {
		if strings.TrimSpace(rl) == "" {
			continue
		}
		indent := 0
		for _, ch := range rl {
			if ch == ' ' || ch == '\t' {
				indent++
			} else {
				break
			}
		}
		if minIndent < 0 || indent < minIndent {
			minIndent = indent
		}
	}
	if minIndent < 0 {
		minIndent = 0
	}

	var body strings.Builder
	for i, rl := range rawLines {
		if i > 0 {
			body.WriteByte('\n')
		}
		if len([]rune(rl)) >= minIndent {
			body.WriteString(string([]rune(rl)[minIndent:]))
		} else {
			body.WriteString(rl)
		}
	}

	l.emit(TokHeredoc, body.String(), ln, co)
}

// ────────────────────────────────────────────────────────────
// String literals: "..." and """..."""
// ────────────────────────────────────────────────────────────

func (l *lex) scanQuotedString(ln, co int) {
	if l.peekAt(1) == '"' && l.peekAt(2) == '"' {
		l.scanTripleQuote(ln, co)
		return
	}
	l.advance() // consume opening "
	var sb strings.Builder
	for !l.atEnd() {
		c := l.peek()
		if c == '"' {
			l.advance()
			l.emit(TokStringLit, sb.String(), ln, co)
			return
		}
		if c == '\n' || c == '\r' {
			l.errorf(ln, co, "unterminated string literal")
			return
		}
		if c == '\\' {
			l.advance()
			esc := l.advance()
			switch esc {
			case 'n':
				sb.WriteByte('\n')
			case 't':
				sb.WriteByte('\t')
			case 'r':
				sb.WriteByte('\r')
			case '"':
				sb.WriteByte('"')
			case '\\':
				sb.WriteByte('\\')
			default:
				sb.WriteByte('\\')
				sb.WriteRune(esc)
			}
		} else {
			sb.WriteRune(l.advance())
		}
	}
	// Reached EOF without closing quote
	l.errorf(ln, co, "unterminated string literal")
}

func (l *lex) scanTripleQuote(ln, co int) {
	l.advance()
	l.advance()
	l.advance() // consume """

	// Trim one leading newline per spec
	if l.peek() == '\r' {
		l.advance()
	}
	if l.peek() == '\n' {
		l.advance()
	}

	var sb strings.Builder
	closed := false
	for !l.atEnd() {
		if l.peek() == '"' && l.peekAt(1) == '"' && l.peekAt(2) == '"' {
			l.advance()
			l.advance()
			l.advance() // consume closing """
			closed = true
			break
		}
		sb.WriteRune(l.advance())
	}
	if !closed {
		l.errorf(ln, co, "unterminated triple-quoted string")
		return
	}

	// Trim one trailing newline per spec
	content := sb.String()
	if strings.HasSuffix(content, "\r\n") {
		content = content[:len(content)-2]
	} else if strings.HasSuffix(content, "\n") {
		content = content[:len(content)-1]
	}

	l.emit(TokTripleQuote, content, ln, co)
}

// ────────────────────────────────────────────────────────────
// # — comment, #pipe, #if
// ────────────────────────────────────────────────────────────

func (l *lex) scanHash(ln, co int) {
	if l.matchPrefix("#pipe") && !isIdentChar(l.peekAt(5)) {
		for range 5 {
			l.advance()
		}
		l.emit(TokHashPipe, "#pipe", ln, co)
		return
	}
	if l.matchPrefix("#case") && !isIdentChar(l.peekAt(5)) {
		for range 5 {
			l.advance()
		}
		l.emit(TokHashCase, "#case", ln, co)
		return
	}
	if l.matchPrefix("#if") && !isIdentChar(l.peekAt(3)) {
		for range 3 {
			l.advance()
		}
		l.emit(TokHashIf, "#if", ln, co)
		return
	}
	if l.matchPrefix("#it") && !isIdentChar(l.peekAt(3)) {
		for range 3 {
			l.advance()
		}
		l.emit(TokHashIt, "#it", ln, co)
		return
	}
	// Line comment — skip to end of line
	for !l.atEnd() && l.peek() != '\n' {
		l.advance()
	}
}

// matchPrefix checks if the runes at the current position exactly spell s.
func (l *lex) matchPrefix(s string) bool {
	runes := []rune(s)
	for i, r := range runes {
		if l.pos+i >= len(l.src) || l.src[l.pos+i] != r {
			return false
		}
	}
	return true
}

// ────────────────────────────────────────────────────────────
// Number literals
// ────────────────────────────────────────────────────────────

func (l *lex) scanNumber(ln, co int) {
	var sb strings.Builder
	for !l.atEnd() && isDigit(l.peek()) {
		sb.WriteRune(l.advance())
	}
	// Optional decimal part: only consume '.' if followed by a digit
	if !l.atEnd() && l.peek() == '.' && isDigit(l.peekAt(1)) {
		sb.WriteRune(l.advance()) // '.'
		for !l.atEnd() && isDigit(l.peek()) {
			sb.WriteRune(l.advance())
		}
	}
	l.emit(TokNumberLit, sb.String(), ln, co)
}

// ────────────────────────────────────────────────────────────
// Identifiers, keywords, and type tokens (arr<T>)
// ────────────────────────────────────────────────────────────

func (l *lex) scanIdent(ln, co int) {
	var sb strings.Builder
	for !l.atEnd() && isIdentChar(l.peek()) {
		sb.WriteRune(l.advance())
	}
	value := sb.String()

	// arr<T> — composite type token; only if '<' immediately follows (no space)
	if value == "arr" && !l.atEnd() && l.peek() == '<' {
		if inner := l.tryScanTypeParam(); inner != "" {
			l.emit(TokType, "arr<"+inner+">", ln, co)
			return
		}
	}

	// Bool literals
	if value == "true" || value == "false" {
		l.emit(TokBoolLit, value, ln, co)
		return
	}

	// Keywords
	if kind, ok := keywords[value]; ok {
		l.emit(kind, value, ln, co)
		return
	}

	l.emit(TokIdent, value, ln, co)
}

// tryScanTypeParam attempts to consume <number|str|bool> at the current
// position. Returns the inner type string on success, "" on failure (and
// restores the lexer position).
func (l *lex) tryScanTypeParam() string {
	snap := l.save()
	l.advance() // consume '<'

	var inner strings.Builder
	for !l.atEnd() && l.peek() != '>' && l.peek() != '\n' {
		inner.WriteRune(l.advance())
	}

	innerStr := inner.String()
	if !l.atEnd() && l.peek() == '>' &&
		(innerStr == "number" || innerStr == "str" || innerStr == "bool") {
		l.advance() // consume '>'
		return innerStr
	}

	l.restore(snap)
	return ""
}

// ────────────────────────────────────────────────────────────
// Character classification helpers
// ────────────────────────────────────────────────────────────

func isDigit(c rune) bool {
	return c >= '0' && c <= '9'
}

func isIdentStart(c rune) bool {
	return c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func isIdentChar(c rune) bool {
	return isIdentStart(c) || isDigit(c)
}
