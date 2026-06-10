package validate

import (
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

// ─────────────────────────────────────────────────────────────────────────────
// Group A — State path validation
// ─────────────────────────────────────────────────────────────────────────────

func validateStatePath(path string, schema state.Schema, ds *diag.DiagSink) {
	if !isValidStatePath(path) {
		ds.Append(diag.Errorf(diag.CodeInvalidStatePath,
			"state path %q is not a valid dotted path (must be IDENT.IDENT+)", path))
		return
	}
	if _, ok := schema.Get(path); !ok {
		ds.Append(diag.Errorf(diag.CodeUnresolvedStatePath,
			"state path %q is not declared in the state schema", path))
	}
}

func isValidStatePath(path string) bool {
	parts := strings.Split(path, ".")
	if len(parts) < 2 {
		return false
	}
	for _, p := range parts {
		if !isIdent(p) {
			return false
		}
	}
	return true
}

func isIdent(s string) bool {
	if len(s) == 0 {
		return false
	}
	c := s[0]
	if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_') {
		return false
	}
	for i := 1; i < len(s); i++ {
		c = s[i]
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return true
}
