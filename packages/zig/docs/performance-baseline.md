# Performance baseline

This baseline compares full scene execution through the TypeScript and Zig/WASM engines. It is a local reference for the migration, not a release threshold.

## Method

Run the benchmark with the shipped build artifacts.

```sh
pnpm run benchmark:scene-runner
```

Each engine runs in a separate Node process. The benchmark warms up 100 runners, then measures 1,000 runners. Every runner executes the same 20-action scene. Each action evaluates a three-binding numeric compute program. Runner creation and result decoding are included. Module loading and WASM compilation are outside the timed window.

Memory samples use V8 heap statistics because the managed test environment denies Node access to the operating-system RSS counter. The Zig measurement also reads WASM linear-memory size from the runtime client. Peak and retained values are changes from the post-warmup baseline. Retained values are sampled after an explicit garbage collection.

## Recorded results

Recorded on 2026-09-01 with Node v25.9.0 on `linux-x64`. Three isolated trials produced these ranges.

| Metric | TypeScript | Zig/WASM |
| --- | ---: | ---: |
| Runs per second | 956 to 996 | 533 to 553 |
| Microseconds per action | 50.2 to 52.3 | 90.4 to 93.8 |
| Peak V8 heap growth | 98.2 to 106.7 MB | 8.4 to 8.9 MB |
| Retained V8 heap growth | 2.58 to 2.60 MB | 0.278 MB |
| WASM linear memory after warmup | not applicable | 1.875 MiB |
| WASM linear-memory growth during measurement | not applicable | 0 bytes |

TypeScript is about 1.8 times faster on this small compute-heavy workload. Zig/WASM shows about one-tenth of the peak V8 heap growth and about one-ninth of the retained V8 heap growth. These results describe this machine and workload only. Compare future runs with the raw JSON output from the same command and environment.
