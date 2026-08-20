# A route cannot say where it ends

> Status: design gap, not a defect — the implementation matches the spec
> Origin: writing `spec/examples/03-warehouse-route.tu`

## The problem

A route completes when no match arm matches. That is stated plainly in `scene-to-scene.md` §136 ("If no pattern matches and no `_` fallback is present, the route enters a terminal `completed` state") and again at §188, and the runtime does exactly that — `route-executor.ts:150`:

```ts
const nextSceneId = selectNextScene(sceneHistory, parsedArms, progress.currentSceneId);
if (nextSceneId === null) break; // No arm matched — route completes.
```

The gap is the implication, which is written down nowhere: **a `match` block containing `_` can never complete.** A catchall is always eligible (`route-pattern.ts:149` — scene-specific patterns are filtered to the just-terminated scene, `_` is not filtered at all), so `selectNextScene` never returns null, the loop never breaks, and the route runs until `maxRouteTransitions` and throws `MaxRouteTransitionsExceeded`.

So route termination is expressed by *absence*. There is no way to write "this is where the route ends" — you say it by leaving a scene unmatched, which is invisible at the point where a reader is looking for it.

§3.2 presents `_` as an ordinary fallback:

> The `_` pattern matches any route history unconditionally. It MUST appear at most once per `match` block and SHOULD be the last arm.

Nothing there suggests that adding one forecloses completion. `_` reads exactly like a `default:` case, and a `default:` does not normally mean "loop forever".

## Evidence this is a real trap

The deleted `kitchen-sink-support-pipeline.tu` ended its route with `_ -> closed`, where scene `closed` had a single terminal action. Once `closed` finished, nothing matched `closed.*`, so `_` matched again and re-entered `closed` — indefinitely. The example was checked in, exercised by the schema-drift converter test, and never run through the route executor, so the loop was never observed.

`spec/examples/03-warehouse-route.tu` therefore omits `_` on purpose and explains why in a comment. That is the right shape for the example, but it means the file demonstrates four of the five route path forms and has to editorialise about the fifth.

## Options

**A. Document only.** State the implication in §3.2 and in the `_` row of the summary tables. Cheapest, changes no code, and the trap stays available — an author still has to know that `_` and completion are mutually exclusive.

**B. Diagnose `_` when it cannot terminate.** Warn when a match block has a `_` arm, since such a route can only exit by exceeding the transition cap. Cheap and catches the kitchen-sink mistake at conversion time. Risk: a `_` arm is legitimate for a route intended to run until the host stops it, so this may need to be a warning rather than an error, and warnings that fire on intentional code age badly.

**C. Give completion a spelling.** Add an explicit terminal target so a route can name its own end:

```hcl
route "fulfilment" {
  entry = picking

  to {
    picking.*.pick_complete -> packing,
    packing.*.seal_carton   -> shipping,
    _ -> done
  }
}
```

`done` (or `end`, or `_ -> .`) would be a reserved target meaning "complete the route", making `_` safe and termination visible at the point of decision. This is the only option that lets a reader see where a route ends without reasoning about which paths are unmatched.

**C is the recommended direction**, with A done immediately regardless, because the documentation is wrong-by-omission today and that is true under every option.

Whoever picks up C must settle:

- **Where the terminal lives.** A reserved scene id is the smallest change and needs no proto field, but it collides with any real scene of that name. A distinct token (`_ -> end`, with `end` a keyword) avoids collisions at the cost of a lexer entry.
- **Wire model.** `MatchArm.target` is a string today. A reserved value keeps the proto unchanged; a separate `terminal` flag does not. Prefer the former, consistent with the "no proto churn for surface features" line the recent syntax work held.
- **Runtime.** `selectNextScene` returns `string | null` and null already means complete, so the executor needs no new state — the arm resolution just maps the terminal target to null. That is a small, well-isolated change.
- **Interaction with B.** With C available, a `_` arm that targets a real scene becomes clearly suspicious, and the diagnostic in B gets much easier to justify.

## Verification

- a route whose `_` arm targets the terminal completes with a `completed` trace rather than throwing `MaxRouteTransitionsExceeded`
- a route with no `_` arm behaves exactly as it does today — this is the check that proves the change is additive
- the emitted model for every existing route is unchanged
- `spec/examples/03-warehouse-route.tu` can carry a `_` arm and drop the paragraph explaining its absence, which is the readability outcome this is for
- the executor's transition-cap path still fires for a genuine cycle between two scenes, since that is a different failure and must stay reachable
