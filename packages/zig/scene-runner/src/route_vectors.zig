const std = @import("std");
const model_runtime = @import("model.zig");
const route_runtime = @import("route.zig");
const scene_runtime = @import("scene.zig");
const state_runtime = @import("state.zig");
const turnout_value = @import("turnout_runtime").value;

const ExpectedState = struct { path: []const u8, value: f64 };
const ExpectedLog = struct {
    kind: []const u8,
    sceneId: []const u8,
    actionId: []const u8,
    stepIndex: ?usize = null,
};
const ExpectedTrace = struct {
    sceneId: []const u8,
    actionId: []const u8,
    root: f64,
    nextActions: []const []const u8,
    warnings: []const ExpectedWarning,
};
const ExpectedWarning = struct {
    kind: []const u8,
    writtenPaths: []const []const u8 = &.{},
};
const ExpectedSceneWarning = struct {
    actionId: []const u8,
    firstEnqueuedBy: ?[]const u8,
};
const Output = struct {
    state: []const ExpectedState,
    history: []const []const u8,
    logs: []const ExpectedLog,
    traces: []const ExpectedTrace,
    sceneWarnings: []const ExpectedSceneWarning,
};
const Vector = struct { name: []const u8, routeId: []const u8, model: []const u8, output: Output };

test "shared scene and route vectors" {
    const allocator = std.testing.allocator;
    const parsed = try std.json.parseFromSlice(
        []Vector,
        allocator,
        @embedFile("fixtures/scene-route-vectors.json"),
        .{},
    );
    defer parsed.deinit();
    for (parsed.value) |vector| {
        var model = try model_runtime.RuntimeModel.init(allocator, vector.model, .{});
        defer model.deinit();
        const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
        var state = try state_runtime.State.initUnchecked(&empty, allocator);
        defer state.deinit(allocator);
        var result = try route_runtime.execute(
            &model,
            vector.routeId,
            &state,
            scene_runtime.default_max_steps,
            route_runtime.default_max_transitions,
            allocator,
        );
        defer result.deinit(allocator);
        for (vector.output.state) |expected| {
            var actual = try result.final_state.read(expected.path, allocator);
            defer actual.deinit(allocator);
            try std.testing.expectEqual(expected.value, actual.value.number);
        }
        try std.testing.expectEqual(vector.output.history.len, result.history.len);
        for (vector.output.history, result.history) |expected, actual| {
            const joined = try std.fmt.allocPrint(allocator, "{s}.{s}", .{
                actual.scene_id,
                actual.action_id,
            });
            defer allocator.free(joined);
            try std.testing.expectEqualStrings(expected, joined);
        }
        try std.testing.expectEqual(vector.output.logs.len, result.logs.len);
        for (vector.output.logs, result.logs) |expected, actual| {
            const kind = switch (actual.kind) {
                .action_start => "action-start",
                .warning => "warning",
                .action_complete => "action-complete",
            };
            try std.testing.expectEqualStrings(expected.kind, kind);
            try std.testing.expectEqualStrings(expected.sceneId, actual.scene_id);
            try std.testing.expectEqualStrings(expected.actionId, actual.action_id);
            try std.testing.expectEqual(expected.stepIndex, actual.step_index);
        }
        var trace_index: usize = 0;
        for (result.traces) |scene_trace| {
            for (scene_trace.actions) |action_trace| {
                const expected = vector.output.traces[trace_index];
                trace_index += 1;
                try std.testing.expectEqualStrings(expected.sceneId, scene_trace.scene_id);
                try std.testing.expectEqualStrings(expected.actionId, action_trace.action_id);
                try std.testing.expectEqual(expected.root, action_trace.compute_root.value.number);
                const actual_next_len: usize = if (action_trace.next_action_id == null) 0 else 1;
                try std.testing.expectEqual(expected.nextActions.len, actual_next_len);
                if (action_trace.next_action_id) |next|
                    try std.testing.expectEqualStrings(expected.nextActions[0], next);
                const warning_count = action_trace.merge_warnings.len +
                    @as(usize, if (action_trace.unchecked_write_paths.len > 0) 1 else 0) +
                    action_trace.next_warnings.len;
                try std.testing.expectEqual(expected.warnings.len, warning_count);
                var warning_index: usize = 0;
                for (action_trace.merge_warnings) |_| {
                    try std.testing.expectEqualStrings(
                        expected.warnings[warning_index].kind,
                        "merge_warning",
                    );
                    warning_index += 1;
                }
                if (action_trace.unchecked_write_paths.len > 0) {
                    const warning = expected.warnings[warning_index];
                    warning_index += 1;
                    try std.testing.expectEqualStrings(warning.kind, "unchecked_state_write");
                    try std.testing.expectEqual(
                        warning.writtenPaths.len,
                        action_trace.unchecked_write_paths.len,
                    );
                    for (warning.writtenPaths, action_trace.unchecked_write_paths) |path, actual|
                        try std.testing.expectEqualStrings(path, actual);
                }
                for (action_trace.next_warnings) |warning| {
                    const kind = switch (warning.kind) {
                        .invalid_condition => "invalid_next_condition",
                        .missing_program => "missing_next_compute_prog",
                    };
                    try std.testing.expectEqualStrings(
                        expected.warnings[warning_index].kind,
                        kind,
                    );
                    warning_index += 1;
                }
            }
        }
        try std.testing.expectEqual(vector.output.traces.len, trace_index);
        var scene_warning_index: usize = 0;
        for (result.traces) |scene_trace| {
            for (scene_trace.duplicate_warnings) |warning| {
                const expected = vector.output.sceneWarnings[scene_warning_index];
                scene_warning_index += 1;
                try std.testing.expectEqualStrings(expected.actionId, warning.action_id);
                if (expected.firstEnqueuedBy) |source|
                    try std.testing.expectEqualStrings(source, warning.first_enqueued_by.?)
                else
                    try std.testing.expect(warning.first_enqueued_by == null);
            }
        }
        try std.testing.expectEqual(vector.output.sceneWarnings.len, scene_warning_index);
    }
}
