package ast_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
)

// The DSL type vocabulary crosses the language boundary the same way function
// aliases do: FieldType.ProtoString() writes these strings into the model, and
// the TypeScript runtime's schemaTypeTable looks them up by exactly those
// strings. A rename on one side and not the other produces an
// "unknown schema type" at runtime rather than a compile error, so — as with
// spec/fn-aliases.json — the vocabulary lives in a shared spec file that both
// languages assert against.
//
// The TypeScript half is packages/ts/scene-runner/tests/field-types-parity.test.ts.

const fieldTypesSpecPath = "../../../../../spec/field-types.json"

type fieldTypeSpecEntry struct {
	DSL string `json:"dsl"`
	// Element is the element type name for array types, and empty for scalars.
	Element string `json:"element"`
}

func loadFieldTypesSpec(t *testing.T) []fieldTypeSpecEntry {
	t.Helper()
	data, err := os.ReadFile(fieldTypesSpecPath)
	if err != nil {
		t.Fatalf("cannot read spec/field-types.json: %v", err)
	}
	var entries []fieldTypeSpecEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		t.Fatalf("cannot parse spec/field-types.json: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("spec/field-types.json is empty")
	}
	return entries
}

// TestFieldTypesMatchSpec asserts the vocabulary in both directions: every name
// in the spec parses to a valid FieldType, and every valid FieldType renders to a
// name in the spec. The count check catches a simultaneous add and remove that
// would slip past both directions.
func TestFieldTypesMatchSpec(t *testing.T) {
	entries := loadFieldTypesSpec(t)

	specNames := make(map[string]bool, len(entries))
	for _, e := range entries {
		specNames[e.DSL] = true

		ft, ok := ast.FieldTypeFromString(e.DSL)
		if !ok {
			t.Errorf("spec type %q is not accepted by ast.FieldTypeFromString", e.DSL)
			continue
		}
		if !ft.Valid() {
			t.Errorf("spec type %q parsed to an invalid FieldType", e.DSL)
		}
		// ProtoString is the string that actually crosses the wire.
		if got := ft.ProtoString(); got != e.DSL {
			t.Errorf("%q round-trips to ProtoString %q; the wire name must match the spec", e.DSL, got)
		}
	}

	var declared int
	for ft := ast.FieldType(1); ft.Valid(); ft++ {
		declared++
		if !specNames[ft.ProtoString()] {
			t.Errorf("FieldType %s is not listed in spec/field-types.json", ft)
		}
	}
	if declared != len(entries) {
		t.Errorf("ast declares %d field types, spec lists %d — counts must match", declared, len(entries))
	}
}

// TestFieldTypeArrayShapeMatchesSpec pins the array/element relationships, so a
// new array type cannot be added on one side with the wrong element type.
func TestFieldTypeArrayShapeMatchesSpec(t *testing.T) {
	for _, e := range loadFieldTypesSpec(t) {
		ft, ok := ast.FieldTypeFromString(e.DSL)
		if !ok {
			continue // already reported by TestFieldTypesMatchSpec
		}

		wantArray := e.Element != ""
		if got := ft.IsArray(); got != wantArray {
			t.Errorf("%q: IsArray() = %v, spec says array = %v", e.DSL, got, wantArray)
			continue
		}

		elem, isArr := ft.TryElemType()
		if !wantArray {
			if isArr {
				t.Errorf("%q: TryElemType() reported an element type for a scalar", e.DSL)
			}
			continue
		}
		if !isArr {
			t.Errorf("%q: TryElemType() reported no element type for an array", e.DSL)
			continue
		}
		if got := elem.ProtoString(); got != e.Element {
			t.Errorf("%q: element type = %q, spec says %q", e.DSL, got, e.Element)
		}
		// Every element type must itself be a member of the vocabulary.
		if _, ok := ast.FieldTypeFromString(e.Element); !ok {
			t.Errorf("%q: element type %q is not a field type", e.DSL, e.Element)
		}
	}
}
