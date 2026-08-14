package emit_test

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit"
)

// esc builds an HCL unicode escape (backslash, 'u', then the four hex digits)
// by concatenation, so the escape sequence never appears literally in this
// source file — writing it inline is an easy way to end up with a real control
// byte in the test data instead of the six characters under test.
func esc(hex string) string { return "\\" + "u" + hex }

func TestHCLQuote(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", `""`},
		{"plain ascii", "hello", `"hello"`},
		{"double quote", `say "hi"`, `"say \"hi\""`},
		{"backslash", `a\b`, `"a\\b"`},
		{"newline", "a\nb", `"a\nb"`},
		{"carriage return", "a\rb", `"a\rb"`},
		{"tab", "a\tb", `"a\tb"`},

		// Printable non-ASCII passes through verbatim — HCL source is UTF-8, and
		// escaping it would make canonical output unreadable for no benefit.
		{"non-ascii printable", "café 日本語", `"café 日本語"`},
		{"emoji (astral plane)", "ok 🎉", `"ok 🎉"`},

		// The reason this function exists (1/2): Go's %q renders these as \x01 and
		// \v, neither of which HCL's quoted-template grammar accepts. They must
		// come out as HCL's \uNNNN escape instead.
		{"control char NUL", "a\x00b", `"a` + esc("0000") + `b"`},
		{"control char SOH", "a\x01b", `"a` + esc("0001") + `b"`},
		{"vertical tab", "a\vb", `"a` + esc("000B") + `b"`},
		{"bell", "a\ab", `"a` + esc("0007") + `b"`},
		{"delete", "a\x7fb", `"a` + esc("007F") + `b"`},

		// The reason this function exists (2/2): an unescaped ${ or %{ would be
		// read as interpolation/directive syntax rather than as literal text.
		{"interpolation introducer", "cost: ${total}", `"cost: $${total}"`},
		{"directive introducer", "%{ if x }", `"%%{ if x }"`},
		{"lone dollar", "100$", `"100$"`},
		{"lone percent", "50%", `"50%"`},
		{"dollar not before brace", "a$b", `"a$b"`},
		{"already-doubled dollar brace", "$${x}", `"$$${x}"`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := emit.HCLQuote(tc.in); got != tc.want {
				t.Errorf("HCLQuote(%q) = %s, want %s", tc.in, got, tc.want)
			}
		})
	}
}

// TestHCLQuoteEmitsNoGoOnlyEscapes guards the specific regression: no rune may
// be rendered with an escape that Go's %q defines but HCL's quoted-template
// grammar does not.
func TestHCLQuoteEmitsNoGoOnlyEscapes(t *testing.T) {
	goOnly := []string{`\x`, `\v`, `\a`, `\b`, `\f`}
	for r := rune(0); r < 0x100; r++ {
		got := emit.HCLQuote(string(r))
		for _, esc := range goOnly {
			if strings.Contains(got, esc) {
				t.Errorf("HCLQuote(%U) = %s, contains Go-only escape %s", r, got, esc)
			}
		}
	}
}

// TestHCLQuoteInvalidUTF8 pins the behaviour for byte sequences that are not
// valid UTF-8: they become the replacement character rather than a byte escape
// that HCL cannot express.
func TestHCLQuoteInvalidUTF8(t *testing.T) {
	got := emit.HCLQuote("a\xffb")
	want := "\"a�b\""
	if got != want {
		t.Errorf("HCLQuote(invalid utf-8) = %s, want %s", got, want)
	}
}
