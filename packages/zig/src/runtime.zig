const std = @import("std");
const effect = @import("effect.zig");
const state_runtime = @import("state.zig");
const value = @import("value.zig");

pub const RuntimeError = error{
    OutOfMemory,
    Terminal,
    PendingEffect,
    NoPendingEffect,
    StaleEffect,
    WrongEffectKind,
    EffectIdOverflow,
    EffectNotCompleted,
    MissingPrepareHook,
    PrepareHookFailed,
    PublishHookFailed,
    MissingPrepareBinding,
    InvalidPreparePayload,
};
pub const Event = union(enum) {
    need_effect: effect.Request,
    action_complete: struct { scene_id: []const u8, action_id: []const u8 },
    scene_changed: struct { from: []const u8, to: []const u8 },
    complete,
    cancelled,
};

const Status = enum { active, complete, cancelled };

pub const CompletedEffect = struct {
    request: effect.Request,
    result: effect.OwnedResult,
    owned_context: ?[]u8 = null,

    fn deinit(self: *CompletedEffect, allocator: std.mem.Allocator) void {
        self.result.deinit(allocator);
        if (self.owned_context) |context| allocator.free(context);
        self.* = undefined;
    }
};

pub const PreparedValues = struct {
    values: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty,
    parsed_payloads: std.ArrayList(std.json.Parsed(std.json.Value)) = .empty,

    pub fn deinit(self: *PreparedValues, allocator: std.mem.Allocator) void {
        for (self.values.values()) |*item| value.deinitTaggedValue(item, allocator);
        for (self.values.keys()) |key| allocator.free(key);
        self.values.deinit(allocator);
        for (self.parsed_payloads.items) |*parsed| parsed.deinit();
        self.parsed_payloads.deinit(allocator);
        self.* = undefined;
    }
};

pub const PublishStatus = enum { ok, @"error" };
pub const PublishOutcome = struct {
    hook_name: []const u8,
    status: PublishStatus,
    message: ?[]const u8 = null,
};
pub const PublishOutcomes = struct {
    items: []PublishOutcome,

    pub fn deinit(self: *PublishOutcomes, allocator: std.mem.Allocator) void {
        allocator.free(self.items);
        self.* = undefined;
    }
};

