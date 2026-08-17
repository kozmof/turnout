// Package names holds compiler-internal name constants shared across pipeline
// stages (lower, validate) to avoid cross-stage import dependencies.
package names

import (
	"fmt"
	"strings"
)

const (
	GeneratedIfCondPrefix = "__if_"
	GeneratedIfCondSuffix = "_cond"
	GeneratedLocalPrefix  = "__local_"
	GeneratedEgressPrefix = "__egress_"
	// GeneratedResultName is the binding name given to a compute result written
	// without one — a trailing `(expr) ~> @ns.field` that an action compute block
	// promotes to its result. It needs no counter: a prog carries exactly one
	// result and binding names are prog-scoped.
	//
	// It is deliberately not drawn from the GeneratedEgressPrefix sequence, which
	// is positional: a write inserted above the result would renumber it, and the
	// root name (plus its binding and merge entry) would move with it.
	GeneratedResultName = "__result"
)

// EgressName constructs the generated binding name for an anonymous egress.
func EgressName(counter int) string { return fmt.Sprintf("%s%d", GeneratedEgressPrefix, counter) }

// IsGeneratedEgressName reports whether name belongs to an anonymous egress.
func IsGeneratedEgressName(name string) bool {
	return len(name) > len(GeneratedEgressPrefix) && strings.HasPrefix(name, GeneratedEgressPrefix)
}

// IsGeneratedResultName reports whether name is the generated name of a promoted
// compute result.
func IsGeneratedResultName(name string) bool { return name == GeneratedResultName }

// IsGenerated reports whether name was produced by any of this package's
// generators. Callers that treat compiler-generated bindings as a single class —
// the __ reserved-name gate and the unused-binding warning both do — should use
// this rather than spelling out the individual predicates, so a new generator
// only has to be registered here.
func IsGenerated(name string) bool {
	return IsGeneratedIfCondName(name) ||
		IsGeneratedLocalName(name) ||
		IsGeneratedEgressName(name) ||
		IsGeneratedResultName(name)
}

// LocalName constructs a generated local-expr binding name from its components.
// Format: __local_{target}_{hint}_{counter}. The localLowerer.temp() method is
// the only producer; all other code that needs to detect these names should use
// IsGeneratedLocalName.
func LocalName(target, hint string, counter int) string {
	return fmt.Sprintf("%s%s_%s_%d", GeneratedLocalPrefix, target, hint, counter)
}

// IsGeneratedLocalName reports whether name was produced by the local-expr lowerer.
func IsGeneratedLocalName(name string) bool {
	return len(name) > len(GeneratedLocalPrefix) &&
		name[:len(GeneratedLocalPrefix)] == GeneratedLocalPrefix
}

// SplitStatePath splits a dotted "ns.field" state path into its namespace and
// field components. Returns ("", "", false) when the separator '.' is absent.
func SplitStatePath(key string) (ns, field string, ok bool) {
	dot := strings.IndexByte(key, '.')
	if dot < 0 {
		return "", "", false
	}
	return key[:dot], key[dot+1:], true
}

// IsGeneratedIfCondName reports whether name was produced as a compiler-generated
// if / case condition binding (prefix __if_ AND suffix _cond).
func IsGeneratedIfCondName(name string) bool {
	return len(name) > len(GeneratedIfCondPrefix)+len(GeneratedIfCondSuffix) &&
		name[:len(GeneratedIfCondPrefix)] == GeneratedIfCondPrefix &&
		name[len(name)-len(GeneratedIfCondSuffix):] == GeneratedIfCondSuffix
}
