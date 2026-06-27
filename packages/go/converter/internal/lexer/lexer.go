package lexer

import (
	"fmt"

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

	// Binding markers — designate the compute root / transition condition
	TokMarkerRoot // |^|  (compute root, action-level)
	TokMarkerCond // |?|  (transition condition, next-level)

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
	TokKwEntry
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
//
// Line endings are normalised before lexing: \r\n pairs and bare \r are both
// converted to \n so that the rest of the lexer only needs to handle \n and
// token positions are consistent regardless of the host OS line ending style.
func Tokenize(file, src string) ([]Token, diag.Diagnostics) {
	runes := normalizeLineEndings([]rune(src))
	l := &lex{
		file: file,
		src:  runes,
		line: 1,
		col:  1,
	}
	l.run()
	return l.toks, l.Flush()
}

// normalizeLineEndings converts \r\n and lone \r to \n in a rune slice.
// The returned slice may be the same slice as the input (no allocations) when
// no carriage-return characters are present, which is the common case.
func normalizeLineEndings(src []rune) []rune {
	hasCR := false
	for _, r := range src {
		if r == '\r' {
			hasCR = true
			break
		}
	}
	if !hasCR {
		return src
	}
	out := make([]rune, 0, len(src))
	for i := 0; i < len(src); i++ {
		if src[i] == '\r' {
			out = append(out, '\n')
			if i+1 < len(src) && src[i+1] == '\n' {
				i++ // skip the \n in \r\n
			}
		} else {
			out = append(out, src[i])
		}
	}
	return out
}

// ────────────────────────────────────────────────────────────
// Internal lexer state
// ────────────────────────────────────────────────────────────

type lex struct {
	file string
	src  []rune
	pos  int
	line int
	col  int
	toks []Token
	diag.DiagSink
}

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
	if l.IsHalted() {
		return
	}
	if l.AtCap() {
		l.Append(diag.ErrorAt(l.file, line, col, diag.CodeTooManyDiagnostics,
			"too many lexical errors; stopping after %d diagnostics", diag.MaxDiagnostics))
		l.pos = len(l.src) // stage-specific recovery: exhaust input
		l.Halt()
		return
	}
	l.Append(diag.ErrorAt(l.file, line, col, diag.CodeLexError, format, args...))
}

// ────────────────────────────────────────────────────────────
// Keyword table — single source of truth
// ────────────────────────────────────────────────────────────
//
// keywordTable drives both the lexer's keyword lookup (keywords map, built in
// init) and TokenName's display strings for keyword tokens. Adding a new keyword
// requires only a single entry here.

type keywordEntry struct {
	text string
	kind TokenKind
}

var keywordTable = []keywordEntry{
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
	{"route", TokKwRoute},
	{"match", TokKwMatch},
	{"entry", TokKwEntry},
}

// keywords is derived from keywordTable and used by scanIdent.
var keywords map[string]TokenKind

// tokenNames maps every TokenKind to its human-readable display string,
// used by TokenName. Keyword entries are derived from keywordTable.
var tokenNames map[TokenKind]string

func init() {
	keywords = make(map[string]TokenKind, len(keywordTable))
	tokenNames = map[TokenKind]string{
		TokEOF:          "EOF",
		TokIdent:        "IDENT",
		TokType:         "TYPE",
		TokStringLit:    "STRING",
		TokNumberLit:    "NUMBER",
		TokBoolLit:      "BOOL",
		TokSigilBiDir:   "<~>",
		TokSigilEgress:  "<~",
		TokSigilIngress: "~>",
		TokMarkerRoot:   "|^|",
		TokMarkerCond:   "|?|",
		TokLBrace:       "{",
		TokRBrace:       "}",
		TokLBracket:     "[",
		TokRBracket:     "]",
		TokLParen:       "(",
		TokRParen:       ")",
		TokComma:        ",",
		TokColon:        ":",
		TokEquals:       "=",
		TokDot:          ".",
		TokArrow:        "=>",
		TokPipe:         "|",
		TokAmpersand:    "&",
		TokGTE:          ">=",
		TokLTE:          "<=",
		TokGT:           ">",
		TokLT:           "<",
		TokPlus:         "+",
		TokMinus:        "-",
		TokStar:         "*",
		TokSlash:        "/",
		TokPercent:      "%",
		TokEqEq:         "==",
		TokNeq:          "!=",
		TokHashPipe:     "#pipe",
		TokHashIf:       "#if",
		TokHashCase:     "#case",
		TokHashIt:       "#it",
		TokUnderscore:   "_",
		TokHeredoc:      "HEREDOC",
		TokTripleQuote:  "TRIPLE_QUOTE",
	}
	for _, e := range keywordTable {
		keywords[e.text] = e.kind
		tokenNames[e.kind] = e.text
	}
}

// TokenName returns a human-readable display string for k (e.g. "state", "{",
// "IDENT"). Used by the parser when formatting syntax-error messages.
func TokenName(k TokenKind) string {
	if s, ok := tokenNames[k]; ok {
		return s
	}
	return fmt.Sprintf("token(%d)", int(k))
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
		if c == ' ' || c == '\t' || c == '\n' {
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

	case c == '^':
		l.advance()
		l.errorf(ln, co, "unexpected '^' — the compute-root marker is written '|^|'")

	case c == '?':
		l.advance()
		l.errorf(ln, co, "unexpected '?' — the transition-condition marker is written '|?|'")

	case c == ':':
		l.advance()
		l.emit(TokColon, ":", ln, co)

	case c == '|':
		// Binding markers |^| (compute root) and |?| (transition condition)
		// take precedence over the bare pipe operator.
		if l.peekAt(1) == '^' && l.peekAt(2) == '|' {
			l.advance()
			l.advance()
			l.advance()
			l.emit(TokMarkerRoot, "|^|", ln, co)
		} else if l.peekAt(1) == '?' && l.peekAt(2) == '|' {
			l.advance()
			l.advance()
			l.advance()
			l.emit(TokMarkerCond, "|?|", ln, co)
		} else {
			l.advance()
			l.emit(TokPipe, "|", ln, co)
		}

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
