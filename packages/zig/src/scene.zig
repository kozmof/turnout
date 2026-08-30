const std = @import("std");
const model_runtime = @import("model.zig");
const state_runtime = @import("state.zig");
const turnout_value = @import("value.zig");

pub const default_max_steps: usize = 10_000;

pub const DuplicateEnqueueWarning = struct {
    action_id: []const u8,
    from_action_id: []const u8,
    first_enqueued_by: ?[]const u8,
};

pub const ActionTrace = struct {
    action_id: []const u8,
    next_action_id: ?[]const u8,
    merge_warning_count: usize,
    next_warnings: []model_runtime.NextRuleWarning,

    fn deinit(self: *ActionTrace, allocator: std.mem.Allocator) void {
        allocator.free(self.next_warnings);
        self.* = undefined;
    }
};

pub const Result = struct {
    state_after_scene: state_runtime.State,
    traces: []ActionTrace,
    terminated_at: []const []const u8,
    duplicate_warnings: []DuplicateEnqueueWarning,

    pub fn deinit(self: *Result, allocator: std.mem.Allocator) void {
        self.state_after_scene.deinit(allocator);
        for (self.traces) |*trace| trace.deinit(allocator);
        allocator.free(self.traces);
        allocator.free(self.terminated_at);
        allocator.free(self.duplicate_warnings);
        self.* = undefined;
    }
};

pub fn execute(
    model: *const model_runtime.RuntimeModel,
    scene_id: []const u8,
    initial_state: *const state_runtime.State,
    max_steps: usize,
    allocator: std.mem.Allocator,
) !Result {
    const scene = findScene(model, scene_id) orelse return error.SceneNotFound;
    const entry = try validateScene(scene, allocator);
    var current_state = try initial_state.snapshot(allocator);
    errdefer current_state.deinit(allocator);
    var queue = std.ArrayList([]const u8).empty;
    defer queue.deinit(allocator);
    try queue.append(allocator, entry);
    var queue_head: usize = 0;
    var visited: std.StringHashMapUnmanaged(void) = .empty;
    defer visited.deinit(allocator);
    var enqueue_sources: std.StringHashMapUnmanaged([]const u8) = .empty;
    defer enqueue_sources.deinit(allocator);
    var traces = std.ArrayList(ActionTrace).empty;
    errdefer {
        for (traces.items) |*trace| trace.deinit(allocator);
        traces.deinit(allocator);
    }
    var terminated = std.ArrayList([]const u8).empty;
    errdefer terminated.deinit(allocator);
    var duplicates = std.ArrayList(DuplicateEnqueueWarning).empty;
    errdefer duplicates.deinit(allocator);

    var step_count: usize = 0;
    while (queue_head < queue.items.len) {
        const action_id = queue.items[queue_head];
        queue_head += 1;
        step_count += 1;
        if (step_count > max_steps) return error.MaxStepsExceeded;
        try visited.put(allocator, action_id, {});

        var action_result = try model.executeAction(scene_id, action_id, &current_state, allocator);
        defer action_result.deinit(allocator);
        var selection = try model.selectNextAfterAction(scene_id, action_id, &action_result, allocator);
        defer selection.deinit(allocator);

        current_state.deinit(allocator);
        current_state = action_result.takeState();
        const next_action = selection.target;
        if (next_action == null) try terminated.append(allocator, action_id);
        const next_warnings = try allocator.dupe(model_runtime.NextRuleWarning, selection.warnings);
        traces.append(allocator, .{
            .action_id = action_id,
            .next_action_id = next_action,
            .merge_warning_count = action_result.merge_warnings.len,
            .next_warnings = next_warnings,
        }) catch |err| {
            allocator.free(next_warnings);
            return err;
        };

        if (next_action) |target| {
            const previous_source = enqueue_sources.get(target);
            if (previous_source != null or visited.contains(target)) {
                try duplicates.append(allocator, .{
                    .action_id = target,
                    .from_action_id = action_id,
                    .first_enqueued_by = previous_source,
                });
            } else {
                try enqueue_sources.put(allocator, target, action_id);
                try queue.append(allocator, target);
            }
        }
    }

    const trace_slice = try traces.toOwnedSlice(allocator);
    errdefer {
        for (trace_slice) |*trace| trace.deinit(allocator);
        allocator.free(trace_slice);
    }
    const terminated_slice = try terminated.toOwnedSlice(allocator);
    errdefer allocator.free(terminated_slice);
    const duplicate_slice = try duplicates.toOwnedSlice(allocator);
    return .{
        .state_after_scene = current_state,
        .traces = trace_slice,
        .terminated_at = terminated_slice,
        .duplicate_warnings = duplicate_slice,
    };
}

