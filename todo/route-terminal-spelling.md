# Where a route says it ends

> Status: decision needed — this is the only thing blocking option C of `route-completion.md`
> Origin: choosing the next piece of work after option A landed, 2026-09-05

## The decision

`route-completion.md` recommends giving route completion an explicit spelling, so
a `_` arm can terminate a route instead of guaranteeing it never ends:

```hcl
route "fulfilment" {
  entry = picking

  to {
    picking.*.pick_complete -> packing,
    packing.*.seal_carton   -> shipping,
    _ -> <terminal>
  }
}
```

Everything about that change is settled except what goes in the angle brackets.
The three other sub-questions have answers recorded in `route-completion.md`: the
wire model keeps `MatchArm.target` as a string with no proto change, the runtime
maps the terminal target to the null that `selectNextScene` already returns for
"complete", and option B's diagnostic becomes easy to justify afterwards.

## Why this is not obvious

The cheapest form is a reserved scene id — `_ -> done`, with `done` meaning
"complete" rather than naming a scene. It needs no lexer entry and no proto
field, and the parser already produces a plain string for the target.

The problem is which word it takes. This is a language for describing flows, and
`done`, `end`, `finish`, and `complete` are precisely the names an author reaches
for when naming a flow's last scene. Reserving one trades a documented trap for a
naming collision, and the collision is worse in one respect: the trap is now
written down in `spec/scene-to-scene.md` §3.2, whereas a scene that cannot be
called `done` is a rule an author meets by hitting it.

A contextual keyword — `end` special only in target position — avoids reserving
the word everywhere, but leaves a subtler version of the same trap. A scene named
`end` stays declarable and reachable by `next`, yet silently unreachable as a
route target. That is worse than an outright collision, because it fails quietly.

A punctuation form cannot collide with any identifier at all. It costs one lexer
entry and reads as cryptic to a newcomer, which is the honest cost.

## Candidates

| Form | Cost | Problem |
| --- | --- | --- |
| `_ -> done` (reserved scene id) | None: no lexer entry, no proto field | Takes a name authors want. Needs a `ReservedSceneId` diagnostic so the collision is at least reported |
| `_ -> end` (contextual keyword) | One lexer entry | A scene named `end` stays declarable but becomes unreachable as a route target — fails quietly |
| `_ -> .` (punctuation) | One lexer entry | Cannot collide, but is cryptic on first reading |

The empty string is technically available — `validate_routes.go:36` already skips
the "target scene is not defined" check when `arm.Target` is empty — but it is
the worst of the options. A terminal arm and an arm whose target was dropped by a
bug would be indistinguishable in the model.

## Recommendation

**A punctuation form, and not a reserved scene id.**

The deciding argument is that a flow language should not take `done` or `end`
from the author. Punctuation is also not foreign here: the surface already leans
on `<~`, `~>`, `:=`, and `|->`, so a symbol in target position is consistent with
how the language already spells its structural operators rather than a new idea.

`_ -> .` is the candidate `route-completion.md` floated. It is unambiguous in
target position, where a path expression cannot otherwise appear. The reservation
is taste: `.` is already the path separator inside patterns (`scene.action`), so
using it alone as a target may read as an unfinished path rather than a
deliberate end.

If that reads badly, the choice is between another symbol and accepting the
contextual keyword. This is a taste decision about the language surface, which is
why it is recorded here rather than settled unilaterally.

## What implementing it touches

Small, and mostly in the Go converter. Named so the change can be scoped before
it is started:

| Stage | Site | Change |
| --- | --- | --- |
| Lexer | `internal/lexer/lexer.go` | One token, unless the reserved-id form is chosen |
| Parser | `internal/parser/parser_route.go:80,98` | `arm.Target = p.parseRefVal()` accepts the terminal form |
| Validation | `internal/validate/validate_routes.go:36` | The terminal target is not required to name a known scene |
| Lowering | `internal/lower/lower.go:125` | `MatchArm{Target: arm.Target}` carries the sentinel through unchanged |
| HCL emit | `internal/emit/emit.go:510` | Emit the terminal form rather than a quoted scene id |
| Runtime | `packages/zig/scene-runner/src/route_ir.zig` | Lower a terminal arm so `selectNextScene` returns null for it |

The runtime half is the smallest part: `Route.arms` already lowers ahead of time,
and `selectNextScene` returning null already means "complete", so a terminal arm
becomes a `MatchArm` whose target resolves to no scene.

## Verification

`route-completion.md` carries the acceptance list. Two of its items are the ones
that prove the change is additive rather than a behaviour change:

- `tests/route-completion.test.ts` currently pins that a `_` arm exhausts the
  transition budget. Under option C, a `_` arm targeting the terminal must
  complete instead, while a `_` arm targeting a real scene must keep failing the
  same way. That test is the one this flips.
- The emitted model for every existing route must be unchanged, since no existing
  file can contain a terminal arm.
