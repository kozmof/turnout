package diag_test

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// TestLegacyAliasesRoundTrip covers the v2 error-code unification (NEW_SYNTAX.md
// 2.4). Every code that shipped under an SCN_* name must resolve in both
// directions, so tooling holding an old name can still match a current
// diagnostic.
func TestLegacyAliasesRoundTrip(t *testing.T) {
	codes := []diag.ErrorCode{
		diag.CodeInvalidActionGraph,
		diag.CodeActionRootNotFound,
		diag.CodeOverviewMissingEdge,
		diag.CodeOverviewInvalidMode,
		diag.CodeActionTextDuplicate,
	}
	for _, c := range codes {
		legacy, ok := diag.LegacyName(c)
		if !ok {
			t.Errorf("%s: no legacy name recorded", c)
			continue
		}
		if !strings.HasPrefix(legacy, "SCN_") {
			t.Errorf("%s: legacy name %q should be an SCN_* name", c, legacy)
		}
		back, ok := diag.CodeForLegacyName(legacy)
		if !ok || back != c {
			t.Errorf("%s: round trip via %q gave %q", c, legacy, back)
		}
	}
}

// TestCurrentCodesArePascalCase pins the unified convention: no code may ship
// with an SCN_ prefix any more.
func TestCurrentCodesArePascalCase(t *testing.T) {
	for _, c := range []diag.ErrorCode{
		diag.CodeInvalidActionGraph, diag.CodeOverviewMissingEdge,
		diag.CodeOverviewDuplicate, diag.CodeNextComputeNotBool,
	} {
		if strings.HasPrefix(string(c), "SCN_") {
			t.Errorf("code %q still uses the retired SCN_ prefix", c)
		}
	}
}

// TestUnknownLegacyName covers the not-found paths of both lookups.
func TestUnknownLegacyName(t *testing.T) {
	if _, ok := diag.CodeForLegacyName("SCN_NOT_A_REAL_CODE"); ok {
		t.Error("expected no match for an unknown legacy name")
	}
	if _, ok := diag.LegacyName(diag.CodeParseSyntaxError); ok {
		t.Error("ParseSyntaxError never had an SCN_ name")
	}
}
