package emit

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// hclQuote returns s as an HCL quoted-template literal, including the surrounding
// double quotes.
//
// This exists because `fmt.Sprintf("%q", …)` — which this package used previously
// — produces *Go* string syntax, which overlaps with but is not the same as HCL's:
//
//   - Go escapes non-printable bytes as \x01 and \v. HCL's quoted-template grammar
//     accepts neither; the only numeric escapes it defines are \uNNNN and
//     \UNNNNNNNN. The Turn lexer passes a raw control byte inside a string literal
//     straight through to the model (only \n and \r terminate a string), so `%q`
//     could emit HCL that no HCL parser would read back.
//   - Neither Go nor `%q` knows about HCL template interpolation. A literal
//     containing `${` or `%{` must be written `$${` / `%%{`, or a consumer parses
//     it as an interpolation/directive instead of as text.
//
// Escaping rules applied here, matching HCL's quoted-template grammar:
//
//	\  "  → backslash-escaped
//	\n \r \t → their short forms
//	${ %{ → $${ , %%{ (interpolation and directive introducers)
//	any other non-printable rune → \uNNNN (or \UNNNNNNNN beyond the BMP)
//	printable runes (including non-ASCII) → passed through verbatim
func hclQuote(s string) string {
	var b strings.Builder
	// Quotes plus a little slack for escapes; exact size is not important.
	b.Grow(len(s) + 2)
	b.WriteByte('"')

	for i := 0; i < len(s); {
		// Interpolation and directive introducers are two-byte sequences that must
		// be doubled rather than backslash-escaped.
		if s[i] == '$' && i+1 < len(s) && s[i+1] == '{' {
			b.WriteString("$${")
			i += 2
			continue
		}
		if s[i] == '%' && i+1 < len(s) && s[i+1] == '{' {
			b.WriteString("%%{")
			i += 2
			continue
		}

		r, size := utf8.DecodeRuneInString(s[i:])
		i += size

		switch r {
		case '\\':
			b.WriteString(`\\`)
			continue
		case '"':
			b.WriteString(`\"`)
			continue
		case '\n':
			b.WriteString(`\n`)
			continue
		case '\r':
			b.WriteString(`\r`)
			continue
		case '\t':
			b.WriteString(`\t`)
			continue
		}

		// RuneError with size 1 means invalid UTF-8; emit the replacement char
		// rather than a byte escape HCL cannot express.
		if r == utf8.RuneError && size == 1 {
			b.WriteString(`�`)
			continue
		}

		if unicode.IsPrint(r) {
			b.WriteRune(r)
			continue
		}

		// Remaining non-printables have no short form; use HCL's unicode escapes.
		if r > 0xFFFF {
			writeHexEscape(&b, `\U`, uint32(r), 8)
		} else {
			writeHexEscape(&b, `\u`, uint32(r), 4)
		}
	}

	b.WriteByte('"')
	return b.String()
}

const hexDigits = "0123456789ABCDEF"

// writeHexEscape appends prefix followed by v as exactly width uppercase hex digits.
func writeHexEscape(b *strings.Builder, prefix string, v uint32, width int) {
	b.WriteString(prefix)
	for shift := (width - 1) * 4; shift >= 0; shift -= 4 {
		b.WriteByte(hexDigits[(v>>uint(shift))&0xF])
	}
}
