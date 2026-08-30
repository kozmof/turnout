const std = @import("std");
const model_runtime = @import("model.zig");
const scene_runtime = @import("scene.zig");
const state_runtime = @import("state.zig");
const turnout_value = @import("value.zig");

pub const default_max_transitions: usize = 1_000;

pub const HistoryEntry = struct {
    scene_id: []const u8,
    action_id: []const u8,
};

const Score = struct { wildcards: usize, suffix_len: usize };

pub const Result = struct {
    final_state: state_runtime.State,
    history: []HistoryEntry,
    scenes: []const []const u8,

    pub fn deinit(self: *Result, allocator: std.mem.Allocator) void {
        self.final_state.deinit(allocator);
        allocator.free(self.history);
        allocator.free(self.scenes);
        self.* = undefined;
    }
};

pub const Failure = struct {
    err: anyerror,
    partial_state: state_runtime.State,
    failed_scene_id: []const u8,

    pub fn deinit(self: *Failure, allocator: std.mem.Allocator) void {
        self.partial_state.deinit(allocator);
        self.* = undefined;
    }
};

pub const SafeResult = union(enum) {
    success: Result,
    failure: Failure,

    pub fn deinit(self: *SafeResult, allocator: std.mem.Allocator) void {
        switch (self.*) {
            .success => |*result| result.deinit(allocator),
            .failure => |*failure| failure.deinit(allocator),
        }
        self.* = undefined;
    }
};

pub fn selectNextScene(
    history: []const HistoryEntry,
    arms: std.json.Value,
    current_scene_id: []const u8,
) !?[]const u8 {
    if (arms != .array) return error.InvalidRoute;
    var best_target: ?[]const u8 = null;
    var best_score: ?Score = null;
    for (arms.array.items) |arm| {
        if (arm != .object) return error.InvalidRoute;
        const patterns = arm.object.get("patterns") orelse return error.InvalidRoute;
        const target = arm.object.get("target") orelse return error.InvalidRoute;
        if (patterns != .array or target != .string) return error.InvalidRoute;
        var arm_score: ?Score = null;
        for (patterns.array.items) |pattern| {
            if (pattern != .string) return error.InvalidRoute;
            const score = matchPattern(pattern.string, history, current_scene_id) orelse continue;
            if (arm_score == null or better(score, arm_score.?)) arm_score = score;
        }
        if (arm_score) |score| {
            if (best_score == null or better(score, best_score.?)) {
                best_score = score;
                best_target = target.string;
            }
        }
    }
    return best_target;
}

pub fn execute(
    model: *const model_runtime.RuntimeModel,
    route_id: []const u8,
    initial_state: *const state_runtime.State,
    max_scene_steps: usize,
    max_transitions: usize,
    allocator: std.mem.Allocator,
) !Result {
    var current_state = try initial_state.snapshot(allocator);
    defer current_state.deinit(allocator);
    var current_scene: []const u8 = "";
    return executeOwned(
        model,
        route_id,
        &current_state,
        &current_scene,
        max_scene_steps,
        max_transitions,
        allocator,
    );
}

pub fn executeSafe(
    model: *const model_runtime.RuntimeModel,
    route_id: []const u8,
    initial_state: *const state_runtime.State,
    max_scene_steps: usize,
    max_transitions: usize,
    allocator: std.mem.Allocator,
) !SafeResult {
    var current_state = try initial_state.snapshot(allocator);
    errdefer current_state.deinit(allocator);
    var current_scene: []const u8 = "";
    const result = executeOwned(
        model,
        route_id,
        &current_state,
        &current_scene,
        max_scene_steps,
        max_transitions,
        allocator,
    ) catch |err| {
        const partial_state = current_state;
        current_state = .{};
        return .{ .failure = .{
            .err = err,
            .partial_state = partial_state,
            .failed_scene_id = current_scene,
        } };
    };
    return .{ .success = result };
}

