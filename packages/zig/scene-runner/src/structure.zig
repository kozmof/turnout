//! Structural invariants of a model, checked once when the model is created.
//!
//! These are the constraints the JSON parser cannot see: it knows a field is a
//! string, not that the string names a scene the model actually has. They used
//! to live in the TypeScript host, which meant a model with two scenes of the
//! same id was rejected there and silently accepted by every other host — the
//! index keeps the first occurrence, so the second scene simply never ran.
//!
//! `spec/runtime-hosts.md` puts model well-formedness on the engine's side of
//! the line, with the host owning wording and the public API. So the check is
//! here, every host gets it, and a host that wants to itemise the failures
//! renders `Issues.messages` in its own voice.
//!
//! Every violation is collected rather than raised at the first one, because a
//! model with four mistakes in it should take one compile-fix cycle and not
//! four.

const std = @import("std");

/// The terminal route target, spelled `.` on the wire.
const terminal_route_target = ".";

pub const Error = error{OutOfMemory};

/// What a model got wrong, and the arena holding the messages.
///
/// `messages.len == 0` means the model is well formed. The arena owns every
/// message, so releasing the whole report is one free.
pub const Issues = struct {
    arena: std.heap.ArenaAllocator,
    messages: []const []const u8 = &.{},

    pub fn ok(self: *const Issues) bool {
        return self.messages.len == 0;
    }

    pub fn deinit(self: *Issues) void {
        self.arena.deinit();
        self.* = undefined;
    }
};

const Collector = struct {
    allocator: std.mem.Allocator,
    list: std.ArrayListUnmanaged([]const u8) = .empty,

    fn add(self: *Collector, comptime format: []const u8, args: anytype) Error!void {
        const message = try std.fmt.allocPrint(self.allocator, format, args);
        try self.list.append(self.allocator, message);
    }
};

fn objectOf(value: ?std.json.Value) ?std.json.ObjectMap {
    const found = value orelse return null;
    return if (found == .object) found.object else null;
}

fn arrayOf(value: ?std.json.Value) []std.json.Value {
    const found = value orelse return &.{};
    return if (found == .array) found.array.items else &.{};
}

fn stringOf(value: ?std.json.Value) ?[]const u8 {
    const found = value orelse return null;
    return if (found == .string) found.string else null;
}

/// Whether any action can merge a model into this one while it runs.
///
/// Checks about what the model contains have to be softer for a model that
/// grows: what a route arm names may simply not have arrived yet.
fn declaresExtendHook(root: std.json.ObjectMap) bool {
    for (arrayOf(root.get("scenes"))) |scene_value| {
        const scene = objectOf(scene_value) orelse continue;
        for (arrayOf(scene.get("actions"))) |action_value| {
            const action = objectOf(action_value) orelse continue;
            if (arrayOf(action.get("extend")).len > 0) return true;
        }
    }
    return false;
}

/// Reads the `binding` of every entry in a `prepare` array into `filled`.
///
/// A binding a hook fills needs no literal and no expression: the value arrives
/// before the prog runs. The compiler emits a type-appropriate placeholder for
/// these anyway, so its own output satisfies the stricter reading — but a model
/// written by hand or by another tool need not, and the engine has always run
/// those. Rejecting them here would be this check inventing a rule rather than
/// enforcing one.
fn collectPrepared(
    prepare: []std.json.Value,
    allocator: std.mem.Allocator,
    filled: *std.StringHashMapUnmanaged(void),
) Error!void {
    for (prepare) |entry_value| {
        const entry = objectOf(entry_value) orelse continue;
        const binding = stringOf(entry.get("binding")) orelse continue;
        try filled.put(allocator, binding, {});
    }
}

