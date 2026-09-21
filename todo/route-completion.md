# Diagnose a `_` arm that cannot terminate a route

> Status: proposal (option B below). Options A and C landed 2026-09-08.
> Origin: writing `spec/examples/03-warehouse-route.tu`

## What already landed

A route completes when no match arm matches, and `.` is now the explicit
terminal target, so `_ -> .` says "this is where the route ends" at the point
where a reader looks for it. `spec/scene-to-scene.md` states the implication in
§3.2, in the summary-table interpretation, and in §5, and
`packages/ts/scene-runner/tests/route-completion.test.ts` pins both sides: a
route with its final scene unmatched completes, and the same route with a `_` arm
targeting a real scene exhausts its transition budget instead.

The runtime logic is `selectNextScene` and `matchPattern` in
`packages/zig/scene-runner/src/route.zig`, with patterns lowered ahead of time in
`route_ir.zig`. `Pattern.any` returns the lowest-priority score rather than
declining to match, so `selectNextScene` never returns null while a `_` arm names
a scene.

## What is still open

**Option B: warn when a `_` arm targets a real scene.** Such a route can only
exit by exceeding the transition cap, and nothing says so at conversion time.
Nothing in the converter diagnoses it today — `arm.Target` accepts
`ast.RouteTerminalTarget` (`packages/go/converter/internal/parser/parser_route.go:100`)
or a scene id, with no check on the combination.

The risk that held this back is that a `_` arm is legitimate for a route intended
to run until the host stops it, so it likely wants to be a warning rather than an
error, and warnings that fire on intentional code age badly.

What changed is that the terminal spelling now exists. With `_ -> .` available, a
`_` arm that targets a real scene is clearly suspicious rather than merely
unusual, which is what makes the diagnostic easy to justify — that was recorded
at the time as the reason to do B after C, not before.

## Evidence this is a real trap

The deleted `kitchen-sink-support-pipeline.tu` ended its route with
`_ -> closed`, where scene `closed` had a single terminal action. Once `closed`
finished, nothing matched `closed.*`, so `_` matched again and re-entered
`closed`, indefinitely. The example was checked in, exercised by the
schema-drift converter test, and never run through the route executor, so the
loop was never observed.

Before the explicit terminal landed, `_` and completion were mutually exclusive
and nothing in §3.2 said so — it presents `_` as an ordinary fallback, and a
`default:` does not normally mean "loop forever". The spelling fixed the
expressiveness half of that. The diagnostic is the half that catches the author
who writes the old shape anyway.

## Verification

- a route whose `_` arm targets a real scene reports the warning, naming the arm
- a route whose `_` arm targets `.` reports nothing
- a route with no `_` arm reports nothing — the shape every existing example uses
- the emitted model is unchanged in all three cases: this is a diagnostic, not a
  lowering change
- the executor's transition-cap path still fires for a genuine cycle between two
  scenes, since that is a different failure and must stay reachable
