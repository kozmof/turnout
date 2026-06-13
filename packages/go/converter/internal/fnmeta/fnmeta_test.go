package fnmeta_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/fnmeta"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestFnAliasesMatchSpec asserts that every HCL alias in spec/fn-aliases.json
// is registered in fnmeta.builtinFnTable, and that the table contains no
// aliases absent from the spec. Both sides must stay in sync: the spec is the
// single source of truth consumed by both the Go compiler and the TypeScript
// runtime.
func TestFnAliasesMatchSpec(t *testing.T) {
	type specEntry struct {
		HCL     string `json:"hcl"`
		Runtime string `json:"runtime"`
	}

	data, err := os.ReadFile("../../../../../spec/fn-aliases.json")
	if err != nil {
		t.Fatalf("cannot read spec/fn-aliases.json: %v", err)
	}
	var entries []specEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		t.Fatalf("cannot parse spec/fn-aliases.json: %v", err)
	}

	// Every spec alias must be in builtinFnTable.
	for _, e := range entries {
		if _, ok := fnmeta.BuiltinFn(e.HCL); !ok {
			t.Errorf("spec alias %q is not registered in fnmeta.builtinFnTable", e.HCL)
		}
	}

	// builtinFnTable must not contain aliases absent from the spec.
	specAliases := make(map[string]bool, len(entries))
	for _, e := range entries {
		specAliases[e.HCL] = true
	}
	for _, name := range fnmeta.BuiltinFnNames() {
		if !specAliases[name] {
			t.Errorf("fnmeta alias %q is not in spec/fn-aliases.json", name)
		}
	}

	// Count parity: catches simultaneous add+remove that would evade the above checks.
	if got, want := len(fnmeta.BuiltinFnNames()), len(entries); got != want {
		t.Errorf("fnmeta has %d aliases, spec has %d — counts must match", got, want)
	}
}

