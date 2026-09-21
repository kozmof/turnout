package converter_test

import (
	"strings"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// FuzzCompileSource drives the whole pipeline — parse, state-resolve, lower,
// validate — rather than stopping at the parser the way FuzzTokenize and
// FuzzParseFile do.
//
// The two existing targets cover the front end, and the front end is not where
// the coverage is thinnest. scripts/go-test.sh says so in its own comment:
// internal/lower is the largest package and the least covered, and what is
// uncovered sits in lower_local.go, lower_template_case.go and
// lower_tuple_case.go — the local-expression, template-pattern and tuple-pattern
// lowering paths. Those are also the newest parts of the language, which is the
// worst combination to leave unfuzzed. They are recursive tree-to-tree
// transforms over an AST this repository already knows how to generate, so
// reaching them costs one more target rather than a new harness.
//
// A panic anywhere in the pipeline is the failure. CompileSource recovers
// internal panics into a CodeInternalError diagnostic rather than letting them
// escape, which is right for callers and would be silent for a fuzzer, so the
// diagnostic is what this asserts on. DebugStack carries the stack that got
// there, so a crash names the line rather than just the input.
func FuzzCompileSource(f *testing.F) {
	for _, seed := range pipelineSeeds() {
		f.Add(seed)
	}

	// One base directory for the whole run, not one per execution: a state_file
	// directive resolves against it, and containment keeps that resolution
	// inside it, so an empty directory that never changes is all it has to be.
	// Creating one per execution made the temp filesystem the bottleneck and cut
	// the exec rate by more than half.
	base := f.TempDir()

	f.Fuzz(func(t *testing.T, src string) {
		_, ds := converter.CompileSource("<fuzz>.tu", src, base)
		for _, d := range ds {
			if d.Code != diag.CodeInternalError {
				continue
			}
			// The stack is the useful half; the message only says a panic happened.
			t.Fatalf("pipeline panicked on input %q:\n%s\n%s", src, d.Format(), d.DebugStack)
		}
	})
}

// pipelineSeeds are whole programs that reach past the parser, one per lowering
// path the target exists to exercise. A fuzzer mutates a seed rather than
// inventing one, so a corpus of fragments that fail to parse would never get
// far enough to be interesting: every seed here compiles, or very nearly does.
func pipelineSeeds() []string {
	const state = `state {
  ns {
    n:number      = 0
    s:str         = ""
    b:bool        = false
    xs:arr<number> = []
  }
}
`
	action := func(body string) string {
		return state + `
scene "s" {
  entry_action = a
  action "a" {
    compute "c" {
` + body + `
    }
  }
}
`
	}

	return []string{
		// Nothing, and nearly nothing.
		``,
		state,

		// The plain path, for a baseline the mutator can wander away from.
		action(`      r:bool := true`),

		// Ingress and egress, so mutations reach the STATE type checks.
		action(`      n:number <~ @ns.n
      r:number := (n + 1) ~> @ns.n`),

		// lower_local.go: pipelines, #it, #if, nested infix.
		action(`      n:number <~ @ns.n
      r:number := n |> max(#it, 0) |> min(#it, 1000)`),
		action(`      b:bool <~ @ns.b
      r:number := #if b -> 1 | 0`),
		action(`      n:number <~ @ns.n
      r:bool := ((n + 1) * 2) >= (n - 3)`),

		// lower_tuple_case.go: tuple subjects, wildcards, guards, binders.
		action(`      b:bool <~ @ns.b
      n:number <~ @ns.n
      hot:bool = n >= 10
      r:str := case(
        (b, hot),
        (true, _) -> "first",
        (_, true) -> "second",
        _         -> "neither"
      )`),
		action(`      n:number <~ @ns.n
      r:str := case(
        n,
        k if k >= 8 -> "many",
        _           -> "few"
      )`),

		// lower_template_case.go: named literal, union and template types, and a
		// case that matches on a template's own structure.
		`type Queue = "billing" | "technical"
type Ref = "TKT-{queue: Queue}-{serial: integer}"
` + state + `
scene "s" {
  entry_action = a
  action "a" {
    compute "c" {
      last:number <~ @ns.n
      queue: Queue  = "billing"
      serial: integer = last + 1
      reference: Ref = Ref {
        queue = queue
        serial = serial
      }
      r:str := case(
        reference,
        Ref { queue: "billing", serial } -> "billing_desk",
        _                                -> "other"
      )
    }
  }
}
`,

		// Routes, so the route identity and target rules are reachable too.
		state + `
scene "one" {
  entry_action = a
  action "a" { compute "c" { r:bool := true } }
}
scene "two" {
  entry_action = b
  action "b" { compute "c" { r:bool := true } }
}
route "r" {
  entry = one
  to {
    one.a -> two,
  }
}
`,

		// A state_file directive, which is the one path that touches the disk.
		// It resolves nowhere under t.TempDir(), which is the point: the failure
		// has to be a diagnostic rather than a panic.
		`state_file = "absent.tu"
scene "s" { entry_action = a action "a" { compute "c" { r:bool := true } } }
`,

		// Depth, for the same reason the parser target carries it: the lowering
		// walks are recursive too, and a corpus that starts shallow will not grow
		// deep enough in a bounded run to reach the bound.
		action(`      r:number := ` + strings.Repeat("(", 2000) + "1" + strings.Repeat(")", 2000)),
	}
}
