const std = @import("std");
const model_runtime = @import("model.zig");
const route_ir = @import("route_ir.zig");
const runtime_error = @import("runtime_error.zig");
const scene_runtime = @import("scene.zig");
const state_runtime = @import("state.zig");
const turnout_value = @import("turnout_runtime").value;

pub const default_max_transitions: usize = 1_000;

/// One action that has run, in order. History accumulates for a whole route and
/// is read by pattern matching on every transition.
///
/// It owns its ids rather than borrowing them from the model. History is the
/// only run-scoped structure that referenced the parsed tree, so owning two
/// short strings per entry is what lets a route outlive the model it started on.
pub const HistoryEntry = struct {
    scene_id: []const u8,
    action_id: []const u8,

    pub fn init(
        scene_id: []const u8,
        action_id: []const u8,
        allocator: std.mem.Allocator,
    ) !HistoryEntry {
        const scene = try allocator.dupe(u8, scene_id);
        errdefer allocator.free(scene);
        return .{ .scene_id = scene, .action_id = try allocator.dupe(u8, action_id) };
    }

    pub fn deinit(self: *HistoryEntry, allocator: std.mem.Allocator) void {
        allocator.free(self.scene_id);
        allocator.free(self.action_id);
        self.* = undefined;
    }
};

pub fn deinitHistory(history: *std.ArrayList(HistoryEntry), allocator: std.mem.Allocator) void {
    for (history.items) |*entry| entry.deinit(allocator);
    history.deinit(allocator);
}

const Score = struct { wildcards: usize, suffix_len: usize };

pub const SceneTrace = struct {
    scene_id: []const u8,
    actions: []scene_runtime.ActionTrace,
    duplicate_warnings: []scene_runtime.DuplicateEnqueueWarning,

    pub fn deinit(self: *SceneTrace, allocator: std.mem.Allocator) void {
        for (self.actions) |*action| action.deinit(allocator);
        allocator.free(self.actions);
        allocator.free(self.duplicate_warnings);
        self.* = undefined;
    }
};

pub const Result = struct {
    final_state: state_runtime.State,
    history: []HistoryEntry,
    scenes: []const []const u8,
    logs: []scene_runtime.LogEvent,
    traces: []SceneTrace,

    pub fn deinit(self: *Result, allocator: std.mem.Allocator) void {
        self.final_state.deinit(allocator);
        for (self.history) |*entry| entry.deinit(allocator);
        allocator.free(self.history);
        allocator.free(self.scenes);
        allocator.free(self.logs);
        for (self.traces) |*trace| trace.deinit(allocator);
        allocator.free(self.traces);
        self.* = undefined;
    }
};

