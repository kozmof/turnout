package names_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/names"
)

func TestLocalName(t *testing.T) {
	cases := []struct {
		target, hint string
		counter      int
		want         string
	}{
		{"foo", "bar", 0, "__local_foo_bar_0"},
		{"x", "y", 42, "__local_x_y_42"},
		{"action", "cond", 1, "__local_action_cond_1"},
	}
	for _, c := range cases {
		got := names.LocalName(c.target, c.hint, c.counter)
		if got != c.want {
			t.Errorf("LocalName(%q, %q, %d) = %q; want %q", c.target, c.hint, c.counter, got, c.want)
		}
	}
}

func TestIsGeneratedLocalName(t *testing.T) {
	cases := []struct {
		input string
		want  bool
	}{
		{"__local_foo_bar_0", true},
		{"__local_x_y_42", true},
		// exactly the prefix — length not > len(prefix)
		{"__local_", false},
		// plain names
		{"foo", false},
		{"", false},
		// prefix without trailing underscore
		{"__local", false},
		// prefix of a different generated form
		{"__if_foo_cond", false},
	}
	for _, c := range cases {
		got := names.IsGeneratedLocalName(c.input)
		if got != c.want {
			t.Errorf("IsGeneratedLocalName(%q) = %v; want %v", c.input, got, c.want)
		}
	}
}

func TestSplitStatePath(t *testing.T) {
	cases := []struct {
		key               string
		wantNs, wantField string
		wantOk            bool
	}{
		{"ns.field", "ns", "field", true},
		// first dot only — remainder stays as field
		{"a.b.c", "a", "b.c", true},
		{"noDot", "", "", false},
		{"", "", "", false},
		// leading dot
		{".field", "", "field", true},
	}
	for _, c := range cases {
		gotNs, gotField, gotOk := names.SplitStatePath(c.key)
		if gotNs != c.wantNs || gotField != c.wantField || gotOk != c.wantOk {
			t.Errorf("SplitStatePath(%q) = (%q, %q, %v); want (%q, %q, %v)",
				c.key, gotNs, gotField, gotOk, c.wantNs, c.wantField, c.wantOk)
		}
	}
}

func TestIsGeneratedIfCondName(t *testing.T) {
	// len("__if_") = 5, len("_cond") = 5; condition: len > 10
	cases := []struct {
		input string
		want  bool
	}{
		// valid: len 13 > 10
		{"__if_foo_cond", true},
		// valid: len 11 > 10
		{"__if_a_cond", true},
		// exactly 10 chars — not > 10
		{"__if__cond", false},
		// suffix mismatch
		{"__if_foo_cond_extra", false},
		// no prefix
		{"foo", false},
		{"", false},
		// only prefix present, no suffix
		{"__if_foo", false},
		// only suffix present
		{"foo_cond", false},
	}
	for _, c := range cases {
		got := names.IsGeneratedIfCondName(c.input)
		if got != c.want {
			t.Errorf("IsGeneratedIfCondName(%q) = %v; want %v", c.input, got, c.want)
		}
	}
}
