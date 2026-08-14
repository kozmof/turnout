package diag_test

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// TestCurrentCodesArePascalCase pins the v2 error-code unification
// (NEW_SYNTAX.md 2.4): the catalogue settled on PascalCase, and no code may
// ship with the retired SCN_ prefix.
func TestCurrentCodesArePascalCase(t *testing.T) {
	for _, c := range []diag.ErrorCode{
		diag.CodeInvalidActionGraph, diag.CodeOverviewMissingEdge,
		diag.CodeOverviewDuplicate, diag.CodeNextComputeNotBool,
		diag.CodeActionRootNotFound, diag.CodeActionTextDuplicate,
		diag.CodeOverviewInvalidMode, diag.CodeParseSyntaxError,
	} {
		if strings.HasPrefix(string(c), "SCN_") {
			t.Errorf("code %q still uses the retired SCN_ prefix", c)
		}
	}
}
