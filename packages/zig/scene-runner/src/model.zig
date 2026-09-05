const std = @import("std");
const action_runtime = @import("action.zig");
const compute_runtime = @import("turnout_runtime").compute;
const effect = @import("effect.zig");
const state_runtime = @import("state.zig");
const turnout_value = @import("turnout_runtime").value;

pub const current_version: u32 = 2;
pub const Limits = struct {
    max_model_bytes: usize = 16 * 1024 * 1024,
    max_nesting: usize = 128,
};
pub const ValidationError = error{
    OutOfMemory,
    ModelTooLarge,
    ModelTooDeep,
    InvalidJson,
    RootMustBeObject,
    UnsupportedVersion,
    RuntimeTooOld,
    RuntimeTooNew,
    CompilerMetadata,
    InvalidCompute,
};

pub const NextRuleCondition = union(enum) {
    matched: bool,
    invalid_type: []const u8,
    missing_program,
};

pub const NextRuleWarningKind = enum { invalid_condition, missing_program };
pub const NextRuleWarning = struct {
    kind: NextRuleWarningKind,
    rule_index: usize,
    condition_name: []const u8,
    actual_type: []const u8 = "",
    target_action_id: []const u8 = "",
};
pub const NextRuleSelection = struct {
    target: ?[]const u8,
    warnings: []NextRuleWarning,

    pub fn deinit(self: *NextRuleSelection, allocator: std.mem.Allocator) void {
        allocator.free(self.warnings);
        self.* = undefined;
    }
};

pub const EffectSchedule = struct {
    specs: []effect.Spec,

    pub fn deinit(self: *EffectSchedule, allocator: std.mem.Allocator) void {
        allocator.free(self.specs);
        self.* = undefined;
    }
};

/// Identifies one lowered program inside a model: an action's own compute, or
/// the compute of one of its next rules.
const ProgramKey = struct {
    scene: []const u8,
    action: []const u8,
    /// `action_compute` for the action itself, otherwise the rule index.
    rule: u32,

    const action_compute: u32 = std.math.maxInt(u32);

    const Context = struct {
        pub fn hash(_: Context, key: ProgramKey) u64 {
            var hasher = std.hash.Wyhash.init(0);
            hasher.update(key.scene);
            hasher.update(&.{0});
            hasher.update(key.action);
            hasher.update(std.mem.asBytes(&key.rule));
            return hasher.final();
        }

        pub fn eql(_: Context, a: ProgramKey, b: ProgramKey) bool {
            return a.rule == b.rule and
                std.mem.eql(u8, a.scene, b.scene) and
                std.mem.eql(u8, a.action, b.action);
        }
    };
};

/// Every compute program in the model, lowered once when the model is created.
///
/// Lowering is the expensive half of running a program; evaluating the lowered
/// form is several times cheaper than walking the JSON. Doing it per execution
/// would be slower than the tree interpreter it replaced, so it happens here,
/// alongside the validation pass that already visits every program.
///
/// Keys borrow scene and action ids from the parsed tree, and every program is
/// lowered into one arena, so releasing the cache is a single free.
const ProgramCache = struct {
    arena: std.heap.ArenaAllocator,
    entries: std.HashMapUnmanaged(
        ProgramKey,
        compute_runtime.Program,
        ProgramKey.Context,
        std.hash_map.default_max_load_percentage,
    ) = .empty,

    fn deinit(self: *ProgramCache) void {
        self.arena.deinit();
        self.* = undefined;
    }

    fn get(self: *const ProgramCache, key: ProgramKey) ?*const compute_runtime.Program {
        return self.entries.getPtr(key);
    }
};

/// Lowers every action compute and next-rule compute in the model.
///
/// A program that is absent or malformed is simply not cached; execution falls
/// back to the JSON path, which reports the same errors it always did.
fn buildProgramCache(root: std.json.ObjectMap, parent: std.mem.Allocator) ValidationError!ProgramCache {
    var cache: ProgramCache = .{ .arena = .init(parent) };
    errdefer cache.deinit();
    const allocator = cache.arena.allocator();

    const scenes = root.get("scenes") orelse return cache;
    if (scenes != .array) return cache;
    for (scenes.array.items) |scene_value| {
        if (scene_value != .object) continue;
        const scene_id = stringOf(scene_value.object.get("id")) orelse continue;
        const actions = scene_value.object.get("actions") orelse continue;
        if (actions != .array) continue;
        for (actions.array.items) |action_value| {
            if (action_value != .object) continue;
            const action_id = stringOf(action_value.object.get("id")) orelse continue;
            if (action_value.object.get("compute")) |action_compute|
                try cacheProgram(&cache, allocator, .{
                    .scene = scene_id,
                    .action = action_id,
                    .rule = ProgramKey.action_compute,
                }, action_compute, "root");
            const rules = action_value.object.get("next") orelse continue;
            if (rules != .array) continue;
            for (rules.array.items, 0..) |rule, index| {
                if (rule != .object) continue;
                const rule_compute = rule.object.get("compute") orelse continue;
                try cacheProgram(&cache, allocator, .{
                    .scene = scene_id,
                    .action = action_id,
                    .rule = @intCast(index),
                }, rule_compute, "condition");
            }
        }
    }
    return cache;
}