/// Pull-based runtime boundary. resume records exactly one effect result;
/// callers invoke step to continue, keeping advancement semantics uniform.
pub const Runtime = struct {
    allocator: std.mem.Allocator,
    next_effect_id: u64 = 1,
    pending: ?effect.Request = null,
    pending_context: ?[]u8 = null,
    action_state_context: ?[]u8 = null,
    scheduled: []const effect.Spec = &.{},
    schedule_index: usize = 0,
    status: Status = .active,
    completed: std.ArrayList(CompletedEffect) = .empty,

    pub fn init(allocator: std.mem.Allocator, scheduled: []const effect.Spec) Runtime {
        return .{ .allocator = allocator, .scheduled = scheduled };
    }

    pub fn deinit(self: *Runtime) void {
        if (self.pending_context) |context| self.allocator.free(context);
        if (self.action_state_context) |context| self.allocator.free(context);
        for (self.completed.items) |*item| item.deinit(self.allocator);
        self.completed.deinit(self.allocator);
        self.* = undefined;
    }

    pub fn completedEffects(self: *const Runtime) []const CompletedEffect {
        return self.completed.items;
    }

    pub fn completedResult(self: *const Runtime, id: u64) ?*const effect.OwnedResult {
        for (self.completed.items) |*item|
            if (item.request.id == id) return &item.result;
        return null;
    }

    pub fn preparePayload(self: *const Runtime, id: u64) RuntimeError![]const u8 {
        const result = self.completedResult(id) orelse return error.EffectNotCompleted;
        if (result.* != .prepare) return error.WrongEffectKind;
        return switch (result.prepare) {
            .ok => |payload| payload,
            .missing => error.MissingPrepareHook,
            .failed => error.PrepareHookFailed,
        };
    }

    pub fn preparedValues(
        self: *const Runtime,
        scene_id: []const u8,
        action_id: []const u8,
    ) RuntimeError!PreparedValues {
        var prepared: PreparedValues = .{};
        errdefer prepared.deinit(self.allocator);
        for (self.completed.items) |item| {
            if (item.result != .prepare) continue;
            if (!std.mem.eql(u8, item.request.scene_id, scene_id)) continue;
            if (!std.mem.eql(u8, item.request.action_id, action_id)) continue;
            const payload = switch (item.result.prepare) {
                .ok => |bytes| bytes,
                .missing => return error.MissingPrepareHook,
                .failed => return error.PrepareHookFailed,
            };
            var parsed = std.json.parseFromSlice(std.json.Value, self.allocator, payload, .{}) catch
                return error.InvalidPreparePayload;
            prepared.parsed_payloads.append(self.allocator, parsed) catch |err| {
                parsed.deinit();
                return err;
            };
            const parsed_value = prepared.parsed_payloads.items[prepared.parsed_payloads.items.len - 1].value;
            if (item.request.binding) |binding| {
                try putPreparedValue(&prepared, binding, parsed_value, self.allocator);
            } else {
                if (parsed_value != .object) return error.InvalidPreparePayload;
                var fields = parsed_value.object.iterator();
                while (fields.next()) |field|
                    try putPreparedValue(&prepared, field.key_ptr.*, field.value_ptr.*, self.allocator);
            }
        }
        return prepared;
    }

    pub fn enforcePublishPolicy(self: *const Runtime, fail_on_error: bool) RuntimeError!void {
        return self.enforcePublishPolicyFor(null, null, fail_on_error);
    }

    pub fn actionPublishOutcomes(
        self: *const Runtime,
        scene_id: []const u8,
        action_id: []const u8,
    ) RuntimeError!PublishOutcomes {
        var outcomes = std.ArrayList(PublishOutcome).empty;
        errdefer outcomes.deinit(self.allocator);
        for (self.completed.items) |item| {
            if (item.result != .publish) continue;
            if (!std.mem.eql(u8, item.request.scene_id, scene_id)) continue;
            if (!std.mem.eql(u8, item.request.action_id, action_id)) continue;
            switch (item.result.publish) {
                .ok => try outcomes.append(self.allocator, .{
                    .hook_name = item.request.hook,
                    .status = .ok,
                }),
                .missing => {},
                .failed => |failure| try outcomes.append(self.allocator, .{
                    .hook_name = item.request.hook,
                    .status = .@"error",
                    .message = failure.message,
                }),
            }
        }
        return .{ .items = try outcomes.toOwnedSlice(self.allocator) };
    }

    pub fn enforceActionPublishPolicy(
        self: *const Runtime,
        scene_id: []const u8,
        action_id: []const u8,
        fail_on_error: bool,
    ) RuntimeError!void {
        return self.enforcePublishPolicyFor(scene_id, action_id, fail_on_error);
    }

    fn enforcePublishPolicyFor(
        self: *const Runtime,
        scene_id: ?[]const u8,
        action_id: ?[]const u8,
        fail_on_error: bool,
    ) RuntimeError!void {
        if (!fail_on_error) return;
        for (self.completed.items) |item| {
            if (item.result != .publish) continue;
            if (scene_id) |wanted|
                if (!std.mem.eql(u8, item.request.scene_id, wanted)) continue;
            if (action_id) |wanted|
                if (!std.mem.eql(u8, item.request.action_id, wanted)) continue;
            if (item.result.publish == .failed) return error.PublishHookFailed;
        }
    }

    pub fn step(self: *Runtime) RuntimeError!Event {
        if (self.pending) |pending| return .{ .need_effect = pending };
        switch (self.status) {
            .complete => return .complete,
            .cancelled => return .cancelled,
            .active => {},
        }
        if (self.schedule_index == self.scheduled.len) {
            self.status = .complete;
            return .complete;
        }
        var spec = self.scheduled[self.schedule_index];
        if (spec.kind == .publish) {
            if (self.action_state_context) |context| spec.context_json = context;
        }
        const event = try self.requestEffectWithContext(spec);
        self.schedule_index += 1;
        return event;
    }

    pub fn requestEffect(self: *Runtime, kind: effect.Kind, hook: []const u8, scene: []const u8, action: []const u8) RuntimeError!Event {
        return self.requestEffectWithContext(.{
            .kind = kind,
            .hook = hook,
            .scene_id = scene,
            .action_id = action,
            .callback_index = 0,
        });
    }

    pub fn requestEffectWithContext(self: *Runtime, spec: effect.Spec) RuntimeError!Event {
        if (self.status != .active) return error.Terminal;
        if (self.pending != null) return error.PendingEffect;
        if (self.next_effect_id == std.math.maxInt(u64)) return error.EffectIdOverflow;
        const request: effect.Request = .{
            .id = self.next_effect_id,
            .kind = spec.kind,
            .hook = spec.hook,
            .scene_id = spec.scene_id,
            .action_id = spec.action_id,
            .callback_index = spec.callback_index,
            .binding = spec.binding,
            .context_json = spec.context_json,
        };
        self.next_effect_id += 1;
        self.pending = request;
        return .{ .need_effect = request };
    }

    pub fn requestPublishEffect(
        self: *Runtime,
        hook: []const u8,
        scene_id: []const u8,
        action_id: []const u8,
        callback_index: usize,
        state: *const state_runtime.State,
    ) !Event {
        const context = try state.canonicalJson(self.allocator);
        errdefer self.allocator.free(context);
        const event = try self.requestEffectWithContext(.{
            .kind = .publish,
            .hook = hook,
            .scene_id = scene_id,
            .action_id = action_id,
            .callback_index = callback_index,
            .context_json = context,
        });
        self.pending_context = context;
        return event;
    }

    pub fn requestPrepareEffect(
        self: *Runtime,
        hook: []const u8,
        scene_id: []const u8,
        action_id: []const u8,
        callback_index: usize,
        prepared: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
    ) !Event {
        const context = try value.canonicalMapJson(prepared, self.allocator);
        errdefer self.allocator.free(context);
        const event = try self.requestEffectWithContext(.{
            .kind = .prepare,
            .hook = hook,
            .scene_id = scene_id,
            .action_id = action_id,
            .callback_index = callback_index,
            .context_json = context,
        });
        self.pending_context = context;
        return event;
    }

    pub fn setActionStateContext(self: *Runtime, state: *const state_runtime.State) !void {
        if (self.status != .active) return error.Terminal;
        if (self.pending != null) return error.PendingEffect;
        const context = try state.canonicalJson(self.allocator);
        if (self.action_state_context) |previous| self.allocator.free(previous);
        self.action_state_context = context;
    }

    pub fn @"resume"(self: *Runtime, id: u64, result: effect.Result) RuntimeError!void {
        if (self.status != .active) return error.Terminal;
        const pending = self.pending orelse return error.NoPendingEffect;
        if (pending.id != id) return error.StaleEffect;
        if (pending.kind != std.meta.activeTag(result)) return error.WrongEffectKind;
        var owned = try effect.cloneResult(result, self.allocator);
        self.completed.append(self.allocator, .{
            .request = pending,
            .result = owned,
            .owned_context = self.pending_context,
        }) catch |err| {
            owned.deinit(self.allocator);
            return err;
        };
        self.pending = null;
        self.pending_context = null;
    }

    pub fn cancel(self: *Runtime) void {
        self.pending = null;
        if (self.pending_context) |context| self.allocator.free(context);
        self.pending_context = null;
        self.status = .cancelled;
    }
};

