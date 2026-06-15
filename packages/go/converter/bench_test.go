package converter_test

import (
	"testing"

	converter "github.com/kozmof/turnout/packages/go/converter"
)

// benchSrc is a representative Turn DSL program with multiple scene actions,
// compute progs, and prepare/merge blocks — large enough to stress the full
// pipeline without being pathologically huge.
const benchSrc = `
state {
  ns {
    count:number = 0
    active:bool  = false
  }
}

scene "main" {
  entry_actions = ["init"]

  action "init" {
    compute {
      root = result
      prog "p" {
        a:number = 1
        b:number = 2
        <~result:number = a + b
      }
    }
    merge {
      result { to_state = ns.count }
    }
    next {
      action = check
    }
  }

  action "check" {
    compute {
      root = active
      prog "p" {
        ~>cur:number
        <~active:bool = cur > 0
      }
    }
    prepare {
      cur { from_state = ns.count }
    }
    merge {
      active { to_state = ns.active }
    }
    next {
      compute {
        condition = cond
        prog "n" {
          ~>cur:number
          cond:bool = cur > 0
        }
      }
      prepare {
        cur { from_action = cur }
      }
      action = done
    }
  }

  action "done" {
    text = "complete"
  }
}
`

// BenchmarkCompileSource benchmarks the full cold compile path:
// parse → state-resolve → lower → validate.
func BenchmarkCompileSource(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		result, ds := converter.CompileSource("bench.turn", benchSrc, "")
		if ds.HasErrors() || result == nil {
			b.Fatalf("compile failed: %v", ds)
		}
	}
}

// BenchmarkCompileWithSchema benchmarks the incremental compile path used by
// LSP servers: schema is resolved once, then CompileWithSchema is called on
// every keystroke without re-reading state_file from disk.
func BenchmarkCompileWithSchema(b *testing.B) {
	schema, order, ds := converter.ResolveSchema("bench.turn", benchSrc, "")
	if ds.HasErrors() {
		b.Fatalf("ResolveSchema failed: %v", ds)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		result, errs := converter.CompileWithSchema("bench.turn", benchSrc, schema, order)
		if errs.HasErrors() || result == nil {
			b.Fatalf("compile failed: %v", errs)
		}
	}
}

// BenchmarkValidateWithSchema benchmarks the lightest incremental path:
// parse → lower (with pre-resolved schema) → validate. No emit.
func BenchmarkValidateWithSchema(b *testing.B) {
	schema, order, ds := converter.ResolveSchema("bench.turn", benchSrc, "")
	if ds.HasErrors() {
		b.Fatalf("ResolveSchema failed: %v", ds)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		warnings, errs := converter.ValidateWithSchema("bench.turn", benchSrc, schema, order)
		if errs.HasErrors() {
			b.Fatalf("validate failed: %v", errs)
		}
		_ = warnings
	}
}
