pub const Kind = enum { prepare, publish };
pub const Request = struct {
    id: u64,
    kind: Kind,
    hook: []const u8,
    scene_id: []const u8,
    action_id: []const u8,
    callback_index: usize,
    binding: ?[]const u8,
    context_json: []const u8,
};
pub const Spec = struct {
    kind: Kind,
    hook: []const u8,
    scene_id: []const u8,
    action_id: []const u8,
    callback_index: usize,
    binding: ?[]const u8 = null,
    context_json: []const u8 = "{}",
};
pub const Result = union(Kind) { prepare: []const u8, publish: PublishOutcome };
pub const PublishOutcome = union(enum) { ok, failed: []const u8 };

pub const OwnedResult = union(Kind) {
    prepare: []u8,
    publish: OwnedPublishOutcome,

    pub fn deinit(self: *OwnedResult, allocator: @import("std").mem.Allocator) void {
        switch (self.*) {
            .prepare => |payload| allocator.free(payload),
            .publish => |outcome| switch (outcome) {
                .ok => {},
                .failed => |message| allocator.free(message),
            },
        }
        self.* = undefined;
    }
};
pub const OwnedPublishOutcome = union(enum) { ok, failed: []u8 };

pub fn cloneResult(
    result: Result,
    allocator: @import("std").mem.Allocator,
) @import("std").mem.Allocator.Error!OwnedResult {
    return switch (result) {
        .prepare => |payload| .{ .prepare = try allocator.dupe(u8, payload) },
        .publish => |outcome| .{ .publish = switch (outcome) {
            .ok => .ok,
            .failed => |message| .{ .failed = try allocator.dupe(u8, message) },
        } },
    };
}
