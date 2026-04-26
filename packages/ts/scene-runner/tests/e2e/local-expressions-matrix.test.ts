/**
 * E2E: v0 local expressions matrix
 *
 * Pipeline: generated .turn DSL -> Go converter -> proto JSON -> scene-runner
 * runtime -> STATE/output assertions.
 *
 * Matrix:
 *   patterns:   #if, #case, #pipe/#it
 *   complexity: low single-action, medium two-action scene, high two-scene route
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runServerHarness as runHarness } from '../../src/server/index.js';
import { buildBoolean, buildNumber, buildString, isPureNumber, isPureString } from 'runtime';
import type { AnyValue } from 'runtime';

type Case = {
  name: string;
  pattern: '#if' | '#case' | '#pipe';
  complexity: 'low' | 'medium' | 'high';
  entryId: string;
  src: string;
  initialState: Record<string, AnyValue>;
  expectPath: string;
  expectValue: number | string;
};

const converterDir = resolve(__dirname, '../../../../go/converter');
const tmpRoot = mkdtempSync(join(tmpdir(), 'turnout-local-expr-e2e-'));
const turnoutBin = join(tmpRoot, 'turnout');

beforeAll(() => {
  execFileSync('/usr/local/go/bin/go', ['build', '-buildvcs=false', '-o', turnoutBin, './cmd/turnout'], {
    cwd: converterDir,
    stdio: 'pipe',
  });
  process.env.TURNOUT_BIN = turnoutBin;
});

function boxed(values: Record<string, boolean | number | string>): Record<string, AnyValue> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      if (typeof value === 'boolean') return [key, buildBoolean(value)];
      if (typeof value === 'number') return [key, buildNumber(value)];
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
  const path = join(tmpRoot, `${name}.turn`);
  writeFileSync(path, src, 'utf8');
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
    name: 'if-low-single-action',
    pattern: '#if',
    complexity: 'low',
    entryId: 'if_low',
    expectPath: 'work.n',
    expectValue: 14,
    initialState: boxed({ 'input.n': 4, 'input.flag': true }),
    src: `${stateBlock}
scene "if_low" {
  entry_actions = ["run"]
  action "run" {
    compute {
      root = result
      prog "p" {
        ~>n:number
        ~>flag:bool
        <~result:number = #if(flag, n + 10, n - 10)
      }
    }
    prepare {
      n { from_state = input.n }
      flag { from_state = input.flag }
    }
    merge { result { to_state = work.n } }
  }
}`,
  },
  {
    name: 'if-medium-two-action-scene',
    pattern: '#if',
    complexity: 'medium',
    entryId: 'if_medium',
    expectPath: 'work.n',
    expectValue: 14,
    initialState: boxed({ 'input.n': 8, 'input.flag': true }),
    src: `${stateBlock}
scene "if_medium" {
  entry_actions = ["first"]
  action "first" {
    compute {
      root = staged
      prog "p1" {
        ~>n:number
        ~>flag:bool
        <~staged:number = #if(flag, n + 1, n + 2)
      }
    }
    prepare {
      n { from_state = input.n }
      flag { from_state = input.flag }
    }
    merge { staged { to_state = work.n } }
    next { action = second }
  }
  action "second" {
    compute {
      root = final
      prog "p2" {
        ~>staged:number
        <~final:number = #if(staged > 10, staged * 2, staged + 5)
      }
    }
    prepare { staged { from_state = work.n } }
    merge { final { to_state = work.n } }
  }
}`,
  },
  {
    name: 'if-high-two-scene-route',
    pattern: '#if',
    complexity: 'high',
    entryId: 'if_route',
    expectPath: 'work.final',
    expectValue: 'large',
    initialState: boxed({ 'input.n': 6, 'input.flag': true }),
    src: `${stateBlock}
scene "if_a" {
  entry_actions = ["done"]
  action "done" {
    compute {
      root = staged
      prog "p1" {
        ~>n:number
        ~>flag:bool
        <~staged:number = #if(flag, n * 2, n + 1)
      }
    }
    prepare {
      n { from_state = input.n }
      flag { from_state = input.flag }
    }
    merge { staged { to_state = work.n } }
  }
}
scene "if_b" {
  entry_actions = ["finish"]
  action "finish" {
    compute {
      root = final
      prog "p2" {
        ~>v:number
        <~final:str = #if(v > 10, "large", "small")
      }
    }
    prepare { v { from_state = work.n } }
    merge { final { to_state = work.final } }
  }
}
route "if_route" {
  match { if_a.done => if_b }
}`,
  },
  {
    name: 'case-low-single-action',
    pattern: '#case',
    complexity: 'low',
    entryId: 'case_low',
    expectPath: 'work.n',
    expectValue: 1,
    initialState: boxed({ 'input.word': 'red' }),
    src: `${stateBlock}
scene "case_low" {
  entry_actions = ["run"]
  action "run" {
    compute {
      root = result
      prog "p" {
        ~>word:str
        <~result:number = #case(word, "red" => 1, "blue" => 2, _ => 0)
      }
    }
    prepare { word { from_state = input.word } }
    merge { result { to_state = work.n } }
  }
}`,
  },
  {
    name: 'case-medium-two-action-scene',
    pattern: '#case',
    complexity: 'medium',
    entryId: 'case_medium',
    expectPath: 'work.final',
    expectValue: 'priority',
    initialState: boxed({ 'input.word': 'vip' }),
    src: `${stateBlock}
scene "case_medium" {
  entry_actions = ["classify"]
  action "classify" {
    compute {
      root = tier
      prog "p1" {
        ~>word:str
        <~tier:str = #case(word, "vip" => "gold", "std" => "silver", _ => "bronze")
      }
    }
    prepare { word { from_state = input.word } }
    merge { tier { to_state = work.label } }
    next { action = emit }
  }
  action "emit" {
    compute {
      root = final
      prog "p2" {
        ~>tier:str
        <~final:str = #case(tier, "gold" => "priority", "silver" => "normal", _ => "slow")
      }
    }
    prepare { tier { from_state = work.label } }
    merge { final { to_state = work.final } }
  }
}`,
  },
  {
    name: 'case-high-two-scene-route',
    pattern: '#case',
    complexity: 'high',
    entryId: 'case_route',
    expectPath: 'work.final',
    expectValue: 'route_warm',
    initialState: boxed({ 'input.word': 'red' }),
    src: `${stateBlock}
scene "case_a" {
  entry_actions = ["done"]
  action "done" {
    compute {
      root = tone
      prog "p1" {
        ~>word:str
        <~tone:str = #case(word, "red" => "warm", "blue" => "cool", _ => "plain")
      }
    }
    prepare { word { from_state = input.word } }
    merge { tone { to_state = work.label } }
  }
}
scene "case_b" {
  entry_actions = ["finish"]
  action "finish" {
    compute {
      root = final
      prog "p2" {
        ~>tone:str
        <~final:str = #case(tone, "warm" => "route_warm", "cool" => "route_cool", _ => "route_plain")
      }
    }
    prepare { tone { from_state = work.label } }
    merge { final { to_state = work.final } }
  }
}
route "case_route" {
  match { case_a.done => case_b }
}`,
  },
  {
    name: 'pipe-low-single-action',
    pattern: '#pipe',
    complexity: 'low',
    entryId: 'pipe_low',
    expectPath: 'work.n',
    expectValue: 18,
    initialState: boxed({ 'input.n': 4 }),
    src: `${stateBlock}
scene "pipe_low" {
  entry_actions = ["run"]
  action "run" {
    compute {
      root = result
      prog "p" {
        ~>n:number
        <~result:number = #pipe(n, add(#it, 2), mul(#it, 3))
      }
    }
    prepare { n { from_state = input.n } }
    merge { result { to_state = work.n } }
  }
}`,
  },
  {
    name: 'pipe-medium-two-action-scene',
    pattern: '#pipe',
    complexity: 'medium',
    entryId: 'pipe_medium',
    expectPath: 'work.n',
    expectValue: 36,
    initialState: boxed({ 'input.n': 2 }),
    src: `${stateBlock}
scene "pipe_medium" {
  entry_actions = ["first"]
  action "first" {
    compute {
      root = staged
      prog "p1" {
        ~>n:number
        <~staged:number = #pipe(n, add(#it, 1), mul(#it, 2))
      }
    }
    prepare { n { from_state = input.n } }
    merge { staged { to_state = work.n } }
    next { action = second }
  }
  action "second" {
    compute {
      root = final
      prog "p2" {
        ~>staged:number
        <~final:number = #pipe(staged, add(#it, 3), mul(#it, 4))
      }
    }
    prepare { staged { from_state = work.n } }
    merge { final { to_state = work.n } }
  }
}`,
  },
  {
    name: 'pipe-high-two-scene-route',
    pattern: '#pipe',
    complexity: 'high',
    entryId: 'pipe_route',
    expectPath: 'work.n',
    expectValue: 41,
    initialState: boxed({ 'input.n': 3 }),
    src: `${stateBlock}
scene "pipe_a" {
  entry_actions = ["done"]
  action "done" {
    compute {
      root = staged
      prog "p1" {
        ~>n:number
        <~staged:number = #pipe(n, add(#it, 4), mul(#it, 2))
      }
    }
    prepare { n { from_state = input.n } }
    merge { staged { to_state = work.n } }
  }
}
scene "pipe_b" {
  entry_actions = ["finish"]
  action "finish" {
    compute {
      root = final
      prog "p2" {
        ~>staged:number
        <~final:number = #pipe(staged, mul(#it, 3), sub(#it, 1))
      }
    }
    prepare { staged { from_state = work.n } }
    merge { final { to_state = work.n } }
  }
}
route "pipe_route" {
  match { pipe_a.done => pipe_b }
}`,
  },
];

describe('v0 local expressions — DSL convert runtime output matrix', () => {
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