fn putPreparedValue(
    prepared: *PreparedValues,
    binding: []const u8,
    json: std.json.Value,
    allocator: std.mem.Allocator,
) RuntimeError!void {
    var tagged: value.TaggedValue = if (json == .object and json.object.contains("symbol")) blk: {
        const canonical = value.fromCanonicalValue(json, allocator) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.InvalidCanonicalValue => return error.InvalidPreparePayload,
        };
        break :blk canonical.borrowed();
    } else blk: {
        var converted = value.fromJson(allocator, json) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.InvalidPreparePayload,
        };
        break :blk .{
            .value = converted,
            .tags = allocator.alloc([]const u8, 0) catch |err| {
                value.deinitValue(&converted, allocator);
                return err;
            },
        };
    };
    if (prepared.values.getPtr(binding)) |previous| {
        value.deinitTaggedValue(previous, allocator);
        previous.* = tagged;
        return;
    }
    const owned_binding = try allocator.dupe(u8, binding);
    prepared.values.put(allocator, owned_binding, tagged) catch |err| {
        allocator.free(owned_binding);
        value.deinitTaggedValue(&tagged, allocator);
        return err;
    };
}

test "effect results reject stale and wrong-kind responses" {
    var runtime = Runtime.init(std.testing.allocator, &.{});
    defer runtime.deinit();
    _ = try runtime.requestEffect(.prepare, "load", "scene", "action");
    try std.testing.expectError(error.StaleEffect, runtime.@"resume"(2, .{ .prepare = .{ .ok = "{}" } }));
    try std.testing.expectError(error.WrongEffectKind, runtime.@"resume"(1, .{ .publish = .ok }));
    try runtime.@"resume"(1, .{ .prepare = .{ .ok = "{}" } });
    try std.testing.expectError(error.NoPendingEffect, runtime.@"resume"(1, .{ .prepare = .{ .ok = "{}" } }));
}