fn cacheProgram(
    cache: *ProgramCache,
    allocator: std.mem.Allocator,
    key: ProgramKey,
    model_compute: std.json.Value,
    output_field: []const u8,
) ValidationError!void {
    if (model_compute != .object) return;
    const prog = model_compute.object.get("prog") orelse return;
    const output = model_compute.object.get(output_field) orelse std.json.Value{ .string = "" };
    if (output != .string) return;
    const lowered = compute_runtime.loadProgramInto(prog, output.string, allocator) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return,
    };
    try cache.entries.put(allocator, key, lowered);
}

fn stringOf(field: ?std.json.Value) ?[]const u8 {
    const value = field orelse return null;
    return if (value == .string) value.string else null;
}

pub const RuntimeModel = struct {
    parsed: std.json.Parsed(std.json.Value),
    programs: ProgramCache,

    pub fn init(allocator: std.mem.Allocator, bytes: []const u8, limits: Limits) ValidationError!RuntimeModel {
        try validateJson(allocator, bytes, limits);
        const parsed = std.json.parseFromSlice(std.json.Value, allocator, bytes, .{
            .max_value_len = limits.max_model_bytes,
        }) catch return error.InvalidJson;
        errdefer parsed.deinit();
        return .{
            .parsed = parsed,
            .programs = try buildProgramCache(parsed.value.object, allocator),
        };
    }

    pub fn deinit(self: *RuntimeModel) void {
        self.programs.deinit();
        self.parsed.deinit();
        self.* = undefined;
    }

    /// The lowered program for an action's own compute, when there is one.
    fn actionProgram(self: *const RuntimeModel, scene_id: []const u8, action_id: []const u8) ?*const compute_runtime.Program {
        return self.programs.get(.{
            .scene = scene_id,
            .action = action_id,
            .rule = ProgramKey.action_compute,
        });
    }

    pub fn root(self: *const RuntimeModel) std.json.ObjectMap {
        return self.parsed.value.object;
    }

    pub fn sceneEntryAction(self: *const RuntimeModel, scene_id: []const u8) ![]const u8 {
        const scenes = self.root().get("scenes") orelse return error.SceneNotFound;
        if (scenes != .array) return error.SceneNotFound;
        for (scenes.array.items) |scene| {
            if (scene != .object) continue;
            const id = scene.object.get("id") orelse continue;
            if (id != .string or !std.mem.eql(u8, id.string, scene_id)) continue;
            const entry = scene.object.get("entryAction") orelse return error.NoEntryAction;
            if (entry != .string or entry.string.len == 0) return error.NoEntryAction;
            if (self.findAction(scene_id, entry.string) == null) return error.ActionNotFound;
            return entry.string;
        }
        return error.SceneNotFound;
    }

    pub fn executeActionCompute(
        self: *const RuntimeModel,
        scene_id: []const u8,
        action_id: []const u8,
        inputs: *const std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue),
        allocator: std.mem.Allocator,
    ) !turnout_value.OwnedTaggedValue {
        const action = self.findAction(scene_id, action_id) orelse return error.ActionNotFound;
        const action_compute = action.get("compute") orelse return turnout_value.buildNull(.missing, &.{}, allocator);
        if (action_compute != .object or !action_compute.object.contains("prog"))
            return turnout_value.buildNull(.missing, &.{}, allocator);
        if (self.actionProgram(scene_id, action_id)) |lowered|
            return compute_runtime.executeLoaded(lowered, inputs, allocator);
        return compute_runtime.executeJson(action_compute, inputs, allocator);
    }

    pub fn executeAction(
        self: *const RuntimeModel,
        scene_id: []const u8,
        action_id: []const u8,
        state: *const state_runtime.State,
        allocator: std.mem.Allocator,
    ) !action_runtime.Result {
        const action = self.findAction(scene_id, action_id) orelse return error.ActionNotFound;
        return action_runtime.execute(.{ .object = action }, self.actionProgram(scene_id, action_id), state, allocator);
    }

    pub fn executeActionWithPrepared(
        self: *const RuntimeModel,
        scene_id: []const u8,
        action_id: []const u8,
        state: *const state_runtime.State,
        prepared: *const std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue),
        allocator: std.mem.Allocator,
    ) !action_runtime.Result {
        const action = self.findAction(scene_id, action_id) orelse return error.ActionNotFound;
        return action_runtime.executeWithPrepared(
            .{ .object = action },
            self.actionProgram(scene_id, action_id),
            state,
            prepared,
            allocator,
        );
    }

    pub fn actionEffectSchedule(
        self: *const RuntimeModel,
        scene_id: []const u8,
        action_id: []const u8,
        allocator: std.mem.Allocator,
    ) !EffectSchedule {
        const action = self.findAction(scene_id, action_id) orelse return error.ActionNotFound;
        var specs = std.ArrayList(effect.Spec).empty;
        errdefer specs.deinit(allocator);
        var scheduled_prepare_hooks: std.StringHashMapUnmanaged(usize) = .empty;
        defer scheduled_prepare_hooks.deinit(allocator);
        if (action.get("prepare")) |prepare| {
            if (prepare != .array) return error.InvalidPrepare;
            for (prepare.array.items, 0..) |entry, index| {
                if (entry != .object) return error.InvalidPrepare;
                const from_hook = entry.object.get("fromHook") orelse continue;
                const binding = entry.object.get("binding") orelse return error.InvalidPrepare;
                if (from_hook != .string or from_hook.string.len == 0) return error.InvalidPrepare;
                if (binding != .string or binding.string.len == 0) return error.InvalidPrepare;
                if (scheduled_prepare_hooks.get(from_hook.string)) |spec_index| {
                    specs.items[spec_index].binding = null;
                    continue;
                }
                try scheduled_prepare_hooks.put(allocator, from_hook.string, specs.items.len);
                try specs.append(allocator, .{
                    .kind = .prepare,
                    .hook = from_hook.string,
                    .scene_id = scene_id,
                    .action_id = action_id,
                    .callback_index = index,
                    .binding = binding.string,
                });
            }
        }
        if (action.get("publish")) |publish| {
            if (publish != .array) return error.InvalidPublish;
            for (publish.array.items, 0..) |hook, index| {
                if (hook != .string or hook.string.len == 0) return error.InvalidPublish;
                try specs.append(allocator, .{
                    .kind = .publish,
                    .hook = hook.string,
                    .scene_id = scene_id,
                    .action_id = action_id,
                    .callback_index = index,
                });
            }
        }
        return .{ .specs = try specs.toOwnedSlice(allocator) };
    }

    pub fn selectNextAfterAction(
        self: *const RuntimeModel,
        scene_id: []const u8,
        action_id: []const u8,
        result: *const action_runtime.Result,
        allocator: std.mem.Allocator,
    ) !NextRuleSelection {
        const action = self.findAction(scene_id, action_id) orelse return error.ActionNotFound;
        const rules_value = action.get("next") orelse
            return .{ .target = null, .warnings = try allocator.alloc(NextRuleWarning, 0) };
        if (rules_value != .array) return error.NextRuleNotFound;
        var warnings = std.ArrayList(NextRuleWarning).empty;
        errdefer warnings.deinit(allocator);
        for (rules_value.array.items, 0..) |rule, index| {
            if (rule != .object) return error.NextRuleNotFound;
            var prepared = try prepareNextRule(rule, result, allocator);
            defer deinitPrepared(&prepared, allocator);
            const outcome = try self.evaluateNextRule(scene_id, action_id, index, &prepared, allocator);
            switch (outcome) {
                .matched => |matched| if (matched) {
                    const target = rule.object.get("action") orelse return error.NextRuleNotFound;
                    if (target != .string) return error.NextRuleNotFound;
                    return .{ .target = target.string, .warnings = try warnings.toOwnedSlice(allocator) };
                },
                .invalid_type => |actual_type| try warnings.append(allocator, .{
                    .kind = .invalid_condition,
                    .rule_index = index,
                    .condition_name = nextConditionName(rule),
                    .actual_type = actual_type,
                }),
                .missing_program => try warnings.append(allocator, .{
                    .kind = .missing_program,
                    .rule_index = index,
                    .condition_name = nextConditionName(rule),
                    .target_action_id = nextTargetAction(rule),
                }),
            }
        }
        return .{ .target = null, .warnings = try warnings.toOwnedSlice(allocator) };
    }

    pub fn evaluateNextRule(
        self: *const RuntimeModel,
        scene_id: []const u8,
        action_id: []const u8,
        rule_index: usize,
        inputs: *const std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue),
        allocator: std.mem.Allocator,
    ) !NextRuleCondition {
        const action = self.findAction(scene_id, action_id) orelse return error.ActionNotFound;
        const rules = action.get("next") orelse return error.NextRuleNotFound;
        if (rules != .array or rule_index >= rules.array.items.len) return error.NextRuleNotFound;
        const rule = rules.array.items[rule_index];
        if (rule != .object) return error.NextRuleNotFound;
        const next_compute = rule.object.get("compute") orelse return .{ .matched = true };
        if (next_compute != .object) return .missing_program;
        const prog = next_compute.object.get("prog") orelse return .missing_program;
        const condition = next_compute.object.get("condition") orelse std.json.Value{ .string = "" };
        if (condition != .string) return .{ .invalid_type = "undefined" };
        const key: ProgramKey = .{ .scene = scene_id, .action = action_id, .rule = @intCast(rule_index) };
        var result = if (self.programs.get(key)) |lowered|
            try compute_runtime.executeLoaded(lowered, inputs, allocator)
        else
            try compute_runtime.executeProgram(prog, condition.string, inputs, allocator);
        defer result.deinit(allocator);
        if (result.value != .boolean or result.tags.len != 0) return .{ .invalid_type = if (result.value == .null_value) "null" else @tagName(result.value) };
        return .{ .matched = result.value.boolean };
    }

    pub fn selectNextRule(
        self: *const RuntimeModel,
        scene_id: []const u8,
        action_id: []const u8,
        prepared_by_rule: []const std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue),
        allocator: std.mem.Allocator,
    ) !NextRuleSelection {
        const action = self.findAction(scene_id, action_id) orelse return error.ActionNotFound;
        const rules_value = action.get("next") orelse return .{ .target = null, .warnings = try allocator.alloc(NextRuleWarning, 0) };
        if (rules_value != .array) return error.NextRuleNotFound;
        const rules = rules_value.array.items;
        if (prepared_by_rule.len != 0 and prepared_by_rule.len != rules.len) return error.InvalidPreparedRuleCount;
        var warnings = std.ArrayList(NextRuleWarning).empty;
        errdefer warnings.deinit(allocator);
        const empty_inputs: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
        for (rules, 0..) |rule, index| {
            const inputs = if (prepared_by_rule.len == 0) &empty_inputs else &prepared_by_rule[index];
            const outcome = try self.evaluateNextRule(scene_id, action_id, index, inputs, allocator);
            switch (outcome) {
                .matched => |matched| if (matched) {
                    const target = rule.object.get("action") orelse return error.NextRuleNotFound;
                    if (target != .string) return error.NextRuleNotFound;
                    return .{ .target = target.string, .warnings = try warnings.toOwnedSlice(allocator) };
                },
                .invalid_type => |actual_type| try warnings.append(allocator, .{
                    .kind = .invalid_condition,
                    .rule_index = index,
                    .condition_name = nextConditionName(rule),
                    .actual_type = actual_type,
                }),
                .missing_program => try warnings.append(allocator, .{
                    .kind = .missing_program,
                    .rule_index = index,
                    .condition_name = nextConditionName(rule),
                    .target_action_id = nextTargetAction(rule),
                }),
            }
        }
        return .{ .target = null, .warnings = try warnings.toOwnedSlice(allocator) };
    }

    fn findAction(self: *const RuntimeModel, scene_id: []const u8, action_id: []const u8) ?std.json.ObjectMap {
        const scenes = self.root().get("scenes") orelse return null;
        if (scenes != .array) return null;
        for (scenes.array.items) |scene| {
            if (scene != .object) continue;
            const id = scene.object.get("id") orelse continue;
            if (id != .string or !std.mem.eql(u8, id.string, scene_id)) continue;
            const actions = scene.object.get("actions") orelse return null;
            if (actions != .array) return null;
            for (actions.array.items) |action| {
                if (action != .object) continue;
                const candidate = action.object.get("id") orelse continue;
                if (candidate == .string and std.mem.eql(u8, candidate.string, action_id)) return action.object;
            }
            return null;
        }
        return null;
    }
};

