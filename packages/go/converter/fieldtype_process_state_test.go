package converter_test

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	converter "github.com/kozmof/turnout/packages/go/converter"
)

// A field type used to be an integer handle into a process-global table that
// interned every composed type on first sight and never released one. These
// tests pin what replacing it with the type's own spelling bought: a compile
// whose outcome is a function of its source and nothing else.

// composedTypeSpelling returns a distinct well-formed composed type for each n,
// by reading n's bits as a stack of `arr<` and `rec<str, ` constructors over a
// number. Thirteen bits give 8192 spellings, all far inside MaxTypeNodes.
func composedTypeSpelling(n int) string {
	var open strings.Builder
	var close strings.Builder
	for bit := 0; bit < 13; bit++ {
		if n&(1<<bit) == 0 {
			open.WriteString("arr<")
		} else {
			open.WriteString("rec<str, ")
		}
		close.WriteString(">")
	}
	return open.String() + "number" + close.String()
}

func composedTypeSrc(ft string) string {
	return fmt.Sprintf(`
state {
  ns {
    field:%s = %s
  }
}

scene "start" {
  entry_action = init

  action "init" {
    text = "hello"
  }
}
`, ft, emptyValueFor(ft))
}

// emptyValueFor returns the empty literal a state field of this type takes: an
// empty array for `arr<...>`, an empty record for `rec<...>`.
func emptyValueFor(ft string) string {
	if strings.HasPrefix(ft, "rec<") {
		return "{}"
	}
	return "[]"
}

// Compiling 5000 sources with 5000 distinct composed types must produce 5000
// successful compiles. The old registry held 4096 types for the life of the
// process and refused the 4097th, so this is the ceiling that is gone: past it,
// a source that names a type nothing has spelled before was rejected for what
// the process had compiled earlier rather than for anything in the file.
func TestDistinctComposedTypesDoNotExhaustAnything(t *testing.T) {
	for i := 0; i < 5000; i++ {
		ft := composedTypeSpelling(i)
		if _, ds := converter.CompileSource("types.tu", composedTypeSrc(ft), ""); ds.HasErrors() {
			t.Fatalf("compile %d of type %s failed: %v", i, ft, ds)
		}
	}
}

// Two compiles in one process, of two files using disjoint composed types, must
// each see only their own — so a file compiles to the same bytes whether or not
// something else was compiled between two runs of it.
func TestCompilesDoNotSeeEachOther(t *testing.T) {
	const (
		mine   = "arr<rec<str, arr<bool>>>"
		theirs = "rec<number, arr<arr<str>>>"
	)

	first := compileToHCL(t, composedTypeSrc(mine))
	if _, ds := converter.CompileSource("other.tu", composedTypeSrc(theirs), ""); ds.HasErrors() {
		t.Fatalf("compiling the other file failed: %v", ds)
	}
	if second := compileToHCL(t, composedTypeSrc(mine)); second != first {
		t.Errorf("compiling the same source twice, either side of an unrelated compile, produced different output:\nfirst:\n%s\nsecond:\n%s", first, second)
	}
}

// The LSP-keystroke case: the same file compiled over and over. It must produce
// the same bytes every time and leave nothing behind between runs, which is
// what the name cache in front of the registry used to be for.
func TestRepeatedCompilesOfOneFileAreIdentical(t *testing.T) {
	want := compileToHCL(t, composedTypeSrc("rec<str, arr<rec<str, bool>>>"))
	for i := 0; i < 10_000; i++ {
		if got := compileToHCL(t, composedTypeSrc("rec<str, arr<rec<str, bool>>>")); got != want {
			t.Fatalf("compile %d differed from the first", i)
		}
	}
}

func compileToHCL(t *testing.T, src string) string {
	t.Helper()
	result, ds := converter.CompileSource("keystroke.tu", src, "")
	if ds.HasErrors() || result == nil {
		t.Fatalf("compile failed: %v", ds)
	}
	var buf bytes.Buffer
	if ds := result.WriteHCL(&buf); ds.HasErrors() {
		t.Fatalf("emit failed: %v", ds)
	}
	return buf.String()
}
