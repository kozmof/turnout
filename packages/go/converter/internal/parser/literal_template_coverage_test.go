package parser

import "testing"

func TestTemplateRuneHelpers(t *testing.T) {
	r := []rune(" \talpha_42!")
	i := skipSpaces(r, 0)
	name, next, ok := scanIdentRunes(r, i)
	if !ok || name != "alpha_42" || next != 10 {
		t.Fatalf("scan=%q,%d,%v", name, next, ok)
	}
	if _, _, ok := scanIdentRunes([]rune("9bad"), 0); ok {
		t.Fatal("identifier began with digit")
	}
	for _, good := range []string{"x", "_x", "Éclair2"} {
		if !isIdentifier(good) {
			t.Errorf("rejected %q", good)
		}
	}
	for _, bad := range []string{"", "2x", "x-y"} {
		if isIdentifier(bad) {
			t.Errorf("accepted %q", bad)
		}
	}
}

func TestMalformedLiteralTemplateSyntaxDiagnostics(t *testing.T) {
	cases := []string{
		`type = "x"`,
		`type T "x"`,
		`type T =`,
		`type T = "x" |`,
		`type T = "{x: str}}"`,
		`type T = "{: str}"`,
		`type T = "{x str}"`,
		`type T = "{x: str"`,
		`type T = "{x: }"`,
		`type T = "{x: not-valid}"`,
	}
	for _, decl := range cases {
		t.Run(decl, func(t *testing.T) {
			_, ds := ParseFile("bad.tu", decl+"\n"+minimalStateScene)
			if !ds.HasErrors() {
				t.Fatal("expected parse diagnostic")
			}
		})
	}
}

func TestMalformedTemplateConstructionRecovers(t *testing.T) {
	src := `
type T = "x-{v: integer}"
state { ns { x: number = 0 } }
scene "s" { action "a" { compute { prog "p" {
  out: T := T { 42 = 1, v = 2 }
} } } }
`
	_, ds := ParseFile("bad.tu", src)
	if !ds.HasErrors() {
		t.Fatal("expected invalid capture-name diagnostic")
	}
}
