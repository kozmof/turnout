package state_test

import (
	"sort"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"google.golang.org/protobuf/types/known/structpb"
)

// twoNamespaceSource returns an inline state source with two namespaces, used to
// exercise the iteration accessors below.
func twoNamespaceSource() *ast.InlineStateBlock {
	return &ast.InlineStateBlock{
		Namespaces: []*ast.NamespaceDecl{
			{
				Name: "applicant",
				Fields: []*ast.FieldDecl{
					{Pos: pos(), Name: "income", Type: ast.FieldTypeNumber, Default: numLit(0)},
					{Pos: pos(), Name: "name", Type: ast.FieldTypeStr, Default: strLit("")},
				},
			},
			{
				Name: "decision",
				Fields: []*ast.FieldDecl{
					{Pos: pos(), Name: "approved", Type: ast.FieldTypeBool, Default: boolLit(false)},
				},
			},
		},
	}
}

func TestNamespacesAndRangeAll(t *testing.T) {
	schema, ds := state.Resolve(twoNamespaceSource(), "")
	if ds.HasErrors() {
		t.Fatalf("resolve failed: %v", ds)
	}

	names := schema.Namespaces()
	sort.Strings(names)
	if len(names) != 2 || names[0] != "applicant" || names[1] != "decision" {
		t.Errorf("Namespaces() = %v, want [applicant decision]", names)
	}

	// RangeAll must visit every field across all namespaces.
	seen := make(map[string]ast.FieldType)
	schema.RangeAll(func(ns, field string, meta state.FieldMeta) {
		seen[ns+"."+field] = meta.Type
	})
	want := map[string]ast.FieldType{
		"applicant.income":  ast.FieldTypeNumber,
		"applicant.name":    ast.FieldTypeStr,
		"decision.approved": ast.FieldTypeBool,
	}
	if len(seen) != len(want) {
		t.Fatalf("RangeAll visited %d fields, want %d (%v)", len(seen), len(want), seen)
	}
	for k, v := range want {
		if seen[k] != v {
			t.Errorf("RangeAll field %q = %v, want %v", k, seen[k], v)
		}
	}
}

func TestRangeFields(t *testing.T) {
	schema, ds := state.Resolve(twoNamespaceSource(), "")
	if ds.HasErrors() {
		t.Fatalf("resolve failed: %v", ds)
	}

	count := 0
	ok := schema.RangeFields("applicant", func(name string, meta state.FieldMeta) {
		count++
	})
	if !ok {
		t.Fatal("RangeFields(applicant) returned false for an existing namespace")
	}
	if count != 2 {
		t.Errorf("RangeFields(applicant) visited %d fields, want 2", count)
	}

	// A missing namespace returns false and never invokes fn.
	called := false
	if schema.RangeFields("missing", func(string, state.FieldMeta) { called = true }) {
		t.Error("RangeFields(missing) = true, want false")
	}
	if called {
		t.Error("RangeFields invoked fn for a missing namespace")
	}
}

func TestNewSchemaFromMap(t *testing.T) {
	schema := state.NewSchemaFromMap(map[string]map[string]state.FieldMeta{
		"ns": {"x": {Type: ast.FieldTypeNumber}},
	})
	if meta, ok := schema.Get("ns.x"); !ok || meta.Type != ast.FieldTypeNumber {
		t.Errorf("Get(ns.x) = (%v, %v), want number field", meta, ok)
	}
	// Schemas built via NewSchemaFromMap have no declaration order, so Hash is 0.
	if schema.Hash() != 0 {
		t.Errorf("Hash() = %d, want 0 for map-built schema", schema.Hash())
	}

	// A nil map is tolerated and yields an empty, usable schema.
	empty := state.NewSchemaFromMap(nil)
	if len(empty.Namespaces()) != 0 {
		t.Errorf("NewSchemaFromMap(nil) namespaces = %v, want empty", empty.Namespaces())
	}
}

func TestSchemaHashDeterministicAndSensitive(t *testing.T) {
	s1, ds := state.Resolve(twoNamespaceSource(), "")
	if ds.HasErrors() {
		t.Fatalf("resolve failed: %v", ds)
	}
	s2, _ := state.Resolve(twoNamespaceSource(), "")

	if s1.Hash() == 0 {
		t.Fatal("Hash() = 0 for a resolved inline schema; want a content hash")
	}
	if s1.Hash() != s2.Hash() {
		t.Errorf("identical sources produced different hashes: %d vs %d", s1.Hash(), s2.Hash())
	}

	// Changing a field type must change the hash.
	mutated := twoNamespaceSource()
	mutated.Namespaces[0].Fields[0].Type = ast.FieldTypeStr
	mutated.Namespaces[0].Fields[0].Default = strLit("")
	s3, _ := state.Resolve(mutated, "")
	if s3.Hash() == s1.Hash() {
		t.Error("changing a field type did not change the schema hash")
	}
}

func TestStructpbFieldType(t *testing.T) {
	list := func(vals ...*structpb.Value) *structpb.Value {
		return structpb.NewListValue(&structpb.ListValue{Values: vals})
	}

	cases := []struct {
		name   string
		val    *structpb.Value
		wantFT ast.FieldType
		wantOk bool
	}{
		{"nil", nil, ast.FieldTypeInvalid, false},
		{"number", structpb.NewNumberValue(1), ast.FieldTypeNumber, true},
		{"string", structpb.NewStringValue("x"), ast.FieldTypeStr, true},
		{"bool", structpb.NewBoolValue(true), ast.FieldTypeBool, true},
		{"null", structpb.NewNullValue(), ast.FieldTypeInvalid, false},
		{"arr-number", list(structpb.NewNumberValue(1)), ast.FieldTypeArrNumber, true},
		{"arr-string", list(structpb.NewStringValue("a")), ast.FieldTypeArrStr, true},
		{"arr-bool", list(structpb.NewBoolValue(false)), ast.FieldTypeArrBool, true},
		{"empty-arr", list(), ast.FieldTypeInvalid, false},
		{"arr-of-null", list(structpb.NewNullValue()), ast.FieldTypeInvalid, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ft, ok := state.StructpbFieldType(tc.val)
			if ft != tc.wantFT || ok != tc.wantOk {
				t.Errorf("StructpbFieldType = (%v, %v), want (%v, %v)", ft, ok, tc.wantFT, tc.wantOk)
			}
		})
	}
}

