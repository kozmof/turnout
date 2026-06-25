package lexer

import "strings"

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
	foundDelim := false
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
			foundDelim = true
			break // end-of-heredoc marker reached
		}
		rawLines = append(rawLines, lineStr)
	}
	if !foundDelim {
		l.errorf(ln, co, "unterminated heredoc: reached end of file without closing %q delimiter", delim)
		return
	}

	// <<- strips common leading whitespace from body lines.
	// Tabs and spaces both count as one indent unit (no tab-stop expansion).
	// Authors should use consistent indentation within a heredoc.
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
		// Use rune slicing so multi-byte leading characters are handled correctly.
		rlRunes := []rune(rl)
		if len(rlRunes) >= minIndent {
			body.WriteString(string(rlRunes[minIndent:]))
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

	// Trim one trailing newline per spec. Note: if the content itself ends with
	// \n before the closing """, one \n remains after this strip; lower.trimActionText
	// removes that second trailing \n for action text values.
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
	if l.tryHashKeyword("#pipe", TokHashPipe, ln, co) {
		return
	}
	if l.tryHashKeyword("#case", TokHashCase, ln, co) {
		return
	}
	if l.tryHashKeyword("#if", TokHashIf, ln, co) {
		return
	}
	if l.tryHashKeyword("#it", TokHashIt, ln, co) {
		return
	}
	// Line comment — skip to end of line
	for !l.atEnd() && l.peek() != '\n' {
		l.advance()
	}
}

// tryHashKeyword checks whether prefix matches at the current position and is
// not followed by an identifier character (preventing "#ifoo" from being lexed
// as TokHashIf + "oo"). On match it advances past the prefix, emits kind, and
// returns true. The check and advance are merged into one pass over the runes.
func (l *lex) tryHashKeyword(prefix string, kind TokenKind, ln, co int) bool {
	runes := []rune(prefix)
	n := len(runes)
	for i, r := range runes {
		if l.pos+i >= len(l.src) || l.src[l.pos+i] != r {
			return false
		}
	}
	if isIdentChar(l.peekAt(n)) {
		return false
	}
	for range n {
		l.advance()
	}
	l.emit(kind, prefix, ln, co)
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
