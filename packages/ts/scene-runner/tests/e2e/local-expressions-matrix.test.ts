/**
 * E2E: v1 local expressions matrix
 *
 * Pipeline: generated .tu DSL -> Go converter -> proto JSON -> scene-runner
 * runtime -> STATE/output assertions.
 *
 * Matrix:
 *   patterns:   if, case, pipe/#it
 *   complexity: low single-action, medium two-action scene, high two-scene route
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runServerHarness as runHarness } from "../../src/server/index.js";
import { buildBoolean, buildNumber, buildString, isPureNumber, isPureString } from "runtime";
import type { AnyValue } from "runtime";

type Case = {
  name: string;
  pattern: "if" | "case" | "pipe" | "construct" | "destructure" | "tuple";
  complexity: "low" | "medium" | "high";
  entryId: string;
  src: string;
  initialState: Record<string, AnyValue>;
  expectPath: string;
  expectValue: number | string;
};

const converterDir = resolve(__dirname, "../../../../go/converter");
const tmpRoot = mkdtempSync(join(tmpdir(), "turnout-local-expr-e2e-"));
const turnoutBin = join(tmpRoot, "turnout");
const goBin = process.env.GOROOT
  ? join(process.env.GOROOT, "bin", "go")
  : existsSync("/usr/local/go/bin/go")
    ? "/usr/local/go/bin/go"
    : "go";

beforeAll(() => {
  execFileSync(goBin, ["build", "-buildvcs=false", "-o", turnoutBin, "./cmd/turnout"], {
    cwd: converterDir,
    stdio: "pipe",
    env: {
      ...process.env,
      // GOCACHE is not present in the environment when the go shim injects it
      // via `island run -p go-workspace` — direct binary invocations fall back
      // to ~/.cache/go-build, which is Landlock-restricted in the sandbox.
      GOCACHE:
        process.env.GOCACHE ??
        (existsSync("/workspace")
          ? resolve(converterDir, "../../../.go-cache")
          : join(homedir(), ".cache", "go-build")),
    },
  });
  process.env.TURNOUT_BIN = turnoutBin;
});

function boxed(values: Record<string, boolean | number | string>): Record<string, AnyValue> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      if (typeof value === "boolean") return [key, buildBoolean(value)];
      if (typeof value === "number") return [key, buildNumber(value)];
      return [key, buildString(value)];
    }),
  );
}

function valueOf(v: unknown): number | string | undefined {
  const value = v as AnyValue;
  if (isPureNumber(value)) return value.value;
  if (isPureString(value)) return value.value;
  return undefined;
}

function writeTurn(name: string, src: string) {
  const path = join(tmpRoot, `${name}.tu`);
  writeFileSync(path, src, "utf8");
  return path;
}

const stateBlock = `state {
  input {
    n:number = 0
    flag:bool = false
    word:str = ""
  }
  work {
    n:number = 0
    label:str = ""
    final:str = ""
  }
}`;

const cases: Case[] = [
  {
    // Template construction from a variable capture lowers to str_concat + toStr
    // and must execute to the serialized template string.
    name: "construct-var-single-action",
    pattern: "construct",
    complexity: "low",
    entryId: "construct_low",
    expectPath: "work.final",
    expectValue: "m-42",
    initialState: boxed({ "input.n": 42 }),
    src: `type Metric = "m-{value: number}"
${stateBlock}
scene "construct_low" {
  entry_action = run
  action "run" {
    compute "p" {
      n:number <~ @input.n
      out:Metric := (Metric { value = n }) ~> @work.final
    }
  }
}`,
  },
  {
    // Template case destructuring executes: match the "bar" arm, extract the
    // integer capture, and compute add(sequence, 100).
    name: "destructure-single-action",
    pattern: "destructure",
    complexity: "low",
    entryId: "destructure_low",
    expectPath: "work.n",
    expectValue: 105,
    initialState: boxed({ "input.word": "bar-5" }),
    src: `type Kind = "foo" | "bar"
type ResourceId = "{kind: Kind}-{sequence: integer}"
${stateBlock}
scene "destructure_low" {
  entry_action = run
  action "run" {
    compute "p" {
      rid:ResourceId <~ @input.word
      seq:number := (case(
        rid,
        ResourceId { kind: "foo", sequence } => sequence,
        ResourceId { kind: "bar", sequence } => sequence + 100
      )) ~> @work.n
    }
  }
}`,
  },
  {
    name: "tuple-template-single-action",
    pattern: "tuple",
    complexity: "low",
    entryId: "tuple_low",
    expectPath: "work.n",
    expectValue: 5,
    initialState: boxed({ "input.word": "bar-5", "input.flag": true }),
    src: `type Kind = "foo" | "bar"
type Enabled = true | false
type ResourceId = "{kind: Kind}-{sequence: integer}"
${stateBlock}
scene "tuple_low" {
  entry_action = run
  action "run" {
    compute "p" {
      rid:ResourceId <~ @input.word
      enabled:Enabled <~ @input.flag
      seq:number := (case(
        (rid, enabled),
        (ResourceId { kind: "foo", sequence }, _) => sequence + 100,
        (ResourceId { kind: "bar", sequence }, true) => sequence,
        (ResourceId { kind: "bar", sequence: _ }, false) => 0
      )) ~> @work.n
    }
  }
}`,
  },
  {
    name: "if-low-single-action",
    pattern: "if",
    complexity: "low",
    entryId: "if_low",
    expectPath: "work.n",
    expectValue: 14,
    initialState: boxed({ "input.n": 4, "input.flag": true }),
    src: `${stateBlock}
scene "if_low" {
  entry_action = run
  action "run" {
    compute "p" {
      n:number <~ @input.n
      flag:bool <~ @input.flag
      result:number := (if(flag, n + 10, n - 10)) ~> @work.n
    }
  }
}`,
  },
  {
    name: "if-medium-two-action-scene",
    pattern: "if",
    complexity: "medium",
    entryId: "if_medium",
    expectPath: "work.n",
    expectValue: 14,
    initialState: boxed({ "input.n": 8, "input.flag": true }),
    src: `${stateBlock}
scene "if_medium" {
  entry_action = first
  action "first" {
    compute "p1" {
      n:number <~ @input.n
      flag:bool <~ @input.flag
      staged:number := (if(flag, n + 1, n + 2)) ~> @work.n
    }
    next { action = second }
  }
  action "second" {
    compute "p2" {
      staged:number <~ @work.n
      final:number := (if(staged > 10, staged * 2, staged + 5)) ~> @work.n
    }
  }
}`,
  },
  {
    name: "if-high-two-scene-route",
    pattern: "if",
    complexity: "high",
    entryId: "if_route",
    expectPath: "work.final",
    expectValue: "large",
    initialState: boxed({ "input.n": 6, "input.flag": true }),
    src: `${stateBlock}
scene "if_a" {
  entry_action = done
  action "done" {
    compute "p1" {
      n:number <~ @input.n
      flag:bool <~ @input.flag
      staged:number := (if(flag, n * 2, n + 1)) ~> @work.n
    }
  }
}
scene "if_b" {
  entry_action = finish
  action "finish" {
    compute "p2" {
      v:number <~ @work.n
      final:str := (if(v > 10, "large", "small")) ~> @work.final
    }
  }
}
route "if_route" {
  entry = if_a
  to { if_a.done => if_b }
}`,
  },
  {
    name: "case-low-single-action",
    pattern: "case",
    complexity: "low",
    entryId: "case_low",
    expectPath: "work.n",
    expectValue: 1,
    initialState: boxed({ "input.word": "red" }),
    src: `${stateBlock}
scene "case_low" {
  entry_action = run
  action "run" {
    compute "p" {
      word:str <~ @input.word
      result:number := (case(word, "red" => 1, "blue" => 2, _ => 0)) ~> @work.n
    }
  }
}`,
  },
  {
    name: "case-medium-two-action-scene",
    pattern: "case",
    complexity: "medium",
    entryId: "case_medium",
    expectPath: "work.final",
    expectValue: "priority",
    initialState: boxed({ "input.word": "vip" }),
    src: `${stateBlock}
scene "case_medium" {
  entry_action = classify
  action "classify" {
    compute "p1" {
      word:str <~ @input.word
      tier:str := (case(word, "vip" => "gold", "std" => "silver", _ => "bronze")) ~> @work.label
    }
    next { action = emit }
  }
  action "emit" {
    compute "p2" {
      tier:str <~ @work.label
      final:str := (case(tier, "gold" => "priority", "silver" => "normal", _ => "slow")) ~> @work.final
    }
  }
}`,
  },
  {
    name: "case-high-two-scene-route",
    pattern: "case",
    complexity: "high",
    entryId: "case_route",
    expectPath: "work.final",
    expectValue: "route_warm",
    initialState: boxed({ "input.word": "red" }),
    src: `${stateBlock}
scene "case_a" {
  entry_action = done
  action "done" {
    compute "p1" {
      word:str <~ @input.word
      tone:str := (case(word, "red" => "warm", "blue" => "cool", _ => "plain")) ~> @work.label
    }
  }
}
scene "case_b" {
  entry_action = finish
  action "finish" {
    compute "p2" {
      tone:str <~ @work.label
      final:str := (case(tone, "warm" => "route_warm", "cool" => "route_cool", _ => "route_plain")) ~> @work.final
    }
  }
}
route "case_route" {
  entry = case_a
  to { case_a.done => case_b }
}`,
  },
  {
    name: "pipe-low-single-action",
    pattern: "pipe",
    complexity: "low",
    entryId: "pipe_low",
    expectPath: "work.n",
    expectValue: 18,
    initialState: boxed({ "input.n": 4 }),
    src: `${stateBlock}
scene "pipe_low" {
  entry_action = run
  action "run" {
    compute "p" {
      n:number <~ @input.n
      result:number := (pipe(n, add(#it, 2), mul(#it, 3))) ~> @work.n
    }
  }
}`,
  },
  {
    name: "pipe-medium-two-action-scene",
    pattern: "pipe",
    complexity: "medium",
    entryId: "pipe_medium",
    expectPath: "work.n",
    expectValue: 36,
    initialState: boxed({ "input.n": 2 }),
    src: `${stateBlock}
scene "pipe_medium" {
  entry_action = first
  action "first" {
    compute "p1" {
      n:number <~ @input.n
      staged:number := (pipe(n, add(#it, 1), mul(#it, 2))) ~> @work.n
    }
    next { action = second }
  }
  action "second" {
    compute "p2" {
      staged:number <~ @work.n
      final:number := (pipe(staged, add(#it, 3), mul(#it, 4))) ~> @work.n
    }
  }
}`,
  },
  {
    name: "pipe-high-two-scene-route",
    pattern: "pipe",
    complexity: "high",
    entryId: "pipe_route",
    expectPath: "work.n",
    expectValue: 41,
    initialState: boxed({ "input.n": 3 }),
    src: `${stateBlock}
scene "pipe_a" {
  entry_action = done
  action "done" {
    compute "p1" {
      n:number <~ @input.n
      staged:number := (pipe(n, add(#it, 4), mul(#it, 2))) ~> @work.n
    }
  }
}
scene "pipe_b" {
  entry_action = finish
  action "finish" {
    compute "p2" {
      staged:number <~ @work.n
      final:number := (pipe(staged, mul(#it, 3), sub(#it, 1))) ~> @work.n
    }
  }
}
route "pipe_route" {
  entry = pipe_a
  to { pipe_a.done => pipe_b }
}`,
  },
];

describe("v1 local expressions — DSL convert runtime output matrix", () => {
  for (const tc of cases) {
    it(`${tc.pattern} / ${tc.complexity}`, async () => {
      const turnFile = writeTurn(tc.name, tc.src);
      const { finalState } = await runHarness({
        turnFile,
        entryId: tc.entryId,
        initialState: tc.initialState,
      });

      expect(valueOf(finalState[tc.expectPath])).toBe(tc.expectValue);
    });
  }
});
