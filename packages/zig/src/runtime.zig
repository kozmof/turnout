const std = @import("std");
const effect = @import("effect.zig");

pub const RuntimeError = error{
    Terminal,
    PendingEffect,
    NoPendingEffect,
    StaleEffect,
    WrongEffectKind,
    EffectIdOverflow,
};
pub const Event = union(enum) {
    need_effect: effect.Request,
    action_complete: struct { scene_id: []const u8, action_id: []const u8 },
    scene_changed: struct { from: []const u8, to: []const u8 },
    complete,
    cancelled,
};

const Status = enum { active, complete, cancelled };

/// Pull-based runtime boundary. resume records exactly one effect result;
/// callers invoke step to continue, keeping advancement semantics uniform.
pub const Runtime = struct {
    next_effect_id: u64 = 1,
    pending: ?effect.Request = null,
    scheduled: []const effect.Spec = &.{},
    schedule_index: usize = 0,
    status: Status = .active,

    pub fn init(scheduled: []const effect.Spec) Runtime {
        return .{ .scheduled = scheduled };
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
        const spec = self.scheduled[self.schedule_index];
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

    pub fn @"resume"(self: *Runtime, id: u64, result: effect.Result) RuntimeError!void {
        if (self.status != .active) return error.Terminal;
        const pending = self.pending orelse return error.NoPendingEffect;
        if (pending.id != id) return error.StaleEffect;
        if (pending.kind != std.meta.activeTag(result)) return error.WrongEffectKind;
        self.pending = null;
    }

    pub fn cancel(self: *Runtime) void {
        self.pending = null;
        self.status = .cancelled;
    }
};

test "effect results reject stale and wrong-kind responses" {
    var runtime: Runtime = .{};
    _ = try runtime.requestEffect(.prepare, "load", "scene", "action");
    try std.testing.expectError(error.StaleEffect, runtime.@"resume"(2, .{ .prepare = "{}" }));
    try std.testing.expectError(error.WrongEffectKind, runtime.@"resume"(1, .{ .publish = .ok }));
    try runtime.@"resume"(1, .{ .prepare = "{}" });
    try std.testing.expectError(error.NoPendingEffect, runtime.@"resume"(1, .{ .prepare = "{}" }));
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
    var runtime = Runtime.init(&scheduled);
    const first = (try runtime.step()).need_effect;
    try std.testing.expectEqual(@as(u64, 1), first.id);
    try std.testing.expectEqualStrings("input", first.binding.?);
    try std.testing.expectEqualStrings("{\"prepared\":[]}", first.context_json);
    const replay = (try runtime.step()).need_effect;
    try std.testing.expectEqual(first.id, replay.id);
    try runtime.@"resume"(first.id, .{ .prepare = "{\"input\":1}" });
    const second = (try runtime.step()).need_effect;
    try std.testing.expectEqual(@as(u64, 2), second.id);
    try std.testing.expectEqual(@as(usize, 1), second.callback_index);
    try runtime.@"resume"(second.id, .{ .publish = .ok });
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
    var runtime = Runtime.init(&scheduled);
    _ = try runtime.step();
    runtime.cancel();
    try std.testing.expect((try runtime.step()) == .cancelled);
    try std.testing.expectError(error.Terminal, runtime.@"resume"(1, .{ .prepare = "{}" }));
}
