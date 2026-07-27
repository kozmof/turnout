package ast

import "testing"

func cap(name string, t Type) *CaptureSegment    { return &CaptureSegment{Name: name, CaptureType: t} }
func text(v string) *TextSegment                 { return &TextSegment{Value: v} }
func tmpl(segs ...TemplateSegment) *TemplateType { return NewTemplateType(Pos{}, segs) }

// resourceId = "{kind: "foo" | "bar"}-{sequence: integer}"
func resourceIdTemplate() *TemplateType {
	return tmpl(
		cap("kind", union(litT(str("foo")), litT(str("bar")))),
		text("-"),
		cap("sequence", prim(PrimInteger)),
	)
}

func TestTemplateMatchResourceId(t *testing.T) {
	rid := resourceIdTemplate()
	caps, ok := TemplateMatch(rid, "foo-10")
	if !ok {
		t.Fatalf(`"foo-10" should match`)
	}
	if caps["kind"] != "foo" {
		t.Errorf("kind = %v, want foo", caps["kind"])
	}
	if caps["sequence"] != float64(10) {
		t.Errorf("sequence = %v (%T), want 10 (float64)", caps["sequence"], caps["sequence"])
	}
	if !TemplateContains(rid, "bar-2") {
		t.Errorf(`"bar-2" should match`)
	}
}

func TestTemplateMatchRejections(t *testing.T) {
	rid := resourceIdTemplate()
	for _, s := range []string{"baz-10", "foo-x", "foo-", "foo-1.5", "foo-007", "-10", "foo10"} {
		if TemplateContains(rid, s) {
			t.Errorf("%q should NOT match ResourceId", s)
		}
	}
}

func TestTemplateMatchNegativeInteger(t *testing.T) {
	rid := resourceIdTemplate()
	caps, ok := TemplateMatch(rid, "foo--5")
	if !ok {
		t.Fatalf(`"foo--5" should match (sequence = -5)`)
	}
	if caps["sequence"] != float64(-5) {
		t.Errorf("sequence = %v, want -5", caps["sequence"])
	}
}

func TestTemplateMatchCoordinate(t *testing.T) {
	coord := tmpl(cap("x", prim(PrimInteger)), text(","), cap("y", prim(PrimInteger)))
	caps, ok := TemplateMatch(coord, "3,4")
	if !ok || caps["x"] != float64(3) || caps["y"] != float64(4) {
		t.Errorf(`"3,4" → %v, ok=%v`, caps, ok)
	}
	for _, s := range []string{"3,", ",4", "3,4,", "3,4,5"} {
		if TemplateContains(coord, s) {
			t.Errorf("%q should NOT match Coordinate", s)
		}
	}
}

func TestTemplateMatchTerminalStr(t *testing.T) {
	pt := tmpl(text("prefix-"), cap("s", prim(PrimStr)))
	caps, ok := TemplateMatch(pt, "prefix-hello world")
	if !ok || caps["s"] != "hello world" {
		t.Errorf(`terminal str → %v, ok=%v`, caps, ok)
	}
	if TemplateContains(pt, "prefix-") {
		t.Errorf("empty str capture should not match")
	}
}

func TestTemplateMatchVersion(t *testing.T) {
	// v{major: integer}.{minor: integer}
	ver := tmpl(text("v"), cap("major", prim(PrimInteger)), text("."), cap("minor", prim(PrimInteger)))
	caps, ok := TemplateMatch(ver, "v1.2")
	if !ok || caps["major"] != float64(1) || caps["minor"] != float64(2) {
		t.Errorf(`"v1.2" → %v, ok=%v`, caps, ok)
	}
	if TemplateContains(ver, "v1.2.3") {
		t.Errorf(`"v1.2.3" should not match`)
	}
	if TemplateContains(ver, "v1") {
		t.Errorf(`"v1" should not match (missing .minor)`)
	}
}

func TestTemplateMatchBoolCapture(t *testing.T) {
	// enabled-{value: bool}
	bt := tmpl(text("enabled-"), cap("value", prim(PrimBool)))
	caps, ok := TemplateMatch(bt, "enabled-true")
	if !ok || caps["value"] != true {
		t.Errorf(`"enabled-true" → %v, ok=%v`, caps, ok)
	}
	if TemplateContains(bt, "enabled-yes") {
		t.Errorf(`"enabled-yes" should not match bool`)
	}
}
