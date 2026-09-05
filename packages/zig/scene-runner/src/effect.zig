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
pub const Result = union(Kind) { prepare: PrepareOutcome, publish: PublishOutcome };
pub const PrepareOutcome = union(enum) { ok: []const u8, missing, failed: []const u8 };
pub const PublishFailureSource = enum { returned, thrown };
pub const PublishFailure = struct { source: PublishFailureSource, message: []const u8 };
pub const PublishOutcome = union(enum) { ok, missing, failed: PublishFailure };

pub const OwnedResult = union(Kind) {
    prepare: OwnedPrepareOutcome,
    publish: OwnedPublishOutcome,

    pub fn deinit(self: *OwnedResult, allocator: @import("std").mem.Allocator) void {
        switch (self.*) {
            .prepare => |outcome| switch (outcome) {
                .ok => |payload| allocator.free(payload),
                .missing => {},
                .failed => |message| allocator.free(message),
            },
            .publish => |outcome| switch (outcome) {
                .ok => {},
                .missing => {},
                .failed => |failure| allocator.free(failure.message),
            },
        }
        self.* = undefined;
    }
};
pub const OwnedPrepareOutcome = union(enum) { ok: []u8, missing, failed: []u8 };
pub const OwnedPublishFailure = struct { source: PublishFailureSource, message: []u8 };
pub const OwnedPublishOutcome = union(enum) { ok, missing, failed: OwnedPublishFailure };

pub fn cloneResult(
    result: Result,
    allocator: @import("std").mem.Allocator,
) @import("std").mem.Allocator.Error!OwnedResult {
    return switch (result) {
        .prepare => |outcome| .{ .prepare = switch (outcome) {
            .ok => |payload| .{ .ok = try allocator.dupe(u8, payload) },
            .missing => .missing,
            .failed => |message| .{ .failed = try allocator.dupe(u8, message) },
        } },
        .publish => |outcome| .{ .publish = switch (outcome) {
            .ok => .ok,
            .missing => .missing,
            .failed => |failure| .{ .failed = .{
                .source = failure.source,
                .message = try allocator.dupe(u8, failure.message),
            } },
        } },
    };
}