fn prepareNextRule(
    rule: std.json.Value,
    result: *const action_runtime.Result,
    allocator: std.mem.Allocator,
) !std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) {
    var prepared: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    errdefer deinitPrepared(&prepared, allocator);
    const entries = rule.object.get("prepare") orelse return prepared;
    if (entries != .array) return error.InvalidPrepare;
    for (entries.array.items) |entry| {
        if (entry != .object) return error.InvalidPrepare;
        const binding = entry.object.get("binding") orelse return error.InvalidPrepare;
        if (binding != .string or binding.string.len == 0) return error.InvalidPrepare;
        var prepared_value = if (entry.object.get("fromAction")) |source| blk: {
            if (source != .string) return error.InvalidPrepare;
            const found = result.binding_values.get(source.string) orelse return error.MissingActionBinding;
            break :blk try turnout_value.build(found.value, found.tags, allocator);
        } else if (entry.object.get("fromState")) |source| blk: {
            if (source != .string) return error.InvalidPrepare;
            break :blk try result.state_after_merge.read(source.string, allocator);
        } else if (entry.object.get("fromLiteral")) |literal|
            try inferLiteral(literal, allocator)
        else if (entry.object.contains("fromHook"))
            return error.HookRequired
        else
            continue;
        const tagged = prepared_value.borrowed();
        if (prepared.getPtr(binding.string)) |previous| {
            turnout_value.deinitTaggedValue(previous, allocator);
            previous.* = tagged;
            continue;
        }
        prepared.put(allocator, binding.string, tagged) catch |err| {
            prepared_value.deinit(allocator);
            return err;
        };
    }
    return prepared;
}