fn executeOwned(
    model: *const model_runtime.RuntimeModel,
    route_id: []const u8,
    current_state: *state_runtime.State,
    current_scene: *[]const u8,
    max_scene_steps: usize,
    max_transitions: usize,
    allocator: std.mem.Allocator,
) !Result {
    const route = findRoute(model, route_id) orelse return error.RouteNotFound;
    const entry = route.get("entrySceneId") orelse return error.NoEntryScene;
    const arms = route.get("match") orelse return error.InvalidRoute;
    if (entry != .string or entry.string.len == 0) return error.NoEntryScene;
    current_scene.* = entry.string;
    var history = std.ArrayList(HistoryEntry).empty;
    errdefer history.deinit(allocator);
    var scenes = std.ArrayList([]const u8).empty;
    errdefer scenes.deinit(allocator);
    var transitions: usize = 0;
    while (true) {
        const history_start = history.items.len;
        var scene_result = try scene_runtime.execute(
            model,
            current_scene.*,
            current_state,
            max_scene_steps,
            allocator,
        );
        defer scene_result.deinit(allocator);
        current_state.deinit(allocator);
        current_state.* = scene_result.takeState();
        try scenes.append(allocator, current_scene.*);
        for (scene_result.traces) |trace|
            try history.append(allocator, .{ .scene_id = current_scene.*, .action_id = trace.action_id });
        const next = try selectNextScene(history.items[history_start..], arms, current_scene.*);
        if (next == null) break;
        transitions += 1;
        if (transitions > max_transitions) return error.MaxRouteTransitionsExceeded;
        current_scene.* = next.?;
    }
    const history_slice = try history.toOwnedSlice(allocator);
    errdefer allocator.free(history_slice);
    const scene_slice = try scenes.toOwnedSlice(allocator);
    const final_state = current_state.*;
    current_state.* = .{};
    return .{ .final_state = final_state, .history = history_slice, .scenes = scene_slice };
}

fn better(candidate: Score, current: Score) bool {
    if (candidate.wildcards != current.wildcards) return candidate.wildcards < current.wildcards;
    return candidate.suffix_len > current.suffix_len;
}

fn matchPattern(
    raw: []const u8,
    history: []const HistoryEntry,
    current_scene_id: []const u8,
) ?Score {
    if (std.mem.eql(u8, raw, "_")) return .{
        .wildcards = std.math.maxInt(usize),
        .suffix_len = 0,
    };
    var parts = std.mem.splitScalar(u8, raw, '.');
    const scene_id = parts.next() orelse "";
    if (!std.mem.eql(u8, scene_id, current_scene_id)) return null;
    const first = parts.next();
    const wildcard = first != null and std.mem.eql(u8, first.?, "*");
    var suffix_len: usize = if (first == null or wildcard) 0 else 1;
    while (parts.next() != null) suffix_len += 1;

    const block = firstBlock(history, scene_id);
    if (block.len == 0) return null;
    if (!wildcard and block.len != suffix_len) return null;
    if (wildcard and block.len < suffix_len) return null;
    const offset = block.len - suffix_len;
    parts = std.mem.splitScalar(u8, raw, '.');
    _ = parts.next();
    if (wildcard) _ = parts.next();
    var index: usize = 0;
    while (parts.next()) |expected| : (index += 1)
        if (!std.mem.eql(u8, expected, block[offset + index].action_id)) return null;
    return .{ .wildcards = if (wildcard) 1 else 0, .suffix_len = suffix_len };
}

fn firstBlock(history: []const HistoryEntry, scene_id: []const u8) []const HistoryEntry {
    var start: ?usize = null;
    for (history, 0..) |entry, index| {
        if (std.mem.eql(u8, entry.scene_id, scene_id)) {
            if (start == null) start = index;
        } else if (start) |begin| {
            return history[begin..index];
        }
    }
    return if (start) |begin| history[begin..] else &.{};
}

fn findRoute(model: *const model_runtime.RuntimeModel, route_id: []const u8) ?std.json.ObjectMap {
    const routes = model.root().get("routes") orelse return null;
    if (routes != .array) return null;
    for (routes.array.items) |route| {
        if (route != .object) continue;
        const id = route.object.get("id") orelse continue;
        if (id == .string and std.mem.eql(u8, id.string, route_id)) return route.object;
    }
    return null;
}

test "route pattern priority matches exact wildcard and catchall" {
    const allocator = std.testing.allocator;
    const arms_json =
        \\[
        \\  {"patterns":["_"],"target":"fallback"},
        \\  {"patterns":["s1.*.final"],"target":"wild"},
        \\  {"patterns":["s1.final"],"target":"exact"}
        \\]
    ;
    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, arms_json, .{});
    defer parsed.deinit();
    const one = [_]HistoryEntry{.{ .scene_id = "s1", .action_id = "final" }};
    try std.testing.expectEqualStrings("exact", (try selectNextScene(&one, parsed.value, "s1")).?);
    const many = [_]HistoryEntry{
        .{ .scene_id = "s1", .action_id = "intro" },
        .{ .scene_id = "s1", .action_id = "final" },
    };
    try std.testing.expectEqualStrings("wild", (try selectNextScene(&many, parsed.value, "s1")).?);
}