test "step preserves declaration order and callback context" {
    const scheduled = [_]effect.Spec{
        .{
            .kind = .prepare,
            .hook = "load",
            .scene_id = "main",
            .action_id = "start",
            .callback_index = 0,
            .binding = "input",
            .context_json = "{\"prepared\":[]}",
        },
        .{
            .kind = .publish,
            .hook = "save",
            .scene_id = "main",
            .action_id = "start",
            .callback_index = 1,
            .context_json = "{\"state\":{}}",
        },
    };
    var runtime = Runtime.init(std.testing.allocator, &scheduled);
    defer runtime.deinit();
    const first = (try runtime.step()).need_effect;
    try std.testing.expectEqual(@as(u64, 1), first.id);
    try std.testing.expectEqualStrings("input", first.binding.?);
    try std.testing.expectEqualStrings("{\"prepared\":[]}", first.context_json);
    const replay = (try runtime.step()).need_effect;
    try std.testing.expectEqual(first.id, replay.id);
    try runtime.@"resume"(first.id, .{ .prepare = .{ .ok = "{\"input\":1}" } });
    const second = (try runtime.step()).need_effect;
    try std.testing.expectEqual(@as(u64, 2), second.id);
    try std.testing.expectEqual(@as(usize, 1), second.callback_index);
    try runtime.@"resume"(second.id, .{ .publish = .ok });
    try std.testing.expectEqual(@as(usize, 2), runtime.completedEffects().len);
    try std.testing.expectEqualStrings(
        "{\"input\":1}",
        runtime.completedEffects()[0].result.prepare.ok,
    );
    try std.testing.expect((try runtime.step()) == .complete);
    try std.testing.expect((try runtime.step()) == .complete);
}

test "cancel produces a stable terminal event" {
    const scheduled = [_]effect.Spec{.{
        .kind = .prepare,
        .hook = "load",
        .scene_id = "main",
        .action_id = "start",
        .callback_index = 0,
    }};
    var runtime = Runtime.init(std.testing.allocator, &scheduled);
    defer runtime.deinit();
    _ = try runtime.step();
    runtime.cancel();
    try std.testing.expect((try runtime.step()) == .cancelled);
    try std.testing.expectError(error.Terminal, runtime.@"resume"(1, .{ .prepare = .{ .ok = "{}" } }));
}