fn inferLiteral(literal: std.json.Value, allocator: std.mem.Allocator) !turnout_value.OwnedTaggedValue {
    switch (literal) {
        .integer, .float, .number_string, .string, .bool => {
            var converted = try turnout_value.fromJson(allocator, literal);
            errdefer turnout_value.deinitValue(&converted, allocator);
            return .{ .value = converted, .tags = try allocator.alloc([]const u8, 0) };
        },
        .array => |array| {
            if (array.items.len == 0) return error.EmptyLiteralArray;
            const element = switch (array.items[0]) {
                .integer, .float, .number_string => turnout_value.ArrayElement.number,
                .string => turnout_value.ArrayElement.string,
                .bool => turnout_value.ArrayElement.boolean,
                else => return emptyArray(allocator),
            };
            var converted = try turnout_value.fromJson(allocator, literal);
            errdefer turnout_value.deinitValue(&converted, allocator);
            converted.array.element = element;
            for (converted.array.items) |item| {
                const matches = switch (element) {
                    .number => item.value == .number,
                    .string => item.value == .string,
                    .boolean => item.value == .boolean,
                    else => unreachable,
                };
                if (!matches) return error.InvalidLiteral;
            }
            return .{ .value = converted, .tags = try allocator.alloc([]const u8, 0) };
        },
        else => return turnout_value.buildNull(.unknown, &.{}, allocator),
    }
}

fn emptyArray(allocator: std.mem.Allocator) !turnout_value.OwnedTaggedValue {
    const items = try allocator.alloc(turnout_value.TaggedValue, 0);
    errdefer allocator.free(items);
    return .{
        .value = .{ .array = .{ .items = items } },
        .tags = try allocator.alloc([]const u8, 0),
    };
}

fn deinitPrepared(
    prepared: *std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue),
    allocator: std.mem.Allocator,
) void {
    for (prepared.values()) |*item| turnout_value.deinitTaggedValue(item, allocator);
    prepared.deinit(allocator);
}

