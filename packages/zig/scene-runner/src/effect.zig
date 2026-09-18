pub const Kind = enum { prepare, publish };

/// What a prepare effect's payload is for.
///
/// An `extend` hook returns a model to merge into the running one rather than
/// values to bind. It is a prepare effect because it fires in the same phase and
/// answers to the same policy — an unregistered one fails the action — so it
/// rides the existing request, resume, and outcome path instead of a parallel
/// one. Only what happens to the payload differs. Publish effects are always
/// `.binding`; the field is meaningless there.
pub const Role = enum { binding, extend };

pub const Request = struct {
    id: u64,
    kind: Kind,
    role: Role = .binding,
    hook: []const u8,
    scene_id: []const u8,
    action_id: []const u8,
    callback_index: usize,
    binding: ?[]const u8,
    /// Every binding this hook is declared to supply.
    ///
    /// `binding` says how the payload is shaped — one value when the hook
    /// supplies exactly one binding, a record of them when it supplies several
    /// — and goes null in the second case. That left a host with no way to know
    /// what the several were, so each one re-read the model to find out. The
    /// model is the runtime's, and so is this answer: a host validates the
    /// payload against the list it was given rather than deriving its own.
    ///
    /// Empty for publish and extend effects, which bind nothing.
    bindings: []const []const u8 = &.{},
    context_json: []const u8,
};
pub const Spec = struct {
    kind: Kind,
    role: Role = .binding,
    hook: []const u8,
    scene_id: []const u8,
    action_id: []const u8,
    callback_index: usize,
    binding: ?[]const u8 = null,
    bindings: []const []const u8 = &.{},
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
