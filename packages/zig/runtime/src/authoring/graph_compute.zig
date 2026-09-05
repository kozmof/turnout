//! Execution for the TypeScript builder API's graph contexts.
//!
//! The authoring counterpart to `program/eval.zig`. Its own tests call it the
//! legacy compute engine, which is accurate: it interprets a graph context
//! directly, the way the runtime used to interpret a model.

const std = @import("std");
const preset = @import("../preset.zig");
const value = @import("../value.zig");

pub const max_graph_nodes: usize = 50_000;

pub const Result = struct {
    values: std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue),
    root: value.OwnedTaggedValue,

    pub fn deinit(self: *Result, allocator: std.mem.Allocator) void {
        for (self.values.values()) |*item| item.deinit(allocator);
        self.values.deinit(allocator);
        self.root.deinit(allocator);
        self.* = undefined;
    }
};

const Executor = struct {
    context: std.json.Value,
    allocator: std.mem.Allocator,
    values: std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue) = .empty,
    visiting: std.StringHashMapUnmanaged(void) = .empty,
    evaluated: std.StringHashMapUnmanaged(void) = .empty,
    count: usize = 0,

    fn deinit(self: *Executor) void {
        self.visiting.deinit(self.allocator);
        self.evaluated.deinit(self.allocator);
    }

    fn table(self: *const Executor, name: []const u8) !std.json.ObjectMap {
        const raw = self.context.object.get(name) orelse return error.MissingTable;
        if (raw != .object) return error.InvalidTable;
        return raw.object;
    }

    fn loadValues(self: *Executor) !void {
        const entries = try self.table("valueTable");
        var iterator = entries.iterator();
        while (iterator.next()) |entry| {
            var decoded = try value.fromCanonicalValue(entry.value_ptr.*, self.allocator);
            errdefer decoded.deinit(self.allocator);
            try self.values.put(self.allocator, entry.key_ptr.*, decoded);
        }
    }

    fn resolveValue(self: *Executor, id: []const u8) anyerror!value.TaggedValue {
        if (self.values.get(id)) |found| return found.borrowed();
        const functions = try self.table("funcTable");
        var iterator = functions.iterator();
        while (iterator.next()) |entry| {
            if (entry.value_ptr.* != .object) continue;
            const return_id = entry.value_ptr.object.get("returnId") orelse continue;
            if (return_id == .string and std.mem.eql(u8, return_id.string, id)) {
                try self.evalFunction(entry.key_ptr.*);
                return (self.values.get(id) orelse return error.MissingValue).borrowed();
            }
        }
        return error.MissingValue;
    }

    fn evalFunction(self: *Executor, id: []const u8) anyerror!void {
        if (self.evaluated.contains(id)) return;
        if (self.visiting.contains(id)) return error.GraphCycle;
        if (self.count >= max_graph_nodes) return error.GraphTooLarge;
        self.count += 1;
        try self.visiting.put(self.allocator, id, {});
        defer _ = self.visiting.remove(id);

        const entry = (try self.table("funcTable")).get(id) orelse return error.MissingFunction;
        if (entry != .object) return error.InvalidFunction;
        const kind = entry.object.get("kind") orelse return error.InvalidFunction;
        const def_id = entry.object.get("defId") orelse return error.InvalidFunction;
        const return_id = entry.object.get("returnId") orelse return error.InvalidFunction;
        if (kind != .string or def_id != .string or return_id != .string) return error.InvalidFunction;

        var output = if (std.mem.eql(u8, kind.string, "combine"))
            try self.evalCombine(entry, def_id.string)
        else if (std.mem.eql(u8, kind.string, "pipe"))
            try self.evalPipe(entry, def_id.string)
        else if (std.mem.eql(u8, kind.string, "cond"))
            try self.evalConditional(def_id.string)
        else
            return error.UnsupportedLegacyFunction;
        errdefer output.deinit(self.allocator);
        try self.values.put(self.allocator, return_id.string, output);
        try self.evaluated.put(self.allocator, id, {});
    }

    fn evalCombine(self: *Executor, entry: std.json.Value, def_id: []const u8) anyerror!value.OwnedTaggedValue {
        const definition = (try self.table("combineFuncDefTable")).get(def_id) orelse return error.MissingDefinition;
        if (definition != .object) return error.InvalidDefinition;
        const name = definition.object.get("name") orelse return error.InvalidDefinition;
        const transforms = definition.object.get("transformFn") orelse return error.InvalidDefinition;
        const arg_map = entry.object.get("argMap") orelse return error.InvalidFunction;
        if (name != .string or transforms != .object or arg_map != .object) return error.InvalidDefinition;

        var owned: [3]?value.OwnedTaggedValue = .{ null, null, null };
        defer for (&owned) |*item| if (item.*) |*present| present.deinit(self.allocator);
        var args: [3]value.TaggedValue = undefined;
        const arity = preset.arity(name.string);
        const names = [_][]const u8{ "a", "b", "c" };
        for (0..arity) |index| {
            const raw_id = arg_map.object.get(names[index]) orelse return error.MissingArgument;
            if (raw_id != .string) return error.InvalidArgument;
            const source = try self.resolveValue(raw_id.string);
            const chain = transforms.object.get(names[index]);
            owned[index] = try applyTransforms(source, chain, self.allocator);
            args[index] = owned[index].?.borrowed();
        }
        return preset.call(name.string, args[0..arity], self.allocator);
    }

    fn evalPipe(self: *Executor, entry: std.json.Value, def_id: []const u8) anyerror!value.OwnedTaggedValue {
        const definition = (try self.table("pipeFuncDefTable")).get(def_id) orelse return error.MissingDefinition;
        if (definition != .object) return error.InvalidDefinition;
        const names = definition.object.get("args") orelse return error.InvalidDefinition;
        const arg_map = entry.object.get("argMap") orelse return error.InvalidFunction;
        if (names != .array or arg_map != .object) return error.InvalidDefinition;
        var inputs: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
        defer inputs.deinit(self.allocator);
        for (names.array.items) |name| {
            if (name != .string) return error.InvalidDefinition;
            const raw_id = arg_map.object.get(name.string) orelse return error.MissingArgument;
            if (raw_id != .string) return error.InvalidArgument;
            try inputs.put(self.allocator, name.string, try self.resolveValue(raw_id.string));
        }
        return self.evalPipeDefinition(def_id, &inputs);
    }

    fn evalPipeDefinition(
        self: *Executor,
        def_id: []const u8,
        inputs: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
    ) anyerror!value.OwnedTaggedValue {
        if (self.visiting.contains(def_id)) return error.GraphCycle;
        try self.visiting.put(self.allocator, def_id, {});
        defer _ = self.visiting.remove(def_id);
        const definition = (try self.table("pipeFuncDefTable")).get(def_id) orelse return error.MissingDefinition;
        if (definition != .object) return error.InvalidDefinition;
        const sequence = definition.object.get("sequence") orelse return error.InvalidDefinition;
        if (sequence != .array) return error.InvalidDefinition;
        if (sequence.array.items.len == 0) return error.EmptyPipe;
        var results = std.ArrayList(value.OwnedTaggedValue).empty;
        defer {
            for (results.items) |*item| item.deinit(self.allocator);
            results.deinit(self.allocator);
        }
        for (sequence.array.items) |step| {
            if (self.count >= max_graph_nodes) return error.GraphTooLarge;
            self.count += 1;
            if (step != .object) return error.InvalidDefinition;
            const step_def_id = step.object.get("defId") orelse return error.InvalidDefinition;
            const bindings = step.object.get("argBindings") orelse return error.InvalidDefinition;
            if (step_def_id != .string or bindings != .object) return error.InvalidDefinition;
            var output = if ((try self.table("combineFuncDefTable")).get(step_def_id.string)) |combine|
                try self.evalPipeCombine(combine, bindings, inputs, results.items)
            else if ((try self.table("pipeFuncDefTable")).get(step_def_id.string)) |nested| blk: {
                if (nested != .object) return error.InvalidDefinition;
                const nested_names = nested.object.get("args") orelse return error.InvalidDefinition;
                if (nested_names != .array) return error.InvalidDefinition;
                var nested_inputs: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
                defer nested_inputs.deinit(self.allocator);
                for (nested_names.array.items) |name| {
                    if (name != .string) return error.InvalidDefinition;
                    const binding = bindings.object.get(name.string) orelse return error.MissingArgument;
                    try nested_inputs.put(self.allocator, name.string, try self.resolvePipeBinding(binding, inputs, results.items));
                }
                break :blk try self.evalPipeDefinition(step_def_id.string, &nested_inputs);
            } else return error.MissingDefinition;
            errdefer output.deinit(self.allocator);
            try results.append(self.allocator, output);
        }
        const final = results.items[results.items.len - 1].borrowed();
        return value.build(final.value, final.tags, self.allocator);
    }

    fn evalPipeCombine(
        self: *Executor,
        definition: std.json.Value,
        bindings: std.json.Value,
        inputs: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
        results: []const value.OwnedTaggedValue,
    ) anyerror!value.OwnedTaggedValue {
        if (definition != .object) return error.InvalidDefinition;
        const name = definition.object.get("name") orelse return error.InvalidDefinition;
        const transforms = definition.object.get("transformFn") orelse return error.InvalidDefinition;
        if (name != .string or transforms != .object) return error.InvalidDefinition;
        var owned: [3]?value.OwnedTaggedValue = .{ null, null, null };
        defer for (&owned) |*item| if (item.*) |*present| present.deinit(self.allocator);
        var args: [3]value.TaggedValue = undefined;
        const arity = preset.arity(name.string);
        const names = [_][]const u8{ "a", "b", "c" };
        for (0..arity) |index| {
            const binding = bindings.object.get(names[index]) orelse return error.MissingArgument;
            const source = try self.resolvePipeBinding(binding, inputs, results);
            owned[index] = try applyTransforms(source, transforms.object.get(names[index]), self.allocator);
            args[index] = owned[index].?.borrowed();
        }
        return preset.call(name.string, args[0..arity], self.allocator);
    }

    fn resolvePipeBinding(
        self: *Executor,
        binding: std.json.Value,
        inputs: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
        results: []const value.OwnedTaggedValue,
    ) anyerror!value.TaggedValue {
        if (binding != .object) return error.InvalidArgument;
        const source = binding.object.get("source") orelse return error.InvalidArgument;
        if (source != .string) return error.InvalidArgument;
        if (std.mem.eql(u8, source.string, "input")) {
            const name = binding.object.get("argName") orelse return error.InvalidArgument;
            if (name != .string) return error.InvalidArgument;
            return inputs.get(name.string) orelse error.MissingArgument;
        }
        if (std.mem.eql(u8, source.string, "step")) {
            const index = binding.object.get("stepIndex") orelse return error.InvalidArgument;
            if (index != .integer or index.integer < 0) return error.InvalidStepReference;
            const cast: usize = @intCast(index.integer);
            if (cast >= results.len) return error.InvalidStepReference;
            return results[cast].borrowed();
        }
        if (std.mem.eql(u8, source.string, "value")) {
            const id = binding.object.get("id") orelse return error.InvalidArgument;
            if (id != .string) return error.InvalidArgument;
            return self.resolveValue(id.string);
        }
        return error.InvalidArgument;
    }

    fn evalConditional(self: *Executor, def_id: []const u8) anyerror!value.OwnedTaggedValue {
        const definition = (try self.table("condFuncDefTable")).get(def_id) orelse return error.MissingDefinition;
        if (definition != .object) return error.InvalidDefinition;
        const condition_id = definition.object.get("conditionId") orelse return error.InvalidDefinition;
        const true_id = definition.object.get("trueBranchId") orelse return error.InvalidDefinition;
        const false_id = definition.object.get("falseBranchId") orelse return error.InvalidDefinition;
        if (condition_id != .object or true_id != .string or false_id != .string) return error.InvalidDefinition;
        const condition_kind = condition_id.object.get("kind") orelse return error.InvalidDefinition;
        const condition_ref = condition_id.object.get("id") orelse return error.InvalidDefinition;
        if (condition_kind != .string or condition_ref != .string) return error.InvalidDefinition;
        const condition = if (std.mem.eql(u8, condition_kind.string, "func")) blk: {
            try self.evalFunction(condition_ref.string);
            const func = (try self.table("funcTable")).get(condition_ref.string).?;
            break :blk try self.resolveValue(func.object.get("returnId").?.string);
        } else try self.resolveValue(condition_ref.string);
        if (condition.value != .boolean) return error.ConditionTypeMismatch;
        const selected_id = if (condition.value.boolean) true_id.string else false_id.string;
        try self.evalFunction(selected_id);
        const selected = (try self.table("funcTable")).get(selected_id) orelse return error.MissingFunction;
        return value.build((try self.resolveValue(selected.object.get("returnId").?.string)).value, (try self.resolveValue(selected.object.get("returnId").?.string)).tags, self.allocator);
    }
};

