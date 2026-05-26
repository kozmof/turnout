// Package names holds compiler-internal name constants shared across pipeline
// stages (lower, validate) to avoid cross-stage import dependencies.
package names

const (
	GeneratedIfCondPrefix = "__if_"
	GeneratedIfCondSuffix = "_cond"
	GeneratedLocalPrefix  = "__local_"
)