test "route executes scene transitions and shares state" {
    const fixture =
        \\{"version":2,
        \\ "routes":[{"id":"main","entrySceneId":"s1","match":[
        \\   {"patterns":["s1.a"],"target":"s2"}
        \\ ]}],
        \\ "scenes":[
        \\   {"id":"s1","entryAction":"a","actions":[{"id":"a",
        \\     "compute":{"root":"out","prog":{"bindings":[{"name":"out","type":"number","value":1}]}},
        \\     "merge":[{"binding":"out","toState":"one"}]
        \\   }]},
        \\   {"id":"s2","entryAction":"b","actions":[{"id":"b",
        \\     "compute":{"root":"out","prog":{"bindings":[{"name":"out","type":"number","value":2}]}},
        \\     "merge":[{"binding":"out","toState":"two"}]
        \\   }]}
        \\ ]}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var result = try execute(&model, "main", &state, scene_runtime.default_max_steps, default_max_transitions, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 2), result.scenes.len);
    try std.testing.expectEqual(@as(usize, 2), result.history.len);
    try std.testing.expect(try result.final_state.exists("one"));
    try std.testing.expect(try result.final_state.exists("two"));
}

test "route transition limit fails on the transition after the limit" {
    const fixture =
        \\{"version":2,
        \\ "routes":[{"id":"loop","entrySceneId":"s","match":[
        \\   {"patterns":["_"],"target":"s"}
        \\ ]}],
        \\ "scenes":[{"id":"s","entryAction":"a","actions":[{"id":"a"}]}]
        \\}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    try std.testing.expectError(
        error.MaxRouteTransitionsExceeded,
        execute(&model, "loop", &state, scene_runtime.default_max_steps, 1, std.testing.allocator),
    );
    try std.testing.expectError(
        error.MaxRouteTransitionsExceeded,
        execute(&model, "loop", &state, scene_runtime.default_max_steps, 0, std.testing.allocator),
    );
}

test "safe route result keeps state from last completed scene" {
    const fixture =
        \\{"version":2,
        \\ "routes":[{"id":"main","entrySceneId":"s1","match":[
        \\   {"patterns":["s1.a"],"target":"s2"}
        \\ ]}],
        \\ "scenes":[
        \\   {"id":"s1","entryAction":"a","actions":[{"id":"a",
        \\     "compute":{"root":"out","prog":{"bindings":[
        \\       {"name":"out","type":"number","value":1}
        \\     ]}},
        \\     "merge":[{"binding":"out","toState":"committed"}]
        \\   }]},
        \\   {"id":"s2","entryAction":"b","actions":[{"id":"b",
        \\     "compute":{"root":"out","prog":{"bindings":[
        \\       {"name":"out","type":"number","expr":{
        \\         "combine":{"fn":"not_a_function","args":[{"lit":1},{"lit":2}]}
        \\       }}
        \\     ]}}
        \\   }]}
        \\ ]}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var safe = try executeSafe(
        &model,
        "main",
        &state,
        scene_runtime.default_max_steps,
        default_max_transitions,
        std.testing.allocator,
    );
    defer safe.deinit(std.testing.allocator);
    switch (safe) {
        .success => return error.TestExpectedFailure,
        .failure => |*failure| {
            try std.testing.expectEqual(error.UnknownFunction, failure.err);
            try std.testing.expectEqualStrings("s2", failure.failed_scene_id);
            var committed = try failure.partial_state.read("committed", std.testing.allocator);
            defer committed.deinit(std.testing.allocator);
            try std.testing.expectEqual(@as(f64, 1), committed.value.number);
        },
    }
}

test "safe route success owns the normal result" {
    const fixture =
        \\{"version":2,
        \\ "routes":[{"id":"main","entrySceneId":"only","match":[]}],
        \\ "scenes":[{"id":"only","entryAction":"done","actions":[{"id":"done"}]}]
        \\}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var safe = try executeSafe(
        &model,
        "main",
        &state,
        scene_runtime.default_max_steps,
        default_max_transitions,
        std.testing.allocator,
    );
    defer safe.deinit(std.testing.allocator);
    switch (safe) {
        .success => |result| try std.testing.expectEqual(@as(usize, 1), result.scenes.len),
        .failure => return error.TestUnexpectedFailure,
    }
}
