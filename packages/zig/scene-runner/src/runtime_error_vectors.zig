//! The gate on `runtime_error.zig`'s mapping.
//!
//! `fromError` ends in `.execution_failed`, which means a driver error nobody
//! mapped is indistinguishable from one that has no better name. Every other
//! contract crossing a language boundary in this repository is pinned — field
//! types, function aliases, the runtime projection, the shared bounds, the
//! structural rules, the event kinds — and this one was not. What it cost:
//! `error.PrepareHookFailed` and `error.PublishHookFailed` were raised on live
//! driver paths and collapsed to `.execution_failed` here, while the WASM host
//! reads `@errorName` straight off the boundary and so surfaced both by name.
//! The two hosts disagreed about what a run had done, and no test noticed.
//!
//! So: every error in a gated set either has a row in `runtime_error.mappings`
//! or a row in `unmapped` below saying why it does not need one. An error in
//! neither fails this test. That is the same shape as `structural-rules.json`'s
//! `hostOnly` list — classify it or the gate fails.
const std = @import("std");
const runner = @import("runner.zig");
const runtime_error = @import("runtime_error.zig");
const state_runtime = @import("state.zig");

/// An error that deliberately has no code of its own, and the reason.
const Unmapped = struct { err: anyerror, why: []const u8 };

/// Errors that reach `fromError` and should stay `.execution_failed`.
///
/// Two groups. The effect-protocol errors are raised when a host drives the
/// runtime wrongly — resuming an effect that is not pending, resuming one twice,
/// beginning an action while one is already running. They are bugs in the host,
/// not outcomes of the flow, and a caller cannot act on them the way it acts on
/// a hook that failed. The second group is model well-formedness, which
/// `structure.zig` itemises before a runtime exists at all, so reaching it here
/// means something already reported it better.
const unmapped = [_]Unmapped{
    .{ .err = error.Terminal, .why = "the action has no next rule; the scene driver handles it" },
    .{ .err = error.PendingEffect, .why = "host stepped with an effect still outstanding" },
    .{ .err = error.NoPendingEffect, .why = "host resumed an effect that was never requested" },
    .{ .err = error.StaleEffect, .why = "host resumed an effect id that is already settled" },
    .{ .err = error.WrongEffectKind, .why = "host answered a prepare effect with a publish result" },
    .{ .err = error.EffectIdOverflow, .why = "effect ids exhausted; not a flow outcome" },
    .{ .err = error.EffectNotCompleted, .why = "host read a payload before answering the effect" },
    .{ .err = error.InvalidPreparePayload, .why = "host sent a resume payload the runtime cannot read" },
    .{ .err = error.ActionInProgress, .why = "host began an action while one was running" },
    .{ .err = error.InvalidStateModel, .why = "structure.zig itemises this before the runtime loads" },
};

/// The declared error sets this gate covers.
///
/// Both are the drivers' own, declared rather than inferred, and both reach
/// `fromError` through `scene.executeSafe` and `route.executeSafe`. The sets
/// behind them — the evaluator's, the preset kernel's — are reached through
/// these and are errors about one expression rather than about the run, so they
/// are left to `.execution_failed` on purpose and not enumerated here.
const gated = [_]type{ runner.RuntimeError, state_runtime.StateError };

fn isUnmapped(err: anyerror) bool {
    for (unmapped) |entry| {
        if (entry.err == err) return true;
    }
    return false;
}

test "every driver error is mapped to a code or classified as unmapped" {
    var missing: usize = 0;
    inline for (gated) |set| {
        inline for (@typeInfo(set).error_set.?) |field| {
            const err = @field(anyerror, field.name);
            const classified = runtime_error.fromError(err) != .execution_failed or isUnmapped(err);
            if (!classified) {
                std.debug.print(
                    "error.{s} has no code in runtime_error.mappings and is not in `unmapped`\n",
                    .{field.name},
                );
                missing += 1;
            }
        }
    }
    try std.testing.expectEqual(@as(usize, 0), missing);
}

test "no classified error is also mapped" {
    for (unmapped) |entry| {
        if (runtime_error.fromError(entry.err) != .execution_failed) {
            std.debug.print(
                "error.{s} is in `unmapped` but runtime_error.mappings gives it a code\n",
                .{@errorName(entry.err)},
            );
            return error.ContradictoryClassification;
        }
    }
}

test "every code except the fallback is reachable from some error" {
    var unreachable_codes: usize = 0;
    inline for (@typeInfo(runtime_error.Code).@"enum".fields) |field| {
        const code = @field(runtime_error.Code, field.name);
        if (comptime code != .execution_failed) {
            var found = false;
            for (runtime_error.mappings) |entry| {
                if (entry.code == code) found = true;
            }
            if (!found) {
                std.debug.print("Code.{s} is declared but no error maps to it\n", .{field.name});
                unreachable_codes += 1;
            }
        }
    }
    try std.testing.expectEqual(@as(usize, 0), unreachable_codes);
}