fn nextTargetAction(rule: std.json.Value) []const u8 {
    if (rule != .object) return "";
    const action = rule.object.get("action") orelse return "";
    return if (action == .string) action.string else "";
}

fn nextConditionName(rule: std.json.Value) []const u8 {
    if (rule != .object) return "";
    const rule_compute = rule.object.get("compute") orelse return "";
    if (rule_compute != .object) return "";
    const condition = rule_compute.object.get("condition") orelse return "";
    return if (condition == .string) condition.string else "";
}

/// Validate the JSON-first runtime projection. Unknown runtime fields are
/// ignored for forward compatibility; known compiler-only fields are rejected.
pub fn validateJson(allocator: std.mem.Allocator, bytes: []const u8, limits: Limits) ValidationError!void {
    if (bytes.len > limits.max_model_bytes) return error.ModelTooLarge;
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, bytes, .{
        .max_value_len = limits.max_model_bytes,
    }) catch return error.InvalidJson;
    defer parsed.deinit();
    if (parsed.value != .object) return error.RootMustBeObject;
    try validateNesting(parsed.value, 0, limits.max_nesting);
    const root = parsed.value.object;
    try rejectCompilerMetadata(root);
    try validateComputes(root, allocator);
    const version = try uintField(root, "version");
    if (version != current_version) return error.UnsupportedVersion;
    const min = try optionalUintField(root, "minVersion");
    const max = try optionalUintField(root, "maxVersion");
    if (min > current_version) return error.RuntimeTooOld;
    if (max != 0 and max < current_version) return error.RuntimeTooNew;
}

fn validateComputes(root: std.json.ObjectMap, allocator: std.mem.Allocator) ValidationError!void {
    const scenes = root.get("scenes") orelse return;
    if (scenes != .array) return;
    for (scenes.array.items) |scene_value| {
        if (scene_value != .object) continue;
        const actions = scene_value.object.get("actions") orelse continue;
        if (actions != .array) continue;
        for (actions.array.items) |action_value| {
            if (action_value != .object) continue;
            const action = action_value.object;
            if (action.get("compute")) |action_compute| try validateModelCompute(action_compute, "root", allocator);
            const next_rules = action.get("next") orelse continue;
            if (next_rules != .array) continue;
            for (next_rules.array.items) |rule| {
                if (rule != .object) continue;
                if (rule.object.get("compute")) |next_compute| try validateModelCompute(next_compute, "condition", allocator);
            }
        }
    }
}

fn validateModelCompute(model_compute: std.json.Value, output_field: []const u8, allocator: std.mem.Allocator) ValidationError!void {
    if (model_compute != .object) return error.InvalidCompute;
    const prog = model_compute.object.get("prog") orelse return;
    const output = model_compute.object.get(output_field) orelse std.json.Value{ .string = "" };
    if (output != .string) return error.InvalidCompute;
    compute_runtime.validateProgram(prog, output.string, allocator) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.InvalidCompute,
    };
}

fn validateNesting(value: std.json.Value, depth: usize, maximum: usize) ValidationError!void {
    if (depth > maximum) return error.ModelTooDeep;
    switch (value) {
        .object => |object| {
            var iterator = object.iterator();
            while (iterator.next()) |entry| try validateNesting(entry.value_ptr.*, depth + 1, maximum);
        },
        .array => |array| for (array.items) |item| try validateNesting(item, depth + 1, maximum),
        else => {},
    }
}

fn rejectCompilerMetadata(root: std.json.ObjectMap) ValidationError!void {
    if (root.contains("annotations")) return error.CompilerMetadata;
    if (root.get("typeDecls")) |decls| {
        if (decls == .array) for (decls.array.items) |decl| {
            if (decl == .object and decl.object.contains("sourcePos")) return error.CompilerMetadata;
        };
    }
    const scenes = root.get("scenes") orelse return;
    if (scenes != .array) return;
    for (scenes.array.items) |scene_value| {
        if (scene_value != .object) continue;
        const scene = scene_value.object;
        if (scene.get("view")) |view| {
            if (view == .object and
                (view.object.contains("nodes") or
                    view.object.contains("edges") or
                    view.object.contains("sourcePos")))
                return error.CompilerMetadata;
        }
        const actions = scene.get("actions") orelse continue;
        if (actions != .array) continue;
        for (actions.array.items) |action_value| {
            if (action_value != .object) continue;
            const action = action_value.object;
            if (action.get("compute")) |compute| try rejectComputeMetadata(compute);
            const next_rules = action.get("next") orelse continue;
            if (next_rules != .array) continue;
            for (next_rules.array.items) |next_rule| {
                if (next_rule != .object) continue;
                if (next_rule.object.get("compute")) |compute| try rejectComputeMetadata(compute);
            }
        }
    }
}

fn rejectComputeMetadata(compute: std.json.Value) ValidationError!void {
    if (compute != .object) return;
    const prog = compute.object.get("prog") orelse return;
    if (prog != .object) return;
    if (prog.object.contains("sigils")) return error.CompilerMetadata;
    const bindings = prog.object.get("bindings") orelse return;
    if (bindings != .array) return;
    for (bindings.array.items) |binding| {
        if (binding == .object and
            (binding.object.contains("extExpr") or
                binding.object.contains("sourcePos") or
                binding.object.contains("declaredType")))
            return error.CompilerMetadata;
    }
}

