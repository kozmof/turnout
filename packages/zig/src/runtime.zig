const std = @import("std");
const effect = @import("effect.zig");

pub const RuntimeError = error{ Terminal, PendingEffect, NoPendingEffect, StaleEffect, WrongEffectKind };
pub const Event = union(enum) {
    need_effect: effect.Request,
    action_complete: struct { scene_id: []const u8, action_id: []const u8 },
    scene_changed: struct { from: []const u8, to: []const u8 },
    complete,
};

/// Pull-based runtime boundary. resume records exactly one effect result;
/// callers invoke step to continue, keeping advancement semantics uniform.
pub const Runtime = struct {
    next_effect_id: u64 = 1,
    pending: ?effect.Request = null,
    terminal: bool = false,

    pub fn requestEffect(self: *Runtime, kind: effect.Kind, hook: []const u8, scene: []const u8, action: []const u8) RuntimeError!Event {
        if (self.terminal) return error.Terminal;
        if (self.pending != null) return error.PendingEffect;
        const request: effect.Request = .{ .id = self.next_effect_id, .kind = kind, .hook = hook, .scene_id = scene, .action_id = action };
        self.next_effect_id += 1;
        self.pending = request;
        return .{ .need_effect = request };
    }

    pub fn @"resume"(self: *Runtime, id: u64, result: effect.Result) RuntimeError!void {
        if (self.terminal) return error.Terminal;
        const pending = self.pending orelse return error.NoPendingEffect;
        if (pending.id != id) return error.StaleEffect;
        if (pending.kind != std.meta.activeTag(result)) return error.WrongEffectKind;
        self.pending = null;
    }

    pub fn cancel(self: *Runtime) void {
        self.pending = null;
        self.terminal = true;
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