fn applyTransforms(source: value.TaggedValue, raw: ?std.json.Value, allocator: std.mem.Allocator) !value.OwnedTaggedValue {
    var current = try value.build(source.value, source.tags, allocator);
    errdefer current.deinit(allocator);
    const chain = raw orelse return current;
    if (chain != .array) return error.InvalidTransform;
    for (chain.array.items) |item| {
        if (item != .string) return error.InvalidTransform;
        const next = try preset.call(item.string, &.{current.borrowed()}, allocator);
        current.deinit(allocator);
        current = next;
    }
    return current;
}

pub fn execute(context: std.json.Value, root_id: []const u8, allocator: std.mem.Allocator) !Result {
    if (context != .object) return error.InvalidContext;
    var executor: Executor = .{ .context = context, .allocator = allocator };
    defer executor.deinit();
    errdefer {
        for (executor.values.values()) |*item| item.deinit(allocator);
        executor.values.deinit(allocator);
    }
    try executor.loadValues();
    try executor.evalFunction(root_id);
    const entry = (try executor.table("funcTable")).get(root_id) orelse return error.MissingFunction;
    const return_id = entry.object.get("returnId") orelse return error.InvalidFunction;
    const root = try executor.resolveValue(return_id.string);
    return .{ .values = executor.values, .root = try value.build(root.value, root.tags, allocator) };
}