test "resume owns prepare payloads and publish failures" {
    const scheduled = [_]effect.Spec{
        .{
            .kind = .prepare,
            .hook = "load",
            .scene_id = "main",
            .action_id = "start",
            .callback_index = 0,
        },
        .{
            .kind = .publish,
            .hook = "save",
            .scene_id = "main",
            .action_id = "start",
            .callback_index = 0,
        },
    };
    var runtime = Runtime.init(std.testing.allocator, &scheduled);
    defer runtime.deinit();
    const prepare_request = (try runtime.step()).need_effect;
    var payload = [_]u8{ 'o', 'k' };
    try runtime.@"resume"(prepare_request.id, .{ .prepare = .{ .ok = &payload } });
    payload[0] = 'x';
    try std.testing.expectEqualStrings("ok", runtime.completedResult(prepare_request.id).?.prepare.ok);

    const publish_request = (try runtime.step()).need_effect;
    var message = [_]u8{ 'b', 'a', 'd' };
    try runtime.@"resume"(publish_request.id, .{ .publish = .{ .failed = .{
        .source = .thrown,
        .message = &message,
    } } });
    message[0] = 'x';
    const stored = runtime.completedResult(publish_request.id).?.publish;
    try std.testing.expectEqual(effect.PublishFailureSource.thrown, stored.failed.source);
    try std.testing.expectEqualStrings("bad", stored.failed.message);
}

test "prepare and publish outcome policies differ" {
    const scheduled = [_]effect.Spec{
        .{
            .kind = .prepare,
            .hook = "load",
            .scene_id = "main",
            .action_id = "start",
            .callback_index = 0,
        },
        .{
            .kind = .publish,
            .hook = "optional",
            .scene_id = "main",
            .action_id = "start",
            .callback_index = 0,
        },
        .{
            .kind = .publish,
            .hook = "failing",
            .scene_id = "main",
            .action_id = "start",
            .callback_index = 1,
        },
    };
    var runtime = Runtime.init(std.testing.allocator, &scheduled);
    defer runtime.deinit();
    const prepare = (try runtime.step()).need_effect;
    try runtime.@"resume"(prepare.id, .{ .prepare = .missing });
    try std.testing.expectError(error.MissingPrepareHook, runtime.preparePayload(prepare.id));
    const missing_publish = (try runtime.step()).need_effect;
    try runtime.@"resume"(missing_publish.id, .{ .publish = .missing });
    const failed_publish = (try runtime.step()).need_effect;
    try runtime.@"resume"(failed_publish.id, .{ .publish = .{ .failed = .{
        .source = .returned,
        .message = "host failed",
    } } });
    try runtime.enforcePublishPolicy(false);
    try std.testing.expectError(error.PublishHookFailed, runtime.enforcePublishPolicy(true));
}

test "failed prepare outcomes are owned and rejected" {
    var runtime = Runtime.init(std.testing.allocator, &.{});
    defer runtime.deinit();
    const request = (try runtime.requestEffect(.prepare, "load", "main", "start")).need_effect;
    var message = [_]u8{ 'b', 'a', 'd' };
    try runtime.@"resume"(request.id, .{ .prepare = .{ .failed = &message } });
    message[0] = 'x';
    try std.testing.expectEqualStrings("bad", runtime.completedResult(request.id).?.prepare.failed);
    try std.testing.expectError(error.PrepareHookFailed, runtime.preparePayload(request.id));
}

test "completed prepare effects decode by action and replace duplicate bindings" {
    const scheduled = [_]effect.Spec{
        .{ .kind = .prepare, .hook = "first", .scene_id = "main", .action_id = "start", .callback_index = 0, .binding = "input" },
        .{ .kind = .prepare, .hook = "second", .scene_id = "main", .action_id = "start", .callback_index = 1, .binding = "input" },
        .{ .kind = .prepare, .hook = "other", .scene_id = "other", .action_id = "start", .callback_index = 0, .binding = "ignored" },
    };
    var runtime = Runtime.init(std.testing.allocator, &scheduled);
    defer runtime.deinit();
    const first = (try runtime.step()).need_effect;
    try runtime.@"resume"(first.id, .{ .prepare = .{ .ok = "1" } });
    const second = (try runtime.step()).need_effect;
    try runtime.@"resume"(second.id, .{ .prepare = .{ .ok = "2" } });
    var prepared = try runtime.preparedValues("main", "start");
    defer prepared.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 1), prepared.values.count());
    try std.testing.expectEqual(@as(f64, 2), prepared.values.get("input").?.value.number);
}

