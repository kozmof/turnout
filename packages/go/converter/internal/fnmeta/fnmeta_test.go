package fnmeta_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/fnmeta"
	"google.golang.org/protobuf/types/known/structpb"
)

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