// TestNewSchemaFromMapCopiesInput checks that the constructor does not adopt
// the caller's map. A Schema is immutable once resolved and every reader in the
// compiler assumes it; adopting would let a caller still holding the map edit a
// schema from outside, at any point in a compile.
func TestNewSchemaFromMapCopiesInput(t *testing.T) {
	fields := map[string]state.FieldMeta{"x": {Type: ast.FieldTypeNumber}}
	input := map[string]map[string]state.FieldMeta{"ns": fields}
	schema := state.NewSchemaFromMap(input)

	// Mutate both levels of the caller's map after construction.
	fields["y"] = state.FieldMeta{Type: ast.FieldTypeStr}
	input["other"] = map[string]state.FieldMeta{"z": {Type: ast.FieldTypeBool}}

	if _, ok := schema.Get("ns.y"); ok {
		t.Error("Get(ns.y) = true; a field added to the caller's inner map reached the schema")
	}
	if _, ok := schema.Get("other.z"); ok {
		t.Error("Get(other.z) = true; a namespace added to the caller's outer map reached the schema")
	}
}

// TestSchemaEqualContent covers the structural comparison that replaced the
// hash in the cached-schema staleness check.
func TestSchemaEqualContent(t *testing.T) {
	resolved, order, ds := state.ResolveWithOrder(twoNamespaceSource(), "")
	if ds.HasErrors() {
		t.Fatalf("resolve failed: %v", ds)
	}

	t.Run("equal to a fresh resolve of the same source", func(t *testing.T) {
		other, _, ds := state.ResolveWithOrder(twoNamespaceSource(), "")
		if ds.HasErrors() {
			t.Fatalf("resolve failed: %v", ds)
		}
		if !resolved.EqualContent(other, order) {
			t.Error("EqualContent = false for two resolves of one source")
		}
	})

	t.Run("differs on type", func(t *testing.T) {
		source := twoNamespaceSource()
		source.Namespaces[0].Fields[0].Type = ast.FieldTypeStr
		source.Namespaces[0].Fields[0].Default = strLit("")
		other, _, ds := state.ResolveWithOrder(source, "")
		if ds.HasErrors() {
			t.Fatalf("resolve failed: %v", ds)
		}
		if resolved.EqualContent(other, order) {
			t.Error("EqualContent = true across a changed field type")
		}
	})

	t.Run("differs on default", func(t *testing.T) {
		source := twoNamespaceSource()
		source.Namespaces[0].Fields[0].Default = numLit(42)
		other, _, ds := state.ResolveWithOrder(source, "")
		if ds.HasErrors() {
			t.Fatalf("resolve failed: %v", ds)
		}
		if resolved.EqualContent(other, order) {
			t.Error("EqualContent = true across a changed default value")
		}
	})

	t.Run("differs on field count", func(t *testing.T) {
		source := twoNamespaceSource()
		ns := source.Namespaces[0]
		ns.Fields = append(ns.Fields, &ast.FieldDecl{
			Pos: pos(), Name: "extra", Type: ast.FieldTypeNumber, Default: numLit(0),
		})
		other, otherOrder, ds := state.ResolveWithOrder(source, "")
		if ds.HasErrors() {
			t.Fatalf("resolve failed: %v", ds)
		}
		// Neither order reaches the difference: the shorter one never names the
		// added field, and the longer one names it in a schema that has it. The
		// field counts are what refuse both.
		if resolved.EqualContent(other, order) {
			t.Error("EqualContent = true against a schema with an added field")
		}
		if other.EqualContent(resolved, otherOrder) {
			t.Error("EqualContent = true against a schema missing a field")
		}
	})

	t.Run("renamed field: same count, key in one schema only", func(t *testing.T) {
		source := twoNamespaceSource()
		source.Namespaces[0].Fields[0].Name = "renamed"
		other, _, ds := state.ResolveWithOrder(source, "")
		if ds.HasErrors() {
			t.Fatalf("resolve failed: %v", ds)
		}
		// The field counts agree, so the refusal has to come from the key: the
		// order names the old field, which only one of the two schemas has.
		if resolved.EqualContent(other, order) {
			t.Error("EqualContent = true across a renamed field")
		}
	})

	t.Run("an order that misses a field is not equality", func(t *testing.T) {
		other, _, ds := state.ResolveWithOrder(twoNamespaceSource(), "")
		if ds.HasErrors() {
			t.Fatalf("resolve failed: %v", ds)
		}
		if resolved.EqualContent(other, order[:len(order)-1]) {
			t.Error("EqualContent = true on an order that leaves a field unvisited")
		}
	})

	t.Run("a key in neither schema is skipped", func(t *testing.T) {
		other, _, ds := state.ResolveWithOrder(twoNamespaceSource(), "")
		if ds.HasErrors() {
			t.Fatalf("resolve failed: %v", ds)
		}
		padded := append(append([]string(nil), order...), "gone.missing")
		if !resolved.EqualContent(other, padded) {
			t.Error("EqualContent = false for an order naming a field neither schema declares")
		}
	})
}