test "malformed prepare payload is rejected" {
    var runtime = Runtime.init(std.testing.allocator, &.{});
    defer runtime.deinit();
    const request = (try runtime.requestEffectWithContext(.{
        .kind = .prepare,
        .hook = "load",
        .scene_id = "main",
        .action_id = "start",
        .callback_index = 0,
        .binding = "input",
    })).need_effect;
    try runtime.@"resume"(request.id, .{ .prepare = .{ .ok = "{" } });
    try std.testing.expectError(error.InvalidPreparePayload, runtime.preparedValues("main", "start"));
}

test "canonical prepare payload retains tags and null reasons" {
    var runtime = Runtime.init(std.testing.allocator, &.{});
    defer runtime.deinit();
    const request = (try runtime.requestEffectWithContext(.{
        .kind = .prepare,
        .hook = "load",
        .scene_id = "main",
        .action_id = "start",
        .callback_index = 0,
    })).need_effect;
    try runtime.@"resume"(request.id, .{ .prepare = .{ .ok = "{\"result\":{\"symbol\":\"null\",\"value\":null,\"reason\":\"filtered\",\"tags\":[\"host\"]}}" } });
    var prepared = try runtime.preparedValues("main", "start");
    defer prepared.deinit(std.testing.allocator);
    const result = prepared.values.get("result").?;
    try std.testing.expectEqual(value.NullReason.filtered, result.value.null_value);
    try std.testing.expectEqual(@as(usize, 1), result.tags.len);
    try std.testing.expectEqualStrings("host", result.tags[0]);
}

test "resumed prepare effect feeds model action compute" {
    const model_runtime = @import("model.zig");
    const source =
        \\{"version":2,"scenes":[{"id":"main","entryAction":"start","actions":[{
        \\"id":"start","prepare":[{"binding":"input","fromHook":"load"}],
        \\"compute":{"root":"result","prog":{"bindings":[
        \\{"name":"input","type":"number"},
        \\{"name":"result","type":"number","expr":{"combine":{
        \\"fn":"add","args":[{"ref":"input"},{"lit":3}]
        \\}}}
        \\]}}
        \\}]}]}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, source, .{});
    defer model.deinit();
    const empty: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    const scheduled = [_]effect.Spec{.{
        .kind = .prepare,
        .hook = "load",
        .scene_id = "main",
        .action_id = "start",
        .callback_index = 0,
        .binding = "input",
    }};
    var runtime = Runtime.init(std.testing.allocator, &scheduled);
    defer runtime.deinit();
    const request = (try runtime.step()).need_effect;
    try runtime.@"resume"(request.id, .{ .prepare = .{ .ok = "4" } });
    var prepared = try runtime.preparedValues("main", "start");
    defer prepared.deinit(std.testing.allocator);
    var result = try model.executeActionWithPrepared(
        "main",
        "start",
        &state,
        &prepared.values,
        std.testing.allocator,
    );
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(f64, 7), result.compute_root.value.number);
}

