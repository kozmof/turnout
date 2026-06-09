package fnmeta_test

import (
	"encoding/json"
	"os"
	"testing"

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
