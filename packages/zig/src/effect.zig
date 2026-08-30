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
