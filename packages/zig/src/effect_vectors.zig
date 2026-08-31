const std = @import("std");
const effect = @import("effect.zig");
const model_runtime = @import("model.zig");
const runtime = @import("runtime.zig");
const state_runtime = @import("state.zig");
const value = @import("value.zig");

const Vector = struct {
    name: []const u8,
    model: []const u8,
    prepareValue: f64,
    expectedState: f64,
    effectOrder: []const []const u8,
    publishContext: []const u8,
};

test "shared effect vectors" {
    const allocator = std.testing.allocator;
    const parsed = try std.json.parseFromSlice(
        []Vector,
        allocator,
        @embedFile("fixtures/effect-vectors.json"),
        .{},
    );
    defer parsed.deinit();
    for (parsed.value) |vector| {
        var model = try model_runtime.RuntimeModel.init(allocator, vector.model, .{});
        defer model.deinit();
        const empty: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
        var initial = try state_runtime.State.initUnchecked(&empty, allocator);
        defer initial.deinit(allocator);
        var driver = try runtime.SceneDriver.init(allocator, &model, "main", &initial);
        defer driver.deinit();

        const prepare = (try driver.step(&model, true)).need_effect;
        try expectEffect(vector.effectOrder[0], prepare);
        const payload = try std.fmt.allocPrint(
            allocator,
            "{{\"symbol\":\"number\",\"value\":{d},\"tags\":[]}}",
            .{vector.prepareValue},
        );
        defer allocator.free(payload);
        try driver.@"resume"(prepare.id, .{ .prepare = .{ .ok = payload } });

        const publish = (try driver.step(&model, true)).need_effect;
        try expectEffect(vector.effectOrder[1], publish);
        try std.testing.expectEqualStrings(vector.publishContext, publish.context_json);
        try driver.@"resume"(publish.id, .{ .publish = .ok });
        _ = (try driver.step(&model, true)).action_complete;
        try std.testing.expect((try driver.step(&model, true)) == .complete);
        var final_state = try driver.partialState().read("result.value", allocator);
        defer final_state.deinit(allocator);
        try std.testing.expectEqual(vector.expectedState, final_state.value.number);
    }
}

fn expectEffect(expected: []const u8, request: effect.Request) !void {
    const separator = std.mem.indexOfScalar(u8, expected, ':') orelse return error.InvalidVector;
    try std.testing.expectEqualStrings(expected[0..separator], @tagName(request.kind));
    try std.testing.expectEqualStrings(expected[separator + 1 ..], request.hook);
}