/// Collects the binding names of a prog, reporting duplicates and bindings that
/// nothing can ever fill.
fn checkProgBindings(
    prog: std.json.ObjectMap,
    location: []const u8,
    collector: *Collector,
    names: *std.StringHashMapUnmanaged(void),
    filled: *const std.StringHashMapUnmanaged(void),
) Error!void {
    for (arrayOf(prog.get("bindings"))) |binding_value| {
        const binding = objectOf(binding_value) orelse continue;
        const name = stringOf(binding.get("name")) orelse continue;
        if (names.contains(name)) {
            try collector.add("{s}: duplicate binding \"{s}\"", .{ location, name });
        }
        try names.put(collector.allocator, name, {});

        const has_value = binding.get("value") != null;
        const has_expr = binding.get("expr") != null;
        if (!has_value and !has_expr and !filled.contains(name)) {
            try collector.add(
                "{s}: binding \"{s}\" has neither value nor expr, and no prepare entry fills it",
                .{ location, name },
            );
        } else if (has_value and has_expr) {
            try collector.add(
                "{s}: binding \"{s}\" has both value and expr",
                .{ location, name },
            );
        }
    }
}

fn checkScenes(
    root: std.json.ObjectMap,
    scene_ids: *const std.StringHashMapUnmanaged(void),
    collector: *Collector,
) Error!void {
    for (arrayOf(root.get("scenes"))) |scene_value| {
        const scene = objectOf(scene_value) orelse continue;
        const scene_id = stringOf(scene.get("id")) orelse continue;

        var action_ids: std.StringHashMapUnmanaged(void) = .empty;
        defer action_ids.deinit(collector.allocator);
        for (arrayOf(scene.get("actions"))) |action_value| {
            const action = objectOf(action_value) orelse continue;
            const action_id = stringOf(action.get("id")) orelse continue;
            if (action_ids.contains(action_id)) {
                try collector.add(
                    "scene \"{s}\": duplicate action id \"{s}\"",
                    .{ scene_id, action_id },
                );
            }
            try action_ids.put(collector.allocator, action_id, {});
        }

        if (stringOf(scene.get("entryAction"))) |entry_action| {
            if (entry_action.len > 0 and !action_ids.contains(entry_action)) {
                try collector.add(
                    "scene \"{s}\": entry action \"{s}\" is not declared",
                    .{ scene_id, entry_action },
                );
            }
        }

        for (arrayOf(scene.get("actions"))) |action_value| {
            const action = objectOf(action_value) orelse continue;
            const action_id = stringOf(action.get("id")) orelse continue;
            try checkAction(scene_id, action_id, action, collector);
        }
    }
    _ = scene_ids;
}

fn checkAction(
    scene_id: []const u8,
    action_id: []const u8,
    action: std.json.ObjectMap,
    collector: *Collector,
) Error!void {
    const compute = objectOf(action.get("compute"));
    const prog = if (compute) |c| objectOf(c.get("prog")) else null;

    var prog_names: std.StringHashMapUnmanaged(void) = .empty;
    defer prog_names.deinit(collector.allocator);

    var prepared: std.StringHashMapUnmanaged(void) = .empty;
    defer prepared.deinit(collector.allocator);
    try collectPrepared(arrayOf(action.get("prepare")), collector.allocator, &prepared);

    if (prog) |p| {
        const location = try std.fmt.allocPrint(
            collector.allocator,
            "scene \"{s}\" action \"{s}\" compute",
            .{ scene_id, action_id },
        );
        try checkProgBindings(p, location, collector, &prog_names, &prepared);

        if (stringOf(compute.?.get("root"))) |root_name| {
            if (root_name.len > 0 and !prog_names.contains(root_name)) {
                try collector.add(
                    "scene \"{s}\" action \"{s}\" compute: root \"{s}\" is not declared in prog bindings",
                    .{ scene_id, action_id, root_name },
                );
            }
        }
    }

    // A merge naming a binding no prog declares, and a next rule naming an
    // action the scene does not have, are deliberately *not* errors here. The
    // engine warns and carries on for both, and
    // `fixtures/scene-route-vectors.json` pins that behaviour — "conditional
    // action and wildcard route" routes past a rule targeting `never`, and
    // "post-merge state and action output" merges a binding called `absent`.
    // Rejecting them would make this check contradict the engine it guards.
    //
    // The TypeScript host does reject both, as a stricter house rule about
    // likely typos. That is a host judgement about what to hand its callers,
    // which is the host's to make; it is not a claim that the engine cannot
    // run the model.

    for (arrayOf(action.get("next"))) |rule_value| {
        const rule = objectOf(rule_value) orelse continue;
        const next_compute = objectOf(rule.get("compute")) orelse continue;
        const next_prog = objectOf(next_compute.get("prog")) orelse continue;
        var rule_names: std.StringHashMapUnmanaged(void) = .empty;
        defer rule_names.deinit(collector.allocator);
        var rule_prepared: std.StringHashMapUnmanaged(void) = .empty;
        defer rule_prepared.deinit(collector.allocator);
        try collectPrepared(arrayOf(rule.get("prepare")), collector.allocator, &rule_prepared);
        const location = try std.fmt.allocPrint(
            collector.allocator,
            "scene \"{s}\" action \"{s}\" next-rule",
            .{ scene_id, action_id },
        );
        try checkProgBindings(next_prog, location, collector, &rule_names, &rule_prepared);

        if (stringOf(next_compute.get("condition"))) |condition| {
            if (condition.len > 0 and !rule_names.contains(condition)) {
                try collector.add(
                    "scene \"{s}\" action \"{s}\" next-rule: condition \"{s}\" is not declared in prog bindings",
                    .{ scene_id, action_id, condition },
                );
            }
        }
    }
}