fn findScene(model: *const model_runtime.RuntimeModel, scene_id: []const u8) ?std.json.ObjectMap {
    const scenes = model.root().get("scenes") orelse return null;
    if (scenes != .array) return null;
    for (scenes.array.items) |scene| {
        if (scene != .object) continue;
        const id = scene.object.get("id") orelse continue;
        if (id == .string and std.mem.eql(u8, id.string, scene_id)) return scene.object;
    }
    return null;
}

fn validateScene(scene: std.json.ObjectMap, allocator: std.mem.Allocator) ![]const u8 {
    const entry = scene.get("entryAction") orelse return error.NoEntryAction;
    const actions = scene.get("actions") orelse return error.NoEntryAction;
    if (entry != .string or entry.string.len == 0 or actions != .array) return error.NoEntryAction;
    var ids: std.StringHashMapUnmanaged(void) = .empty;
    defer ids.deinit(allocator);
    var found_entry = false;
    for (actions.array.items) |action| {
        if (action != .object) return error.InvalidAction;
        const id = action.object.get("id") orelse return error.InvalidAction;
        if (id != .string or id.string.len == 0) return error.InvalidAction;
        const slot = try ids.getOrPut(allocator, id.string);
        if (slot.found_existing) return error.DuplicateActionId;
        if (std.mem.eql(u8, id.string, entry.string)) found_entry = true;
    }
    if (!found_entry) return error.ActionNotFound;
    return entry.string;
}

test "scene executes first-match action chain" {
    const fixture =
        \\{"version":2,"scenes":[{"id":"main","entryAction":"first","actions":[
        \\  {
        \\    "id":"first",
        \\    "compute":{"root":"out","prog":{"bindings":[
        \\      {"name":"out","type":"number","value":1}
        \\    ]}},
        \\    "merge":[{"binding":"out","toState":"step.first"}],
        \\    "next":[{"action":"second"}]
        \\  },
        \\  {
        \\    "id":"second",
        \\    "compute":{"root":"out","prog":{"bindings":[
        \\      {"name":"out","type":"number","value":2}
        \\    ]}},
        \\    "merge":[{"binding":"out","toState":"step.second"}]
        \\  }
        \\]}]}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var result = try execute(&model, "main", &state, default_max_steps, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 2), result.traces.len);
    try std.testing.expectEqualStrings("first", result.traces[0].action_id);
    try std.testing.expectEqualStrings("second", result.traces[1].action_id);
    try std.testing.expectEqual(@as(usize, 1), result.terminated_at.len);
    try std.testing.expectEqualStrings("second", result.terminated_at[0]);
}

test "scene suppresses duplicate enqueue and enforces step limit" {
    const fixture =
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[
        \\  {"id":"a","next":[{"action":"b"}]},
        \\  {"id":"b","next":[{"action":"a"}]}
        \\]}]}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var result = try execute(&model, "main", &state, default_max_steps, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 2), result.traces.len);
    try std.testing.expectEqual(@as(usize, 1), result.duplicate_warnings.len);
    try std.testing.expectEqualStrings("a", result.duplicate_warnings[0].action_id);
    try std.testing.expect(result.duplicate_warnings[0].first_enqueued_by == null);
    try std.testing.expectError(error.MaxStepsExceeded, execute(&model, "main", &state, 1, std.testing.allocator));
}