pub const Failure = struct {
    err: anyerror,
    code: runtime_error.Code,
    partial_state: state_runtime.State,
    failed_scene_id: []const u8,
    logs: []scene_runtime.LogEvent,

    pub fn deinit(self: *Failure, allocator: std.mem.Allocator) void {
        self.partial_state.deinit(allocator);
        allocator.free(self.logs);
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
    route: *const route_ir.Route,
    current_scene_id: []const u8,
) !?[]const u8 {
    if (route.invalid) return error.InvalidRoute;
    var best_target: ?[]const u8 = null;
    var best_score: ?Score = null;
    for (route.arms) |arm| {
        var arm_score: ?Score = null;
        for (arm.patterns) |pattern| {
            const score = matchPattern(pattern, history, current_scene_id) orelse continue;
            if (arm_score == null or better(score, arm_score.?)) arm_score = score;
        }
        if (arm_score) |score| {
            if (best_score == null or better(score, best_score.?)) {
                best_score = score;
                best_target = arm.target;
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
    var logs = std.ArrayList(scene_runtime.LogEvent).empty;
    defer logs.deinit(allocator);
    return executeOwned(
        model,
        route_id,
        &current_state,
        &current_scene,
        max_scene_steps,
        max_transitions,
        &logs,
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
    var logs = std.ArrayList(scene_runtime.LogEvent).empty;
    errdefer logs.deinit(allocator);
    const result = executeOwned(
        model,
        route_id,
        &current_state,
        &current_scene,
        max_scene_steps,
        max_transitions,
        &logs,
        allocator,
    ) catch |err| {
        const log_slice = try logs.toOwnedSlice(allocator);
        const partial_state = current_state;
        current_state = .{};
        return .{ .failure = .{
            .err = err,
            .code = runtime_error.fromError(err),
            .partial_state = partial_state,
            .failed_scene_id = current_scene,
            .logs = log_slice,
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
    logs: *std.ArrayList(scene_runtime.LogEvent),
    allocator: std.mem.Allocator,
) !Result {
    const route = findRoute(model, route_id) orelse return error.RouteNotFound;
    const entry = route.get("entrySceneId") orelse return error.NoEntryScene;
    if (route.get("match") == null) return error.InvalidRoute;
    if (entry != .string or entry.string.len == 0) return error.NoEntryScene;
    const arms = model.loweredRoute(route_id) orelse return error.InvalidRoute;
    current_scene.* = entry.string;
    var history = std.ArrayList(HistoryEntry).empty;
    defer deinitHistory(&history, allocator);
    var scenes = std.ArrayList([]const u8).empty;
    errdefer scenes.deinit(allocator);
    var traces = std.ArrayList(SceneTrace).empty;
    errdefer {
        for (traces.items) |*trace| trace.deinit(allocator);
        traces.deinit(allocator);
    }
    var transitions: usize = 0;
    while (true) {
        const history_start = history.items.len;
        var safe_scene = try scene_runtime.executeSafe(
            model,
            current_scene.*,
            current_state,
            max_scene_steps,
            allocator,
        );
        defer safe_scene.deinit(allocator);
        const scene_result = switch (safe_scene) {
            .success => |*result| result,
            .failure => |*failure| {
                try logs.appendSlice(allocator, failure.logs);
                return failure.err;
            },
        };
        try logs.appendSlice(allocator, scene_result.logs);
        var cloned_trace = try cloneSceneTrace(
            current_scene.*,
            scene_result.traces,
            scene_result.duplicate_warnings,
            allocator,
        );
        traces.append(allocator, cloned_trace) catch |err| {
            cloned_trace.deinit(allocator);
            return err;
        };
        current_state.deinit(allocator);
        current_state.* = scene_result.takeState();
        try scenes.append(allocator, current_scene.*);
        for (scene_result.traces) |trace|
            try history.append(allocator, try HistoryEntry.init(current_scene.*, trace.action_id, allocator));
        const next = try selectNextScene(history.items[history_start..], arms, current_scene.*);
        if (next == null) break;
        transitions += 1;
        if (transitions > max_transitions) return error.MaxRouteTransitionsExceeded;
        current_scene.* = next.?;
    }
    const history_slice = try history.toOwnedSlice(allocator);
    errdefer allocator.free(history_slice);
    const scene_slice = try scenes.toOwnedSlice(allocator);
    errdefer allocator.free(scene_slice);
    const log_slice = try logs.toOwnedSlice(allocator);
    errdefer allocator.free(log_slice);
    const trace_slice = try traces.toOwnedSlice(allocator);
    const final_state = current_state.*;
    current_state.* = .{};
    return .{
        .final_state = final_state,
        .history = history_slice,
        .scenes = scene_slice,
        .logs = log_slice,
        .traces = trace_slice,
    };
}

fn cloneSceneTrace(
    scene_id: []const u8,
    actions: []const scene_runtime.ActionTrace,
    duplicate_warnings: []const scene_runtime.DuplicateEnqueueWarning,
    allocator: std.mem.Allocator,
) !SceneTrace {
    const cloned = try allocator.alloc(scene_runtime.ActionTrace, actions.len);
    errdefer allocator.free(cloned);
    var initialized: usize = 0;
    errdefer for (cloned[0..initialized]) |*action| action.deinit(allocator);
    for (actions, 0..) |action, index| {
        cloned[index] = try action.clone(allocator);
        initialized += 1;
    }
    return .{
        .scene_id = scene_id,
        .actions = cloned,
        .duplicate_warnings = try allocator.dupe(
            scene_runtime.DuplicateEnqueueWarning,
            duplicate_warnings,
        ),
    };
}

fn better(candidate: Score, current: Score) bool {
    if (candidate.wildcards != current.wildcards) return candidate.wildcards < current.wildcards;
    return candidate.suffix_len > current.suffix_len;
}

fn matchPattern(
    pattern: route_ir.Pattern,
    history: []const HistoryEntry,
    current_scene_id: []const u8,
) ?Score {
    const scene = switch (pattern) {
        .any => return .{ .wildcards = std.math.maxInt(usize), .suffix_len = 0 },
        .scene => |scene| scene,
    };
    if (!std.mem.eql(u8, scene.scene_id, current_scene_id)) return null;

    const suffix_len = scene.actions.len;
    const block = firstBlock(history, scene.scene_id);
    if (block.len == 0) return null;
    if (!scene.wildcard and block.len != suffix_len) return null;
    if (scene.wildcard and block.len < suffix_len) return null;
    const offset = block.len - suffix_len;
    for (scene.actions, 0..) |expected, index|
        if (!std.mem.eql(u8, expected, block[offset + index].action_id)) return null;
    return .{ .wildcards = if (scene.wildcard) 1 else 0, .suffix_len = suffix_len };
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

pub fn findRoute(model: *const model_runtime.RuntimeModel, route_id: []const u8) ?std.json.ObjectMap {
    return model.findRoute(route_id);
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
    var arena: std.heap.ArenaAllocator = .init(allocator);
    defer arena.deinit();
    const route = try route_ir.lower("s1", parsed.value, arena.allocator());
    const one = [_]HistoryEntry{.{ .scene_id = "s1", .action_id = "final" }};
    try std.testing.expectEqualStrings("exact", (try selectNextScene(&one, &route, "s1")).?);
    const many = [_]HistoryEntry{
        .{ .scene_id = "s1", .action_id = "intro" },
        .{ .scene_id = "s1", .action_id = "final" },
    };
    try std.testing.expectEqualStrings("wild", (try selectNextScene(&many, &route, "s1")).?);
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
    try std.testing.expectEqual(@as(usize, 6), result.logs.len);
    try std.testing.expectEqualStrings("a", result.logs[0].action_id);
    try std.testing.expectEqual(scene_runtime.LogKind.action_complete, result.logs[2].kind);
    try std.testing.expectEqualStrings("b", result.logs[3].action_id);
    try std.testing.expectEqual(scene_runtime.LogKind.action_complete, result.logs[5].kind);
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
            try std.testing.expectEqual(runtime_error.Code.unknown_function, failure.code);
            try std.testing.expectEqualStrings("s2", failure.failed_scene_id);
            try std.testing.expectEqual(@as(usize, 4), failure.logs.len);
            try std.testing.expectEqual(scene_runtime.LogKind.action_start, failure.logs[3].kind);
            try std.testing.expectEqualStrings("b", failure.logs[3].action_id);
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

test "route history outlives the model it ran against" {
    // History is read by pattern matching for the whole run and used to be a
    // set of slices borrowed from the model's parsed JSON. Destroying the model
    // first and then reading the history is the check that it owns its ids:
    // borrowed slices would point into freed pages here.
    const fixture =
        \\{"version":2,
        \\ "routes":[{"id":"main","entrySceneId":"s1","match":[
        \\   {"patterns":["s1.a"],"target":"s2"}
        \\ ]}],
        \\ "scenes":[
        \\   {"id":"s1","entryAction":"a","actions":[{"id":"a"}]},
        \\   {"id":"s2","entryAction":"b","actions":[{"id":"b"}]}
        \\ ]}
    ;
    const allocator = std.testing.allocator;
    const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, allocator);
    defer state.deinit(allocator);

    var result = blk: {
        var model = try model_runtime.RuntimeModel.init(allocator, fixture, .{});
        defer model.deinit();
        break :blk try execute(
            &model,
            "main",
            &state,
            scene_runtime.default_max_steps,
            default_max_transitions,
            allocator,
        );
    };
    defer result.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 2), result.history.len);
    try std.testing.expectEqualStrings("s1", result.history[0].scene_id);
    try std.testing.expectEqualStrings("a", result.history[0].action_id);
    try std.testing.expectEqualStrings("s2", result.history[1].scene_id);
    try std.testing.expectEqualStrings("b", result.history[1].action_id);
}
