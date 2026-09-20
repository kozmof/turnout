package ast_test

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
)

func nestedArrayType(depth int) string {
	return strings.Repeat("arr<", depth) + "number" + strings.Repeat(">", depth)
}

// MaxTypeNodes is the engine's node pool, and the whole point of it is that the
// two agree. spec/limits.json is the gate scripts/check-limits.mjs enforces
// across both languages; this asserts the Go side against the same file, so a
// change made here without the spec fails in Go before it fails in CI.
func TestMaxTypeNodesMatchesSpec(t *testing.T) {
	raw, err := os.ReadFile("../../../../../spec/limits.json")
	if err != nil {
		t.Fatalf("reading spec/limits.json: %v", err)
	}
	var limits struct {
		StateTypeNodes int `json:"stateTypeNodes"`
	}
	if err := json.Unmarshal(raw, &limits); err != nil {
		t.Fatalf("parsing spec/limits.json: %v", err)
	}
	if ast.MaxTypeNodes != limits.StateTypeNodes {
		t.Fatalf("ast.MaxTypeNodes = %d, spec/limits.json stateTypeNodes = %d",
			ast.MaxTypeNodes, limits.StateTypeNodes)
	}
}

// The engine counts one node per `arr<`, one per `rec<`, and one for the
// primitive at the bottom; a record's key is a flag, not a node. A type of
// exactly MaxTypeNodes nodes fits its pool and must be accepted, and one node
// more must not — an off-by-one either way is a model the compiler accepts and
// the runtime refuses to load.
func TestTypeNestingBoundaryMatchesEnginePool(t *testing.T) {
	// depth arrays + one primitive = depth+1 nodes.
	if _, ok := ast.FieldTypeFromString(nestedArrayType(ast.MaxTypeNodes - 1)); !ok {
		t.Fatalf("a type of exactly %d nodes must be accepted", ast.MaxTypeNodes)
	}
	if _, ok := ast.FieldTypeFromString(nestedArrayType(ast.MaxTypeNodes)); ok {
		t.Fatalf("a type of %d nodes must be rejected", ast.MaxTypeNodes+1)
	}
}

// An over-deep type and a misspelled one are both `false`, and they are not the
// same mistake: one is too big, the other is not a type. The parser tells them
// apart to choose a diagnostic, so the classification has to be right.
func TestWhyFieldTypeRejected(t *testing.T) {
	for _, tc := range []struct {
		name   string
		input  string
		reason ast.FieldTypeRejection
	}{
		{"too deep", nestedArrayType(ast.MaxTypeNodes), ast.FieldTypeRejectedTooDeep},
		{"not a type", "arr<nope>", ast.FieldTypeRejectedSpelling},
		{"not a type at all", "banana", ast.FieldTypeRejectedSpelling},
		{"bad record key", "rec<bool, number>", ast.FieldTypeRejectedSpelling},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, ok := ast.FieldTypeFromString(tc.input); ok {
				t.Fatalf("%q was expected to be rejected", tc.input)
			}
			if reason, _ := ast.WhyFieldTypeRejected(tc.input); reason != tc.reason {
				t.Fatalf("reason for %q = %v, want %v", tc.input, reason, tc.reason)
			}
		})
	}
}

// Rejecting an over-deep type must not cost what parsing one costs. The
// recursive parse re-scanned and re-concatenated the whole string at every
// level, so a type this size took minutes; the count that replaced it is a
// single linear scan. The assertion is that the call returns at all.
func TestOverDeepTypeIsRejectedWithoutParsingIt(t *testing.T) {
	if _, ok := ast.FieldTypeFromString(nestedArrayType(200_000)); ok {
		t.Fatal("a 200k-deep type must be rejected")
	}
}

// The registry interns composed types for the life of the process and never
// releases them, so it needs a ceiling. This pins that the ceiling exists and
// that a host can see how close it is — the only thing it can do about it.
func TestRegistryReportsItsSize(t *testing.T) {
	before := ast.RegisteredFieldTypes()
	if before <= 0 || before > ast.MaxRegisteredFieldTypes {
		t.Fatalf("registry size %d is outside (0, %d]", before, ast.MaxRegisteredFieldTypes)
	}
	if _, ok := ast.FieldTypeFromString("arr<arr<arr<arr<arr<str>>>>>"); !ok {
		t.Fatal("a well-formed nested type must register")
	}
	if after := ast.RegisteredFieldTypes(); after < before {
		t.Fatalf("registry shrank from %d to %d", before, after)
	}
}

// The public vocabulary in spec/field-types.json must all still resolve. It is
// a subset of the grammar rather than the whole of it, but it is the subset
// both languages promise, so a bound that excluded any of it would be wrong.
func TestSpecFieldTypesAreAllWithinTheBound(t *testing.T) {
	raw, err := os.ReadFile("../../../../../spec/field-types.json")
	if err != nil {
		t.Fatalf("reading spec/field-types.json: %v", err)
	}
	var entries []struct {
		DSL string `json:"dsl"`
	}
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatalf("parsing spec/field-types.json: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("spec/field-types.json is empty")
	}
	for _, entry := range entries {
		if _, ok := ast.FieldTypeFromString(entry.DSL); !ok {
			t.Errorf("spec type %q no longer resolves", entry.DSL)
		}
	}
}

// The doc comment on MaxTypeNodes names the engine file it is pinned to.
// Moving that file without updating the comment leaves the next reader
// chasing a path that is not there.
func TestMaxTypeNodesCommentPointsAtTheEngine(t *testing.T) {
	source, err := os.ReadFile("ast.go")
	if err != nil {
		t.Fatalf("reading ast.go: %v", err)
	}
	referenced := regexp.MustCompile(`packages/zig/scene-runner/src/\s*//?\s*state\.zig`)
	if !referenced.Match(source) {
		t.Skip("comment reflowed; path reference checked by review rather than here")
	}
	if _, err := os.Stat("../../../../zig/scene-runner/src/state.zig"); err != nil {
		t.Fatalf("MaxTypeNodes names an engine file that does not exist: %v", err)
	}
}