fn checkRoutes(
    root: std.json.ObjectMap,
    scene_ids: *const std.StringHashMapUnmanaged(void),
    growable: bool,
    collector: *Collector,
) Error!void {
    var route_ids: std.StringHashMapUnmanaged(void) = .empty;
    defer route_ids.deinit(collector.allocator);

    for (arrayOf(root.get("routes"))) |route_value| {
        const route = objectOf(route_value) orelse continue;
        const route_id = stringOf(route.get("id")) orelse continue;

        if (route_ids.contains(route_id)) {
            try collector.add("duplicate route id \"{s}\"", .{route_id});
        }
        try route_ids.put(collector.allocator, route_id, {});

        if (scene_ids.contains(route_id)) {
            try collector.add("route id \"{s}\" conflicts with a scene id", .{route_id});
        }

        const entry_scene = stringOf(route.get("entrySceneId"));
        if (entry_scene == null or entry_scene.?.len == 0) {
            try collector.add("route \"{s}\" has no entry scene declared", .{route_id});
        } else if (!scene_ids.contains(entry_scene.?)) {
            try collector.add(
                "route \"{s}\" entry scene \"{s}\" is not in the model",
                .{ route_id, entry_scene.? },
            );
        }

        // A route arm may name a scene an extend hook has yet to bring in. That
        // is the point of merging mid-run, so a model that can grow is not held
        // to having every target already. Reaching a target that never arrives
        // is still an error, raised when the transition is taken.
        if (growable) continue;
        for (arrayOf(route.get("match"))) |arm_value| {
            const arm = objectOf(arm_value) orelse continue;
            const target = stringOf(arm.get("target")) orelse continue;
            if (std.mem.eql(u8, target, terminal_route_target)) continue;
            if (!scene_ids.contains(target)) {
                try collector.add(
                    "route \"{s}\" match target \"{s}\" is not in the model",
                    .{ route_id, target },
                );
            }
        }
    }
}