test "one prepare hook response feeds multiple action bindings" {
    const model_runtime = @import("model.zig");
    const source =
        \\{"version":2,"scenes":[{"id":"main","entryAction":"start","actions":[{
        \\"id":"start","prepare":[
        \\{"binding":"left","fromHook":"load"},
        \\{"binding":"right","fromHook":"load"}
        \\],"compute":{"root":"result","prog":{"bindings":[
        \\{"name":"left","type":"number"},{"name":"right","type":"number"},
        \\{"name":"result","type":"number","expr":{"combine":{
        \\"fn":"add","args":[{"ref":"left"},{"ref":"right"}]
        \\}}}
        \\]}},"merge":[{"binding":"result","toState":"result.value"}],
        \\"publish":["save"]
        \\}]}]}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, source, .{});
    defer model.deinit();
    var schedule = try model.actionEffectSchedule("main", "start", std.testing.allocator);
    defer schedule.deinit(std.testing.allocator);
    var runtime = Runtime.init(std.testing.allocator, schedule.specs);
    defer runtime.deinit();
    const request = (try runtime.step()).need_effect;
    try runtime.@"resume"(request.id, .{ .prepare = .{ .ok = "{\"left\":{\"symbol\":\"number\",\"value\":2,\"tags\":[\"host\"]},\"right\":{\"symbol\":\"number\",\"value\":5,\"tags\":[]}}" } });
    var prepared = try runtime.preparedValues("main", "start");
    defer prepared.deinit(std.testing.allocator);
    const empty: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var result = try model.executeActionWithPrepared(
        "main",
        "start",
        &state,
        &prepared.values,
        std.testing.allocator,
    );
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(f64, 7), result.compute_root.value.number);
    try std.testing.expect(value.hasTag(result.binding_values.getPtr("left").?.borrowed(), "host"));
    try runtime.setActionStateContext(&result.state_after_merge);
    const publish = (try runtime.step()).need_effect;
    try std.testing.expectEqual(effect.Kind.publish, publish.kind);
    try std.testing.expectEqualStrings("save", publish.hook);
    try std.testing.expectEqualStrings(
        "{\"result.value\":{\"symbol\":\"number\",\"value\":7,\"tags\":[\"host\"]}}",
        publish.context_json,
    );
    try runtime.@"resume"(publish.id, .{ .publish = .ok });
    try std.testing.expect((try runtime.step()) == .complete);
}

test "strict publish policy is action scoped and preserves merged state" {
    const model_runtime = @import("model.zig");
    const source =
        \\{"version":2,"scenes":[{"id":"main","entryAction":"current","actions":[{
        \\"id":"current","compute":{"root":"result","prog":{"bindings":[
        \\{"name":"result","type":"number","value":7}
        \\]}},"merge":[{"binding":"result","toState":"result.value"}],
        \\"publish":["save"]
        \\}]}]}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, source, .{});
    defer model.deinit();
    const empty: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var action_result = try model.executeAction("main", "current", &state, std.testing.allocator);
    defer action_result.deinit(std.testing.allocator);
    const scheduled = [_]effect.Spec{
        .{ .kind = .publish, .hook = "old", .scene_id = "main", .action_id = "previous", .callback_index = 0 },
        .{ .kind = .publish, .hook = "save", .scene_id = "main", .action_id = "current", .callback_index = 0 },
    };
    var runtime = Runtime.init(std.testing.allocator, &scheduled);
    defer runtime.deinit();
    const previous = (try runtime.step()).need_effect;
    try runtime.@"resume"(previous.id, .{ .publish = .{ .failed = .{
        .source = .thrown,
        .message = "old failure",
    } } });
    try runtime.enforceActionPublishPolicy("main", "current", true);
    const current = (try runtime.step()).need_effect;
    try runtime.@"resume"(current.id, .{ .publish = .{ .failed = .{
        .source = .returned,
        .message = "current failure",
    } } });
    try std.testing.expectError(
        error.PublishHookFailed,
        runtime.enforceActionPublishPolicy("main", "current", true),
    );
    var committed = try action_result.state_after_merge.read("result.value", std.testing.allocator);
    defer committed.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(f64, 7), committed.value.number);
}