fn uintField(root: std.json.ObjectMap, name: []const u8) ValidationError!u32 {
    const value = root.get(name) orelse return error.UnsupportedVersion;
    if (value != .integer or value.integer < 0 or value.integer > std.math.maxInt(u32))
        return error.UnsupportedVersion;
    return @intCast(value.integer);
}

fn optionalUintField(root: std.json.ObjectMap, name: []const u8) ValidationError!u32 {
    const value = root.get(name) orelse return 0;
    if (value != .integer or value.integer < 0 or value.integer > std.math.maxInt(u32))
        return error.UnsupportedVersion;
    return @intCast(value.integer);
}

test "runtime projection accepts converter version and unknown fields" {
    try validateJson(std.testing.allocator, "{\"version\":2,\"minVersion\":2,\"maxVersion\":2,\"future\":true}", .{});
}

test "runtime projection enforces version range and metadata boundary" {
    try std.testing.expectError(error.RuntimeTooOld, validateJson(std.testing.allocator, "{\"version\":2,\"minVersion\":3}", .{}));
    try std.testing.expectError(error.RuntimeTooNew, validateJson(std.testing.allocator, "{\"version\":2,\"maxVersion\":1}", .{}));
    try std.testing.expectError(error.CompilerMetadata, validateJson(std.testing.allocator, "{\"version\":2,\"annotations\":{}}", .{}));
}

test "runtime projection rejects nested compiler metadata" {
    try std.testing.expectError(
        error.CompilerMetadata,
        validateJson(
            std.testing.allocator,
            "{\"version\":2,\"scenes\":[{\"actions\":[{\"compute\":{\"prog\":{\"sigils\":{}}}}]}]}",
            .{},
        ),
    );
    try std.testing.expectError(
        error.CompilerMetadata,
        validateJson(
            std.testing.allocator,
            "{\"version\":2,\"scenes\":[{\"view\":{\"nodes\":[]}}]}",
            .{},
        ),
    );
}

test "runtime projection permits metadata-like user record keys" {
    try validateJson(
        std.testing.allocator,
        "{\"version\":2,\"state\":{\"namespaces\":[{\"name\":\"x\",\"fields\":[{\"name\":\"r\",\"type\":\"rec<str, str>\",\"value\":{\"nodes\":\"user data\",\"sourcePos\":\"also data\"}}]}]}}",
        .{},
    );
}

test "decoded runtime model retains representative full-schema JSON" {
    const fixture =
        \\{
        \\  "version": 2,
        \\  "minVersion": 2,
        \\  "maxVersion": 2,
        \\  "state": {
        \\    "namespaces": [{
        \\      "name": "app",
        \\      "fields": [{
        \\        "name": "payload",
        \\        "type": "rec<str, arr<number>>",
        \\        "value": {"scores": [1, 2.5], "missing": null}
        \\      }]
        \\    }]
        \\  },
        \\  "scenes": [{
        \\    "id": "main",
        \\    "entryAction": "start",
        \\    "actions": [{
        \\      "id": "start",
        \\      "compute": {
        \\        "root": "result",
        \\        "prog": {
        \\          "name": "run",
        \\          "bindings": [
        \\            {"name": "input", "type": "number", "value": 1},
        \\            {"name": "result", "type": "number", "expr": {
        \\              "combine": {"fn": "add", "args": [{"ref": "input"}, {"lit": 2}]}
        \\            }}
        \\          ]
        \\        }
        \\      },
        \\      "prepare": [{"binding": "input", "fromState": "app.count"}],
        \\      "merge": [{"binding": "result", "toState": "app.count"}],
        \\      "publish": ["saved"],
        \\      "next": []
        \\    }]
        \\  }],
        \\  "routes": [{"id": "route", "entrySceneId": "main", "match": [{"patterns": ["_"], "target": "main"}]}]
        \\}
    ;
    var model = try RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    try std.testing.expectEqual(@as(i64, 2), model.root().get("version").?.integer);
    try std.testing.expectEqual(@as(usize, 1), model.root().get("scenes").?.array.items.len);
}

test "action effect schedule follows model declaration order" {
    const effect_runtime = @import("runner.zig");
    const source =
        \\{"version":2,"scenes":[{"id":"main","entryAction":"start","actions":[{
        \\"id":"start","prepare":[
        \\{"binding":"state","fromState":"app.value"},
        \\{"binding":"first","fromHook":"load_first"},
        \\{"binding":"second","fromHook":"load_second"},
        \\{"binding":"first_again","fromHook":"load_first"}
        \\],"publish":["save_first","save_second"]
        \\}]}]}
    ;
    var model = try RuntimeModel.init(std.testing.allocator, source, .{});
    defer model.deinit();
    var schedule = try model.actionEffectSchedule("main", "start", std.testing.allocator);
    defer schedule.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 4), schedule.specs.len);
    try std.testing.expectEqual(effect.Kind.prepare, schedule.specs[0].kind);
    try std.testing.expectEqualStrings("load_first", schedule.specs[0].hook);
    try std.testing.expectEqual(@as(usize, 1), schedule.specs[0].callback_index);
    try std.testing.expect(schedule.specs[0].binding == null);
    try std.testing.expectEqualStrings("load_second", schedule.specs[1].hook);
    try std.testing.expectEqualStrings("second", schedule.specs[1].binding.?);
    try std.testing.expectEqual(effect.Kind.publish, schedule.specs[2].kind);
    try std.testing.expectEqualStrings("save_first", schedule.specs[2].hook);
    try std.testing.expectEqual(@as(usize, 0), schedule.specs[2].callback_index);
    try std.testing.expectEqualStrings("save_second", schedule.specs[3].hook);

    var runtime = effect_runtime.Runtime.init(std.testing.allocator, schedule.specs);
    defer runtime.deinit();
    const first = (try runtime.step()).need_effect;
    try std.testing.expectEqualStrings("load_first", first.hook);
    try runtime.@"resume"(first.id, .{ .prepare = .{ .ok = "1" } });
    const second = (try runtime.step()).need_effect;
    try std.testing.expectEqualStrings("load_second", second.hook);
}

