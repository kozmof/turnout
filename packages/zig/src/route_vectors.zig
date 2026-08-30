const std = @import("std");
const model_runtime = @import("model.zig");
const route_runtime = @import("route.zig");
const scene_runtime = @import("scene.zig");
const state_runtime = @import("state.zig");
const turnout_value = @import("value.zig");

const ExpectedState = struct { path: []const u8, value: f64 };
const ExpectedLog = struct {
    kind: []const u8,
    sceneId: []const u8,
    actionId: []const u8,
    stepIndex: ?usize = null,
};
const Output = struct {
    state: []const ExpectedState,
    history: []const []const u8,
    logs: []const ExpectedLog,
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
    }
}
