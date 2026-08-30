# TypeScript compatibility

The TypeScript packages keep their current public APIs during the migration.

| Surface | Decision |
| --- | --- |
| packages/ts/runtime Value builders and guards | Retain until Zig wrappers have parity |
| packages/ts/runtime compute builders and validators | Retain as JavaScript utilities |
| packages/ts/runtime graph execution helpers | Deprecate only after the Zig adapter ships |
| createRunner, createSceneRunner, createRouteRunner | Retain signatures and result shapes |
| Runner methods and hook registration | Retain behavior |
| Harness and server entry points | Retain |
| Error, warning, trace, and log shapes | Retain |
| TypeScript scene and route executor | Keep as the reference until conformance passes |

No public export is approved for removal in the current phase. Set a deprecation window in a separately reviewed release plan before marking an export as deprecated.
