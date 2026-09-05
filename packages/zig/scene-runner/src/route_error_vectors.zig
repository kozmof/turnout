const std = @import("std");
const model_runtime = @import("model.zig");
const route_runtime = @import("route.zig");
const runtime_error = @import("runtime_error.zig");
const scene_runtime = @import("scene.zig");
const state_runtime = @import("state.zig");
const turnout_value = @import("turnout_runtime").value;

const ExpectedState = struct { path: []const u8, value: f64 };
const Expected = struct {
    code: []const u8,
    failedSceneId: []const u8,
    partialState: []const ExpectedState,
};
const Vector = struct {
    name: []const u8,
    routeId: []const u8,
    model: []const u8,
    maxRouteTransitions: usize = route_runtime.default_max_transitions,
    expected: Expected,
};

test "shared scene and route error vectors" {
    const allocator = std.testing.allocator;
    const parsed = try std.json.parseFromSlice(
        []Vector,
        allocator,
        @embedFile("fixtures/scene-route-error-vectors.json"),
        .{},
    );
    defer parsed.deinit();
    for (parsed.value) |vector| {
        var model = try model_runtime.RuntimeModel.init(allocator, vector.model, .{});
        defer model.deinit();
        const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
        var state = try state_runtime.State.initUnchecked(&empty, allocator);
        defer state.deinit(allocator);
        var safe = try route_runtime.executeSafe(
            &model,
            vector.routeId,
            &state,
            scene_runtime.default_max_steps,
            vector.maxRouteTransitions,
            allocator,
        );
        defer safe.deinit(allocator);
        switch (safe) {
            .success => return error.TestExpectedFailure,
            .failure => |*failure| {
                try std.testing.expectEqualStrings(vector.expected.code, codeName(failure.code));
                try std.testing.expectEqualStrings(
                    vector.expected.failedSceneId,
                    failure.failed_scene_id,
                );
                for (vector.expected.partialState) |expected| {
                    var actual = try failure.partial_state.read(expected.path, allocator);
                    defer actual.deinit(allocator);
                    try std.testing.expectEqual(expected.value, actual.value.number);
                }
            },
        }
    }
}

fn codeName(code: runtime_error.Code) []const u8 {
    return switch (code) {
        .unknown_function => "UnknownFunction",
        .max_route_transitions_exceeded => "MaxRouteTransitionsExceeded",
        else => "UnexpectedCode",
    };
}
