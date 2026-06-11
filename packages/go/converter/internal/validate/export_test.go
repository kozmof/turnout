package validate

import "github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"

// IsIdentityCombine exposes the unexported isIdentityCombine for white-box
// testing from the validate_test package.
var IsIdentityCombine = func(c *turnoutpb.CombineExpr) bool {
	return isIdentityCombine(c)
}