func TestIdentityValue(t *testing.T) {
	cases := []struct {
		fn      string
		wantOK  bool
		wantKind string
	}{
		{"bool_and", true, "bool"},
		{"add", true, "number"},
		{"str_concat", true, "string"},
		{"arr_concat", true, "list"},
		{"mul", false, ""},
		{"unknown", false, ""},
	}

	for _, tc := range cases {
		v, ok := fnmeta.IdentityValue(tc.fn)
		if ok != tc.wantOK {
			t.Errorf("IdentityValue(%q) ok=%v, want %v", tc.fn, ok, tc.wantOK)
			continue
		}
		if !ok {
			continue
		}
		var kind string
		switch v.Kind.(type) {
		case *structpb.Value_BoolValue:
			kind = "bool"
		case *structpb.Value_NumberValue:
			kind = "number"
		case *structpb.Value_StringValue:
			kind = "string"
		case *structpb.Value_ListValue:
			kind = "list"
		}
		if kind != tc.wantKind {
			t.Errorf("IdentityValue(%q) kind=%q, want %q", tc.fn, kind, tc.wantKind)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// ReturnType
// ─────────────────────────────────────────────────────────────────────────────

func TestReturnType_KnownFunctions(t *testing.T) {
	// For each known function, verify ReturnType returns the expected type
	// regardless of the fallback value passed.
	const fallback = ast.FieldTypeNumber
	cases := []struct {
		fn   string
		want ast.FieldType
	}{
		// Number arithmetic → number
		{"add", ast.FieldTypeNumber},
		{"sub", ast.FieldTypeNumber},
		{"mul", ast.FieldTypeNumber},
		{"div", ast.FieldTypeNumber},
		{"mod", ast.FieldTypeNumber},
		{"max", ast.FieldTypeNumber},
		{"min", ast.FieldTypeNumber},
		// Number comparison → bool
		{"gt", ast.FieldTypeBool},
		{"gte", ast.FieldTypeBool},
		{"lt", ast.FieldTypeBool},
		{"lte", ast.FieldTypeBool},
		// String → string
		{"str_concat", ast.FieldTypeStr},
		// String predicates → bool
		{"str_includes", ast.FieldTypeBool},
		{"str_starts", ast.FieldTypeBool},
		{"str_ends", ast.FieldTypeBool},
		// Boolean → bool
		{"bool_and", ast.FieldTypeBool},
		{"bool_or", ast.FieldTypeBool},
		{"bool_xor", ast.FieldTypeBool},
		// Generic equality → bool
		{"eq", ast.FieldTypeBool},
		{"neq", ast.FieldTypeBool},
		// Array predicate → bool
		{"arr_includes", ast.FieldTypeBool},
	}
	for _, tc := range cases {
		got := fnmeta.ReturnType(tc.fn, fallback)
		if got != tc.want {
			t.Errorf("ReturnType(%q, fallback) = %v, want %v", tc.fn, got, tc.want)
		}
	}
}

func TestReturnType_UnknownFunction_ReturnsFallback(t *testing.T) {
	for _, fallback := range []ast.FieldType{ast.FieldTypeNumber, ast.FieldTypeStr, ast.FieldTypeBool} {
		got := fnmeta.ReturnType("no_such_fn", fallback)
		if got != fallback {
			t.Errorf("ReturnType(unknown, %v) = %v, want fallback %v", fallback, got, fallback)
		}
	}
}

func TestReturnType_ArrConcat_ReturnsFallback(t *testing.T) {
	// arr_concat returns the same array type as arg1; the lowerer supplies the
	// declared binding type as fallback, so ReturnType must pass it through unchanged.
	for _, fallback := range []ast.FieldType{
		ast.FieldTypeArrNumber,
		ast.FieldTypeArrStr,
		ast.FieldTypeArrBool,
	} {
		got := fnmeta.ReturnType("arr_concat", fallback)
		if got != fallback {
			t.Errorf("ReturnType(arr_concat, %v) = %v, want fallback %v", fallback, got, fallback)
		}
	}
}

func TestReturnType_ArrGet_ReturnsElemType(t *testing.T) {
	cases := []struct {
		fallback ast.FieldType
		want     ast.FieldType
	}{
		{ast.FieldTypeArrNumber, ast.FieldTypeNumber},
		{ast.FieldTypeArrStr, ast.FieldTypeStr},
		{ast.FieldTypeArrBool, ast.FieldTypeBool},
		// Non-array fallback: returned unchanged (no elem type to extract).
		{ast.FieldTypeNumber, ast.FieldTypeNumber},
		{ast.FieldTypeStr, ast.FieldTypeStr},
	}
	for _, tc := range cases {
		got := fnmeta.ReturnType("arr_get", tc.fallback)
		if got != tc.want {
			t.Errorf("ReturnType(arr_get, %v) = %v, want %v", tc.fallback, got, tc.want)
		}
	}
}

func TestStaticArgTypes(t *testing.T) {
	t.Run("standard_functions_return_static_types", func(t *testing.T) {
		standardFns := []struct {
			name string
			a1   ast.FieldType
			a2   ast.FieldType
		}{
			{"add", ast.FieldTypeNumber, ast.FieldTypeNumber},
			{"sub", ast.FieldTypeNumber, ast.FieldTypeNumber},
			{"str_concat", ast.FieldTypeStr, ast.FieldTypeStr},
			{"bool_and", ast.FieldTypeBool, ast.FieldTypeBool},
			{"str_includes", ast.FieldTypeStr, ast.FieldTypeStr},
		}
		for _, tc := range standardFns {
			spec, ok := fnmeta.BuiltinFn(tc.name)
			if !ok {
				t.Fatalf("BuiltinFn(%q) not found", tc.name)
			}
			a1, a2, staticOK := spec.StaticArgTypes()
			if !staticOK {
				t.Errorf("%q: StaticArgTypes ok=false, want true", tc.name)
				continue
			}
			if a1 != tc.a1 {
				t.Errorf("%q: arg1=%v, want %v", tc.name, a1, tc.a1)
			}
			if a2 != tc.a2 {
				t.Errorf("%q: arg2=%v, want %v", tc.name, a2, tc.a2)
			}
		}
	})

	t.Run("polymorphic_kinds_return_invalid", func(t *testing.T) {
		polymorphicFns := []string{"eq", "neq", "arr_get", "arr_includes", "arr_concat"}
		for _, name := range polymorphicFns {
			spec, ok := fnmeta.BuiltinFn(name)
			if !ok {
				t.Fatalf("BuiltinFn(%q) not found", name)
			}
			a1, a2, staticOK := spec.StaticArgTypes()
			if staticOK {
				t.Errorf("%q: StaticArgTypes ok=true, want false (polymorphic kind)", name)
			}
			if a1 != ast.FieldTypeInvalid {
				t.Errorf("%q: arg1=%v, want FieldTypeInvalid", name, a1)
			}
			if a2 != ast.FieldTypeInvalid {
				t.Errorf("%q: arg2=%v, want FieldTypeInvalid", name, a2)
			}
		}
	})
}

func TestBuiltinFnNamesSorted(t *testing.T) {
	names1 := fnmeta.BuiltinFnNames()
	names2 := fnmeta.BuiltinFnNames()

	if len(names1) == 0 {
		t.Fatal("BuiltinFnNames returned empty slice")
	}
	// Two consecutive calls must return identical slices (deterministic).
	if len(names1) != len(names2) {
		t.Fatalf("consecutive calls returned different lengths: %d vs %d", len(names1), len(names2))
	}
	for i := range names1 {
		if names1[i] != names2[i] {
			t.Errorf("element %d differs: %q vs %q", i, names1[i], names2[i])
		}
	}
	// Slice must be in ascending lexicographic order.
	for i := 1; i < len(names1); i++ {
		if names1[i] < names1[i-1] {
			t.Errorf("not sorted at index %d: %q > %q", i, names1[i-1], names1[i])
		}
	}
}

func TestIsIdentityValue(t *testing.T) {
	cases := []struct {
		fn   string
		val  *structpb.Value
		want bool
	}{
		{"bool_and", structpb.NewBoolValue(true), true},
		{"bool_and", structpb.NewBoolValue(false), false},
		{"add", structpb.NewNumberValue(0), true},
		{"add", structpb.NewNumberValue(1), false},
		{"str_concat", structpb.NewStringValue(""), true},
		{"str_concat", structpb.NewStringValue("x"), false},
		{"arr_concat", structpb.NewListValue(&structpb.ListValue{}), true},
		{"arr_concat", func() *structpb.Value {
			lv, _ := structpb.NewList([]interface{}{1.0})
			return structpb.NewListValue(lv)
		}(), false},
		{"mul", structpb.NewNumberValue(1), false},
		{"unknown", structpb.NewBoolValue(true), false},
		{"bool_and", nil, false},
	}

	for _, tc := range cases {
		got := fnmeta.IsIdentityValue(tc.fn, tc.val)
		if got != tc.want {
			t.Errorf("IsIdentityValue(%q, %v) = %v, want %v", tc.fn, tc.val, got, tc.want)
		}
	}
}
