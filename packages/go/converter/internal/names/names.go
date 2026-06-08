// Package names holds compiler-internal name constants shared across pipeline
// stages (lower, validate) to avoid cross-stage import dependencies.
package names

import "fmt"

const (
	GeneratedIfCondPrefix = "__if_"
	GeneratedIfCondSuffix = "_cond"
	GeneratedLocalPrefix  = "__local_"
)

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

// IsGeneratedIfCondName reports whether name was produced as a compiler-generated
// #if / #case condition binding (prefix __if_ AND suffix _cond).
func IsGeneratedIfCondName(name string) bool {
	return len(name) > len(GeneratedIfCondPrefix)+len(GeneratedIfCondSuffix) &&
		name[:len(GeneratedIfCondPrefix)] == GeneratedIfCondPrefix &&
		name[len(name)-len(GeneratedIfCondSuffix):] == GeneratedIfCondSuffix
}
