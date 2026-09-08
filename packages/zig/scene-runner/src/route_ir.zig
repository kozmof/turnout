//! The lowered form of a route's match block.
//!
//! A match pattern is a dotted string such as `s1.a.b`, `s1.*.a`, or `_`.
//! Selecting the next scene used to re-split and re-validate every pattern of
//! every arm on each transition, reading them straight out of the parsed JSON.
//! Lowering happens once, when the model is indexed.
//!
//! Neither this module nor the matcher touches JSON, which is what lets a route
//! driver stop holding a `std.json.Value` into the model tree.

const std = @import("std");

/// One match pattern.
pub const Pattern = union(enum) {
    /// `_`: matches anything, and always loses to a more specific pattern.
    any,
    /// A scene id followed by an action suffix.
    scene: Scene,

    pub const Scene = struct {
        scene_id: []const u8,
        /// `*` after the scene id: the suffix may be preceded by other actions.
        wildcard: bool,
        /// The action ids after the scene id, with any `*` removed.
        actions: []const []const u8,
    };
};

pub const MatchArm = struct {
    patterns: []const Pattern,
    /// Null is the explicit terminal target, encoded as `.` on the wire.
    target: ?[]const u8,
};

pub const Route = struct {
    entry_scene_id: []const u8,
    arms: []const MatchArm,
    /// Set when the match block could not be lowered. Selecting a next scene
    /// then raises `InvalidRoute`, which is where that error surfaced before.
    invalid: bool = false,
};

pub const Error = error{OutOfMemory};

/// Lowers a route's `match` array. A malformed arm marks the whole route
/// invalid rather than failing, so the error still surfaces at selection time.
///
/// Abandoning a partly-lowered match block releases what it built, so this is
/// safe with any allocator. The one production caller still lowers into the
/// model's arena, where the release is a no-op.
pub fn lower(
    entry_scene_id: []const u8,
    match: std.json.Value,
    allocator: std.mem.Allocator,
) Error!Route {
    return lowerArms(entry_scene_id, match, allocator) catch |err| switch (err) {
        error.OutOfMemory => error.OutOfMemory,
        error.InvalidMatch => .{ .entry_scene_id = entry_scene_id, .arms = &.{}, .invalid = true },
    };
}

/// The lowering proper. A malformed arm raises `InvalidMatch` so that one
/// `errdefer` covers every way out; `lower` turns that back into an invalid
/// route.
fn lowerArms(
    entry_scene_id: []const u8,
    match: std.json.Value,
    allocator: std.mem.Allocator,
) (Error || error{InvalidMatch})!Route {
    if (match != .array) return error.InvalidMatch;

    const arms = try allocator.alloc(MatchArm, match.array.items.len);
    var built: usize = 0;
    errdefer {
        freeArms(arms[0..built], allocator);
        allocator.free(arms);
    }

    for (match.array.items, 0..) |raw, index| {
        if (raw != .object) return error.InvalidMatch;
        const patterns = raw.object.get("patterns") orelse return error.InvalidMatch;
        const target = raw.object.get("target") orelse return error.InvalidMatch;
        if (patterns != .array or target != .string) return error.InvalidMatch;

        const lowered = try allocator.alloc(Pattern, patterns.array.items.len);
        var slots: usize = 0;
        errdefer {
            freePatterns(lowered[0..slots], allocator);
            allocator.free(lowered);
        }
        for (patterns.array.items, 0..) |pattern, slot| {
            if (pattern != .string) return error.InvalidMatch;
            lowered[slot] = try lowerPattern(pattern.string, allocator);
            slots += 1;
        }
        arms[index] = .{
            .patterns = lowered,
            .target = if (std.mem.eql(u8, target.string, ".")) null else target.string,
        };
        built += 1;
    }
    return .{ .entry_scene_id = entry_scene_id, .arms = arms };
}

fn freePatterns(patterns: []const Pattern, allocator: std.mem.Allocator) void {
    for (patterns) |pattern| switch (pattern) {
        .any => {},
        // The action ids are borrowed from the pattern string; only the slice
        // holding them was allocated here.
        .scene => |scene| allocator.free(scene.actions),
    };
}

fn freeArms(arms: []const MatchArm, allocator: std.mem.Allocator) void {
    for (arms) |arm| {
        freePatterns(arm.patterns, allocator);
        allocator.free(arm.patterns);
    }
}

fn lowerPattern(raw: []const u8, allocator: std.mem.Allocator) Error!Pattern {
    if (std.mem.eql(u8, raw, "_")) return .any;

    var parts = std.mem.splitScalar(u8, raw, '.');
    const scene_id = parts.next() orelse "";
    var rest = parts;
    const first = rest.next();
    const wildcard = first != null and std.mem.eql(u8, first.?, "*");

    var count: usize = if (first == null or wildcard) 0 else 1;
    while (rest.next() != null) count += 1;

    const actions = try allocator.alloc([]const u8, count);
    // Re-walk, skipping the scene id and the wildcard if there was one.
    parts = std.mem.splitScalar(u8, raw, '.');
    _ = parts.next();
    if (wildcard) _ = parts.next();
    var index: usize = 0;
    while (parts.next()) |action| : (index += 1) actions[index] = action;

    return .{ .scene = .{ .scene_id = scene_id, .wildcard = wildcard, .actions = actions } };
}

fn expectActions(expected: []const []const u8, actual: []const []const u8) !void {
    try std.testing.expectEqual(expected.len, actual.len);
    for (expected, actual) |want, got| try std.testing.expectEqualStrings(want, got);
}

test "patterns lower to a scene, a wildcard flag, and an action suffix" {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    try std.testing.expectEqual(Pattern.any, try lowerPattern("_", allocator));

    const bare = (try lowerPattern("s1", allocator)).scene;
    try std.testing.expectEqualStrings("s1", bare.scene_id);
    try std.testing.expect(!bare.wildcard);
    try std.testing.expectEqual(@as(usize, 0), bare.actions.len);

    const suffix = (try lowerPattern("s1.a.b", allocator)).scene;
    try std.testing.expect(!suffix.wildcard);
    try expectActions(&.{ "a", "b" }, suffix.actions);

    const starred = (try lowerPattern("s1.*.b", allocator)).scene;
    try std.testing.expect(starred.wildcard);
    try expectActions(&.{"b"}, starred.actions);

    const only_star = (try lowerPattern("s1.*", allocator)).scene;
    try std.testing.expect(only_star.wildcard);
    try std.testing.expectEqual(@as(usize, 0), only_star.actions.len);
}

test "a malformed arm marks the route invalid rather than failing" {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    defer arena.deinit();
    const parsed = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "[{\"patterns\":[\"s1.a\"]}]",
        .{},
    );
    defer parsed.deinit();
    const route = try lower("s1", parsed.value, arena.allocator());
    try std.testing.expect(route.invalid);
}