test "action publish outcomes retain order and omit missing hooks" {
    const scheduled = [_]effect.Spec{
        .{ .kind = .publish, .hook = "first", .scene_id = "main", .action_id = "start", .callback_index = 0 },
        .{ .kind = .publish, .hook = "optional", .scene_id = "main", .action_id = "start", .callback_index = 1 },
        .{ .kind = .publish, .hook = "other", .scene_id = "main", .action_id = "other", .callback_index = 0 },
        .{ .kind = .publish, .hook = "thrown", .scene_id = "main", .action_id = "start", .callback_index = 2 },
        .{ .kind = .publish, .hook = "last", .scene_id = "main", .action_id = "start", .callback_index = 3 },
    };
    var runtime = Runtime.init(std.testing.allocator, &scheduled);
    defer runtime.deinit();
    const first = (try runtime.step()).need_effect;
    try runtime.@"resume"(first.id, .{ .publish = .ok });
    const optional = (try runtime.step()).need_effect;
    try runtime.@"resume"(optional.id, .{ .publish = .missing });
    const other = (try runtime.step()).need_effect;
    try runtime.@"resume"(other.id, .{ .publish = .{ .failed = .{
        .source = .thrown,
        .message = "ignored",
    } } });
    const thrown = (try runtime.step()).need_effect;
    try runtime.@"resume"(thrown.id, .{ .publish = .{ .failed = .{
        .source = .thrown,
        .message = "exception",
    } } });
    const last = (try runtime.step()).need_effect;
    try runtime.@"resume"(last.id, .{ .publish = .{ .failed = .{
        .source = .returned,
        .message = "rejected",
    } } });

    var outcomes = try runtime.actionPublishOutcomes("main", "start");
    defer outcomes.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 3), outcomes.items.len);
    try std.testing.expectEqualStrings("first", outcomes.items[0].hook_name);
    try std.testing.expectEqual(PublishStatus.ok, outcomes.items[0].status);
    try std.testing.expectEqualStrings("thrown", outcomes.items[1].hook_name);
    try std.testing.expectEqual(PublishStatus.@"error", outcomes.items[1].status);
    try std.testing.expectEqualStrings("exception", outcomes.items[1].message.?);
    try std.testing.expectEqualStrings("last", outcomes.items[2].hook_name);
    try std.testing.expectEqual(PublishStatus.@"error", outcomes.items[2].status);
    try std.testing.expectEqualStrings("rejected", outcomes.items[2].message.?);
}

test "dynamic publish request owns the post-merge state context" {
    var initial: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer initial.deinit(std.testing.allocator);
    try initial.put(std.testing.allocator, "result.value", .{
        .value = .{ .number = 7 },
        .tags = &.{"computed"},
    });
    var state = try state_runtime.State.initUnchecked(&initial, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var runtime = Runtime.init(std.testing.allocator, &.{});
    defer runtime.deinit();
    const request = (try runtime.requestPublishEffect(
        "save",
        "main",
        "start",
        0,
        &state,
    )).need_effect;
    try std.testing.expectEqualStrings(
        "{\"result.value\":{\"symbol\":\"number\",\"value\":7,\"tags\":[\"computed\"]}}",
        request.context_json,
    );
    try runtime.@"resume"(request.id, .{ .publish = .ok });
    try std.testing.expectEqualStrings(
        request.context_json,
        runtime.completedEffects()[0].request.context_json,
    );
}

test "dynamic prepare request owns prior binding context" {
    var prepared: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer prepared.deinit(std.testing.allocator);
    try prepared.put(std.testing.allocator, "from_state", .{
        .value = .{ .string = "ready" },
        .tags = &.{"state"},
    });
    var runtime = Runtime.init(std.testing.allocator, &.{});
    defer runtime.deinit();
    const request = (try runtime.requestPrepareEffect(
        "load",
        "main",
        "start",
        1,
        &prepared,
    )).need_effect;
    try std.testing.expectEqualStrings(
        "{\"from_state\":{\"symbol\":\"string\",\"value\":\"ready\",\"tags\":[\"state\"]}}",
        request.context_json,
    );
    try runtime.@"resume"(request.id, .{ .prepare = .{ .ok = "{\"loaded\":1}" } });
    try std.testing.expectEqualStrings(
        request.context_json,
        runtime.completedEffects()[0].request.context_json,
    );
}