test "legacy compute executes combine and selected conditional branch" {
    const fixture =
        \\{"valueTable":{"a":{"symbol":"number","value":2,"tags":[]},"b":{"symbol":"number","value":3,"tags":[]},"yes":{"symbol":"boolean","value":true,"tags":[]}},
        \\ "funcTable":{"sum":{"kind":"combine","defId":"add","argMap":{"a":"a","b":"b"},"returnId":"total"},"choice":{"kind":"cond","defId":"if","returnId":"result"}},
        \\ "combineFuncDefTable":{"add":{"name":"combineFnNumber::add","transformFn":{"a":["transformFnNumber::pass"],"b":["transformFnNumber::pass"]}}},"pipeFuncDefTable":{},
        \\ "condFuncDefTable":{"if":{"conditionId":{"kind":"value","id":"yes"},"trueBranchId":"sum","falseBranchId":"missing"}}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, fixture, .{});
    defer parsed.deinit();
    var result = try execute(parsed.value, "choice", std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(f64, 5), result.root.value.number);
}

test "legacy compute executes nested pipes and direct value bindings" {
    const fixture =
        \\{"valueTable":{"a":{"symbol":"number","value":2,"tags":[]},"b":{"symbol":"number","value":3,"tags":[]}},
        \\ "funcTable":{"run":{"kind":"pipe","defId":"outer","argMap":{"x":"a","y":"b"},"returnId":"result"}},
        \\ "combineFuncDefTable":{"add":{"name":"combineFnNumber::add","transformFn":{"a":["transformFnNumber::pass"],"b":["transformFnNumber::pass"]}}},
        \\ "pipeFuncDefTable":{"inner":{"args":["x","y"],"sequence":[{"defId":"add","argBindings":{"a":{"source":"input","argName":"x"},"b":{"source":"input","argName":"y"}}}]},
        \\ "outer":{"args":["x","y"],"sequence":[{"defId":"inner","argBindings":{"x":{"source":"input","argName":"x"},"y":{"source":"input","argName":"y"}}},{"defId":"add","argBindings":{"a":{"source":"step","stepIndex":0},"b":{"source":"value","id":"b"}}}]}},"condFuncDefTable":{}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, fixture, .{});
    defer parsed.deinit();
    var result = try execute(parsed.value, "run", std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(f64, 8), result.root.value.number);
}