test "action effect schedule caches repeated prepare hooks" {
    const source =
        \\{"version":2,"scenes":[{"id":"main","entryAction":"start","actions":[{
        \\"id":"start","prepare":[
        \\{"binding":"first","fromHook":"load"},
        \\{"binding":"second","fromHook":"load"}
        \\],"publish":[] }]}]}
    ;
    var model = try RuntimeModel.init(std.testing.allocator, source, .{});
    defer model.deinit();
    var schedule = try model.actionEffectSchedule("main", "start", std.testing.allocator);
    defer schedule.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 1), schedule.specs.len);
    try std.testing.expectEqualStrings("load", schedule.specs[0].hook);
    try std.testing.expectEqual(@as(usize, 0), schedule.specs[0].callback_index);
}

test "model executes action and selects first matching prepared next rule" {
    const fixture =
        \\{
        \\  "version":2,
        \\  "scenes":[{"id":"main","actions":[{
        \\    "id":"source",
        \\    "compute":{"root":"result","prog":{"bindings":[
        \\      {"name":"input","type":"number"},
        \\      {"name":"result","type":"number","expr":{
        \\        "combine":{"fn":"add","args":[{"ref":"input"},{"lit":2}]}
        \\      }}
        \\    ]}},
        \\    "prepare":[{"binding":"input","fromState":"counter.value"}],
        \\    "merge":[{"binding":"result","toState":"counter.value"}],
        \\    "next":[
        \\      {
        \\        "action":"skipped",
        \\        "prepare":[{"binding":"flag","fromLiteral":false}],
        \\        "compute":{"condition":"flag","prog":{"bindings":[
        \\          {"name":"flag","type":"bool"}
        \\        ]}}
        \\      },
        \\      {
        \\        "action":"target",
        \\        "prepare":[
        \\          {"binding":"left","fromState":"counter.value"},
        \\          {"binding":"right","fromAction":"result"}
        \\        ],
        \\        "compute":{"condition":"matches","prog":{"bindings":[
        \\          {"name":"left","type":"number"},
        \\          {"name":"right","type":"number"},
        \\          {"name":"matches","type":"bool","expr":{
        \\            "combine":{"fn":"eq","args":[{"ref":"left"},{"ref":"right"}]}
        \\          }}
        \\        ]}}
        \\      }
        \\    ]
        \\  }]}]
        \\}
    ;
    var model = try RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    var initial: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    defer initial.deinit(std.testing.allocator);
    try initial.put(std.testing.allocator, "counter.value", .{ .value = .{ .number = 3 } });
    var state = try state_runtime.State.initUnchecked(&initial, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var action_result = try model.executeAction("main", "source", &state, std.testing.allocator);
    defer action_result.deinit(std.testing.allocator);
    var selection = try model.selectNextAfterAction(
        "main",
        "source",
        &action_result,
        std.testing.allocator,
    );
    defer selection.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings("target", selection.target.?);
    try std.testing.expectEqual(@as(usize, 0), selection.warnings.len);
}

test "next preparation rejects absent action binding" {
    const fixture =
        \\{"version":2,"scenes":[{"id":"main","actions":[{
        \\  "id":"source",
        \\  "compute":{"root":"result","prog":{"bindings":[
        \\    {"name":"result","type":"number","value":1}
        \\  ]}},
        \\  "next":[{
        \\    "action":"target",
        \\    "prepare":[{"binding":"input","fromAction":"absent"}],
        \\    "compute":{"condition":"input","prog":{"bindings":[
        \\      {"name":"input","type":"bool"}
        \\    ]}}
        \\  }]
        \\}]}]}
    ;
    var model = try RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var action_result = try model.executeAction("main", "source", &state, std.testing.allocator);
    defer action_result.deinit(std.testing.allocator);
    try std.testing.expectError(
        error.MissingActionBinding,
        model.selectNextAfterAction("main", "source", &action_result, std.testing.allocator),
    );
}

test "runtime projection enforces nesting limit" {
    try std.testing.expectError(
        error.ModelTooDeep,
        validateJson(std.testing.allocator, "{\"version\":2,\"a\":{\"b\":{\"c\":true}}}", .{ .max_nesting = 2 }),
    );
}

test "JSON-first decoding covers absent optional and reserved field names" {
    const fixture =
        \\{
        \\  "version": 2,
        \\  "scenes": [{
        \\    "id": "main",
        \\    "entryAction": "done",
        \\    "nextPolicy": "reserved-unknown-field",
        \\    "actions": [{"id": "done", "publish": [], "next": []}]
        \\  }],
        \\  "routes": [{"id": "route", "match": []}]
        \\}
    ;
    var model = try RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    const scene = model.root().get("scenes").?.array.items[0].object;
    try std.testing.expect(scene.get("view") == null);
    try std.testing.expectEqualStrings("reserved-unknown-field", scene.get("nextPolicy").?.string);
    const route = model.root().get("routes").?.array.items[0].object;
    try std.testing.expect(route.get("entrySceneId") == null);
}

test "runtime model validates action and next-rule compute programs" {
    try std.testing.expectError(
        error.InvalidCompute,
        validateJson(
            std.testing.allocator,
            "{\"version\":2,\"scenes\":[{\"actions\":[{\"compute\":{\"root\":\"missing\",\"prog\":{\"bindings\":[{\"name\":\"value\",\"type\":\"number\",\"value\":1}]}}}]}]}",
            .{},
        ),
    );
    try std.testing.expectError(
        error.InvalidCompute,
        validateJson(
            std.testing.allocator,
            "{\"version\":2,\"scenes\":[{\"actions\":[{\"next\":[{\"compute\":{\"condition\":\"missing\",\"prog\":{\"bindings\":[]}}}]}]}]}",
            .{},
        ),
    );
    try validateJson(
        std.testing.allocator,
        "{\"version\":2,\"scenes\":[{\"actions\":[{\"compute\":{},\"next\":[{\"compute\":{}}]}]}]}",
        .{},
    );
}

test "runtime model executes action compute and handles absent compute" {
    const fixture =
        \\{"version":2,"scenes":[{"id":"scene","actions":[
        \\  {"id":"computed","compute":{"root":"result","prog":{"bindings":[
        \\    {"name":"input","type":"number"},
        \\    {"name":"result","type":"number","expr":{"combine":{"fn":"add","args":[{"ref":"input"},{"lit":1}]}}}
        \\  ]}}},
        \\  {"id":"noop"}
        \\]}]}
    ;
    var model = try RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    var inputs: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    defer inputs.deinit(std.testing.allocator);
    try inputs.put(std.testing.allocator, "input", .{ .value = .{ .number = 4 }, .tags = &.{"prepared"} });
    var computed = try model.executeActionCompute("scene", "computed", &inputs, std.testing.allocator);
    defer computed.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(f64, 5), computed.value.number);
    try std.testing.expectEqualSlices([]const u8, &.{"prepared"}, computed.tags);
    var noop = try model.executeActionCompute("scene", "noop", &inputs, std.testing.allocator);
    defer noop.deinit(std.testing.allocator);
    try std.testing.expectEqual(turnout_value.NullReason.missing, noop.value.null_value);
    try std.testing.expectError(error.ActionNotFound, model.executeActionCompute("scene", "missing", &inputs, std.testing.allocator));
}

