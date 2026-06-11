package lower

import "testing"

// ─── trimActionText invariants ────────────────────────────────────────────────

func TestTrimActionTextNil(t *testing.T) {
	if got := trimActionText(nil); got != nil {
		t.Errorf("trimActionText(nil) = %v, want nil", got)
	}
}

func TestTrimActionTextEmpty(t *testing.T) {
	s := ""
	got := trimActionText(&s)
	if got == nil {
		t.Fatal("trimActionText(&\"\") = nil, want non-nil")
	}
	if *got != "" {
		t.Errorf("trimActionText(&\"\") = %q, want %q", *got, "")
	}
}

func TestTrimActionTextNoTrailingNewline(t *testing.T) {
	s := "hello"
	got := trimActionText(&s)
	if got == nil || *got != "hello" {
		t.Errorf("trimActionText(%q) = %v, want %q", s, got, "hello")
	}
}

func TestTrimActionTextOneTrailingNewline(t *testing.T) {
	s := "hello\n"
	got := trimActionText(&s)
	if got == nil || *got != "hello" {
		t.Errorf("trimActionText(%q) = %v, want %q", s, got, "hello")
	}
}

func TestTrimActionTextTwoTrailingNewlines(t *testing.T) {
	// Only one trailing \n is stripped; the first remains (intentional blank line).
	s := "hello\n\n"
	got := trimActionText(&s)
	if got == nil || *got != "hello\n" {
		t.Errorf("trimActionText(%q) = %v, want %q", s, got, "hello\n")
	}
}