/// Checks every structural invariant and returns what the model got wrong.
///
/// The caller owns the result and must `deinit` it, valid or not.
pub fn validate(root: std.json.Value, parent: std.mem.Allocator) Error!Issues {
    var arena: std.heap.ArenaAllocator = .init(parent);
    errdefer arena.deinit();
    if (root != .object) return .{ .arena = arena };

    var collector: Collector = .{ .allocator = arena.allocator() };

    var scene_ids: std.StringHashMapUnmanaged(void) = .empty;
    defer scene_ids.deinit(collector.allocator);
    for (arrayOf(root.object.get("scenes"))) |scene_value| {
        const scene = objectOf(scene_value) orelse continue;
        const scene_id = stringOf(scene.get("id")) orelse continue;
        if (scene_ids.contains(scene_id)) {
            try collector.add("duplicate scene id \"{s}\"", .{scene_id});
        }
        try scene_ids.put(collector.allocator, scene_id, {});
    }

    try checkRoutes(root.object, &scene_ids, declaresExtendHook(root.object), &collector);
    try checkScenes(root.object, &scene_ids, &collector);

    return .{ .arena = arena, .messages = try collector.list.toOwnedSlice(collector.allocator) };
}

// ─────────────────────────────────────────────────────────────────────────────

fn issuesFor(source: []const u8) !Issues {
    const parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, source, .{});
    defer parsed.deinit();
    return validate(parsed.value, std.testing.allocator);
}

fn expectIssue(source: []const u8, wanted: []const u8) !void {
    var issues = try issuesFor(source);
    defer issues.deinit();
    for (issues.messages) |message| {
        if (std.mem.indexOf(u8, message, wanted) != null) return;
    }
    std.debug.print("no issue matching \"{s}\" in:\n", .{wanted});
    for (issues.messages) |message| std.debug.print("  - {s}\n", .{message});
    return error.IssueNotReported;
}

fn expectClean(source: []const u8) !void {
    var issues = try issuesFor(source);
    defer issues.deinit();
    if (issues.ok()) return;
    for (issues.messages) |message| std.debug.print("  unexpected: {s}\n", .{message});
    return error.UnexpectedIssues;
}

test "a well formed model reports nothing" {
    try expectClean(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"start","actions":[
        \\  {"id":"start",
        \\   "compute":{"root":"go","prog":{"bindings":[{"name":"go","type":"bool","value":true}]}},
        \\   "merge":[{"binding":"go","toState":"ns.flag"}]}
        \\]}],"routes":[]}
    );
}

test "duplicate scene ids are reported rather than silently dropped" {
    // The index keeps the first occurrence, so before this check the second
    // scene simply never ran and nothing said so.
    try expectIssue(
        \\{"version":2,"scenes":[
        \\  {"id":"main","entryAction":"a","actions":[{"id":"a"}]},
        \\  {"id":"main","entryAction":"b","actions":[{"id":"b"}]}
        \\]}
    , "duplicate scene id \"main\"");
}

test "a route entry scene that is not in the model is reported" {
    try expectIssue(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[{"id":"a"}]}],
        \\ "routes":[{"id":"r","entrySceneId":"ghost","match":[]}]}
    , "route \"r\" entry scene \"ghost\" is not in the model");
}

test "a route with no entry scene is reported" {
    try expectIssue(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[{"id":"a"}]}],
        \\ "routes":[{"id":"r","match":[]}]}
    , "route \"r\" has no entry scene declared");
}

test "a route id colliding with a scene id is reported" {
    try expectIssue(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[{"id":"a"}]}],
        \\ "routes":[{"id":"main","entrySceneId":"main","match":[]}]}
    , "route id \"main\" conflicts with a scene id");
}

test "a match target outside the model is reported unless the model can grow" {
    const fixed =
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[{"id":"a"}]}],
        \\ "routes":[{"id":"r","entrySceneId":"main","match":[{"patterns":["main.a"],"target":"ghost"}]}]}
    ;
    try expectIssue(fixed, "route \"r\" match target \"ghost\" is not in the model");

    // The same model with an extend hook: the target may still be on its way.
    try expectClean(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[
        \\  {"id":"a","extend":["plugins"]}]}],
        \\ "routes":[{"id":"r","entrySceneId":"main","match":[{"patterns":["main.a"],"target":"ghost"}]}]}
    );
}