test "runtime model evaluates unconditional and computed next rules" {
    const fixture =
        \\{"version":2,"scenes":[{"id":"scene","actions":[{"id":"action","next":[
        \\  {"action":"a"},
        \\  {"action":"b","compute":{}},
        \\  {"action":"c","compute":{"condition":"condition","prog":{"bindings":[{"name":"condition","type":"bool"}]}}}
        \\]}]}]}
    ;
    var model = try RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    var inputs: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    defer inputs.deinit(std.testing.allocator);
    try inputs.put(std.testing.allocator, "condition", .{ .value = .{ .boolean = true } });
    try std.testing.expectEqual(NextRuleCondition{ .matched = true }, try model.evaluateNextRule("scene", "action", 0, &inputs, std.testing.allocator));
    try std.testing.expectEqual(NextRuleCondition.missing_program, try model.evaluateNextRule("scene", "action", 1, &inputs, std.testing.allocator));
    try std.testing.expectEqual(NextRuleCondition{ .matched = true }, try model.evaluateNextRule("scene", "action", 2, &inputs, std.testing.allocator));

    try inputs.put(std.testing.allocator, "condition", .{ .value = .{ .boolean = true }, .tags = &.{"impure"} });
    const invalid = try model.evaluateNextRule("scene", "action", 2, &inputs, std.testing.allocator);
    try std.testing.expectEqualStrings("boolean", invalid.invalid_type);
}

test "runtime model selects the first matching next rule and retains warnings" {
    const fixture =
        \\{"version":2,"scenes":[{"id":"scene","actions":[{"id":"action","next":[
        \\  {"action":"invalid","compute":{"condition":"c","prog":{"bindings":[{"name":"c","type":"number","value":1}]}}},
        \\  {"action":"false","compute":{"condition":"c","prog":{"bindings":[{"name":"c","type":"bool","value":false}]}}},
        \\  {"action":"selected","compute":{"condition":"c","prog":{"bindings":[{"name":"c","type":"bool","value":true}]}}},
        \\  {"action":"unreached"}
        \\]}]}]}
    ;
    var model = try RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    var selection = try model.selectNextRule("scene", "action", &.{}, std.testing.allocator);
    defer selection.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings("selected", selection.target.?);
    try std.testing.expectEqual(@as(usize, 1), selection.warnings.len);
    try std.testing.expectEqual(NextRuleWarningKind.invalid_condition, selection.warnings[0].kind);
    try std.testing.expectEqual(@as(usize, 0), selection.warnings[0].rule_index);
    try std.testing.expectEqualStrings("c", selection.warnings[0].condition_name);
}