test "the terminal route target is not a missing scene" {
    try expectClean(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[{"id":"a"}]}],
        \\ "routes":[{"id":"r","entrySceneId":"main","match":[{"patterns":["main.a"],"target":"."}]}]}
    );
}

test "an entry action the scene does not declare is reported" {
    try expectIssue(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"ghost","actions":[{"id":"a"}]}]}
    , "scene \"main\": entry action \"ghost\" is not declared");
}

test "duplicate action ids are reported" {
    try expectIssue(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[{"id":"a"},{"id":"a"}]}]}
    , "scene \"main\": duplicate action id \"a\"");
}

test "a compute root that is not a binding is reported" {
    try expectIssue(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[
        \\  {"id":"a","compute":{"root":"ghost","prog":{"bindings":[{"name":"go","type":"bool","value":true}]}}}]}]}
    , "root \"ghost\" is not declared in prog bindings");
}

test "what the engine warns about is left for the engine to warn about" {
    // Both of these run: the engine skips the rule and skips the merge, each
    // with a warning, and the shared vectors assert exactly that. A structural
    // check that refused them would be stricter than the thing it protects.
    try expectClean(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[
        \\  {"id":"a","compute":{"root":"go","prog":{"bindings":[{"name":"go","type":"bool","value":true}]}},
        \\   "merge":[{"binding":"ghost","toState":"ns.flag"}],
        \\   "next":[{"action":"never"}]}]}]}
    );
}

test "a binding with neither value nor expr is reported" {
    try expectIssue(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[
        \\  {"id":"a","compute":{"root":"go","prog":{"bindings":[{"name":"go","type":"bool"}]}}}]}]}
    , "binding \"go\" has neither value nor expr");
}

test "a binding a prepare hook fills needs no value of its own" {
    try expectClean(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[
        \\  {"id":"a","prepare":[{"binding":"input","fromHook":"load"}],
        \\   "compute":{"root":"input","prog":{"bindings":[{"name":"input","type":"number"}]}}}]}]}
    );
}

test "a next-rule binding its own prepare block fills needs no value" {
    try expectClean(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[
        \\  {"id":"a","next":[{"action":"a","prepare":[{"binding":"flag","fromAction":"a"}],
        \\   "compute":{"condition":"flag","prog":{"bindings":[{"name":"flag","type":"bool"}]}}}]}]}]}
    );
}

test "a binding with both value and expr is reported" {
    try expectIssue(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[
        \\  {"id":"a","compute":{"root":"go","prog":{"bindings":[
        \\    {"name":"go","type":"bool","value":true,"expr":{"combine":{"fn":"pass","args":[{"lit":1}]}}}]}}}]}]}
    , "binding \"go\" has both value and expr");
}

test "a duplicate prog binding is reported" {
    try expectIssue(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[
        \\  {"id":"a","compute":{"root":"go","prog":{"bindings":[
        \\    {"name":"go","type":"bool","value":true},{"name":"go","type":"bool","value":false}]}}}]}]}
    , "duplicate binding \"go\"");
}

test "a next-rule condition that is not a binding is reported" {
    try expectIssue(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[
        \\  {"id":"a","next":[{"action":"a","compute":{"condition":"ghost","prog":{"bindings":[
        \\    {"name":"go","type":"bool","value":true}]}}}]}]}]}
    , "condition \"ghost\" is not declared in prog bindings");
}

test "every violation is collected rather than stopping at the first" {
    var issues = try issuesFor(
        \\{"version":2,"scenes":[
        \\  {"id":"main","entryAction":"ghost","actions":[{"id":"a"},{"id":"a"}]},
        \\  {"id":"main","entryAction":"a","actions":[{"id":"a"}]}
        \\]}
    );
    defer issues.deinit();
    try std.testing.expect(issues.messages.len >= 3);
}

test "a bindingless prog and an absent compute are both tolerated" {
    // An action need not compute anything; only claiming to and then not is an
    // error. This is the shape most conformance vectors use.
    try expectClean(
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[{"id":"a"}]}]}
    );
}
