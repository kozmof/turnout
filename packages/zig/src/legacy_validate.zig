const std = @import("std");
const preset = @import("preset.zig");

pub const max_graph_nodes: usize = 50_000;

const Detail = union(enum) {
    table: []const u8,
    table_type: struct { table: []const u8, actual: []const u8 },
    size: struct { total: usize, limit: usize },
    duplicate: struct { return_id: []const u8, first: []const u8, second: []const u8 },
    func: struct { func_id: []const u8 },
    func_kind: struct { func_id: []const u8, kind: ?[]const u8 },
    func_def: struct { func_id: []const u8, def_id: []const u8 },
    func_def_kind: struct { func_id: []const u8, def_id: []const u8, kind: []const u8 },
    func_arg: struct { func_id: []const u8, arg_name: []const u8 },
    func_arg_id: struct { func_id: []const u8, arg_name: []const u8, arg_id: std.json.Value },
    transform_type: struct { func_id: []const u8, arg_id: []const u8, arg_type: []const u8, transform_fn: []const u8, expected_type: []const u8 },
    combine_type: struct { func_id: []const u8, arg_id: []const u8, arg_name: []const u8, arg_type: []const u8, combine_fn: []const u8, expected_type: []const u8 },
    def: struct { def_id: []const u8 },
    def_name: struct { def_id: []const u8, name: std.json.Value },
    def_transform: struct { def_id: []const u8, transform_fn: []const u8 },
    def_combine: struct { def_id: []const u8, combine_fn: []const u8 },
    def_compat: struct { def_id: []const u8, transform_fn: []const u8, transform_return_type: []const u8, combine_fn: []const u8, expected_type: []const u8 },
    value: struct { value_id: []const u8 },
    pipe: struct { def_id: []const u8, step_index: ?usize = null, arg_name: ?[]const u8 = null },
    pipe_step_def: struct { def_id: []const u8, step_index: usize, step_def_id: []const u8 },
    condition: struct { def_id: []const u8, condition_id: []const u8, condition_type: []const u8 },
    condition_ref: struct { def_id: []const u8, condition_id: []const u8 },
    branch: struct { def_id: []const u8, key: []const u8, id: []const u8 },
    branch_key: struct { def_id: []const u8, key: []const u8 },
    cycle: []const []const u8,
};

const Issue = struct {
    message: []u8,
    detail: Detail,

    fn deinit(self: Issue, allocator: std.mem.Allocator) void {
        allocator.free(self.message);
        if (self.detail == .cycle) allocator.free(self.detail.cycle);
    }

    pub fn jsonStringify(self: Issue, writer: anytype) !void {
        try writer.beginObject();
        try writer.objectField("message");
        try writer.write(self.message);
        try writer.objectField("details");
        try writer.beginObject();
        switch (self.detail) {
            .table => |name| {
                try writer.objectField("tableName");
                try writer.write(name);
            },
            .table_type => |detail| {
                try writer.objectField("tableName");
                try writer.write(detail.table);
                try writer.objectField("actualType");
                try writer.write(detail.actual);
            },
            .size => |detail| {
                try writer.objectField("totalNodes");
                try writer.write(detail.total);
                try writer.objectField("limit");
                try writer.write(detail.limit);
            },
            .duplicate => |detail| {
                try writer.objectField("returnId");
                try writer.write(detail.return_id);
                try writer.objectField("firstOwner");
                try writer.write(detail.first);
                try writer.objectField("secondOwner");
                try writer.write(detail.second);
            },
            .func => |detail| {
                try writer.objectField("funcId");
                try writer.write(detail.func_id);
            },
            .func_kind => |detail| {
                try writer.objectField("funcId");
                try writer.write(detail.func_id);
                if (detail.kind) |kind| {
                    try writer.objectField("kind");
                    try writer.write(kind);
                }
            },
            .func_def => |detail| {
                try writer.objectField("funcId");
                try writer.write(detail.func_id);
                try writer.objectField("defId");
                try writer.write(detail.def_id);
            },
            .func_def_kind => |detail| {
                try writer.objectField("funcId");
                try writer.write(detail.func_id);
                try writer.objectField("defId");
                try writer.write(detail.def_id);
                try writer.objectField("kind");
                try writer.write(detail.kind);
            },
            .func_arg => |detail| {
                try writer.objectField("funcId");
                try writer.write(detail.func_id);
                try writer.objectField("argName");
                try writer.write(detail.arg_name);
            },
            .func_arg_id => |detail| {
                try writer.objectField("funcId");
                try writer.write(detail.func_id);
                try writer.objectField("argName");
                try writer.write(detail.arg_name);
                try writer.objectField("argId");
                try writer.write(detail.arg_id);
            },
            .transform_type => |detail| {
                try writer.objectField("funcId");
                try writer.write(detail.func_id);
                try writer.objectField("argId");
                try writer.write(detail.arg_id);
                try writer.objectField("argType");
                try writer.write(detail.arg_type);
                try writer.objectField("transformFn");
                try writer.write(detail.transform_fn);
                try writer.objectField("expectedType");
                try writer.write(detail.expected_type);
            },
            .combine_type => |detail| {
                try writer.objectField("funcId");
                try writer.write(detail.func_id);
                try writer.objectField("argId");
                try writer.write(detail.arg_id);
                try writer.objectField("argName");
                try writer.write(detail.arg_name);
                try writer.objectField("argType");
                try writer.write(detail.arg_type);
                try writer.objectField("combineFn");
                try writer.write(detail.combine_fn);
                try writer.objectField("expectedType");
                try writer.write(detail.expected_type);
            },
            .def => |detail| {
                try writer.objectField("defId");
                try writer.write(detail.def_id);
            },
            .def_name => |detail| {
                try writer.objectField("defId");
                try writer.write(detail.def_id);
                try writer.objectField("name");
                try writer.write(detail.name);
            },
            .def_transform => |detail| {
                try writer.objectField("defId");
                try writer.write(detail.def_id);
                try writer.objectField("transformFn");
                try writer.write(detail.transform_fn);
            },
            .def_combine => |detail| {
                try writer.objectField("defId");
                try writer.write(detail.def_id);
                try writer.objectField("combineFn");
                try writer.write(detail.combine_fn);
            },
            .def_compat => |detail| {
                try writer.objectField("defId");
                try writer.write(detail.def_id);
                try writer.objectField("transformFn");
                try writer.write(detail.transform_fn);
                try writer.objectField("transformReturnType");
                try writer.write(detail.transform_return_type);
                try writer.objectField("combineFn");
                try writer.write(detail.combine_fn);
                try writer.objectField("expectedType");
                try writer.write(detail.expected_type);
            },
            .value => |detail| {
                try writer.objectField("valueId");
                try writer.write(detail.value_id);
            },
            .pipe => |detail| {
                try writer.objectField("defId");
                try writer.write(detail.def_id);
                if (detail.step_index) |index| {
                    try writer.objectField("stepIndex");
                    try writer.write(index);
                }
                if (detail.arg_name) |name| {
                    try writer.objectField("argName");
                    try writer.write(name);
                }
            },
            .pipe_step_def => |detail| {
                try writer.objectField("defId");
                try writer.write(detail.def_id);
                try writer.objectField("stepIndex");
                try writer.write(detail.step_index);
                try writer.objectField("stepDefId");
                try writer.write(detail.step_def_id);
            },
            .condition => |detail| {
                try writer.objectField("defId");
                try writer.write(detail.def_id);
                try writer.objectField("conditionId");
                try writer.write(detail.condition_id);
                try writer.objectField("conditionType");
                try writer.write(detail.condition_type);
            },
            .condition_ref => |detail| {
                try writer.objectField("defId");
                try writer.write(detail.def_id);
                try writer.objectField("conditionId");
                try writer.write(detail.condition_id);
            },
            .branch => |detail| {
                try writer.objectField("defId");
                try writer.write(detail.def_id);
                try writer.objectField(detail.key);
                try writer.write(detail.id);
            },
            .branch_key => |detail| {
                try writer.objectField("defId");
                try writer.write(detail.def_id);
                try writer.objectField("branchKey");
                try writer.write(detail.key);
            },
            .cycle => |nodes| {
                try writer.objectField("cycle");
                try writer.write(nodes);
            },
        }
        try writer.endObject();
        try writer.endObject();
    }
};

pub const Result = struct {
    errors: std.ArrayList(Issue) = .empty,
    warnings: std.ArrayList(Issue) = .empty,

    pub fn deinit(self: *Result, allocator: std.mem.Allocator) void {
        for (self.errors.items) |issue| issue.deinit(allocator);
        self.errors.deinit(allocator);
        for (self.warnings.items) |issue| issue.deinit(allocator);
        self.warnings.deinit(allocator);
        self.* = undefined;
    }

    pub fn jsonStringify(self: Result, writer: anytype) !void {
        try writer.beginObject();
        try writer.objectField("valid");
        try writer.write(self.errors.items.len == 0);
        try writer.objectField("errors");
        try writer.write(self.errors.items);
        try writer.objectField("warnings");
        try writer.write(self.warnings.items);
        try writer.endObject();
    }
};

fn jsType(value: std.json.Value) []const u8 {
    return switch (value) {
        .string => "string",
        .bool => "boolean",
        .integer, .float => "number",
        .null, .array, .object => "object",
        .number_string => "string",
    };
}

pub fn validate(context: std.json.Value, allocator: std.mem.Allocator) !Result {
    var result: Result = .{};
    errdefer result.deinit(allocator);
    const required = [_][]const u8{ "valueTable", "funcTable", "combineFuncDefTable", "pipeFuncDefTable", "condFuncDefTable" };
    if (context != .object) {
        for (required) |name| try addMissing(&result, name, allocator);
        return result;
    }
    var tables: [required.len]std.json.ObjectMap = undefined;
    var complete = true;
    for (required, 0..) |name, index| {
        const raw = context.object.get(name) orelse {
            try addMissing(&result, name, allocator);
            complete = false;
            continue;
        };
        if (raw != .object) {
            try result.errors.append(allocator, .{
                .message = try std.fmt.allocPrint(allocator, "ExecutionContext table {s} must be an object", .{name}),
                .detail = .{ .table_type = .{ .table = name, .actual = jsType(raw) } },
            });
            complete = false;
            continue;
        }
        tables[index] = raw.object;
    }
    if (!complete) return result;
    var total: usize = 0;
    for (tables) |table| total += table.count();
    if (total > max_graph_nodes) {
        try result.errors.append(allocator, .{
            .message = try std.fmt.allocPrint(allocator, "ExecutionContext is too large: {d} total table entries exceeds the limit of {d}", .{ total, max_graph_nodes }),
            .detail = .{ .size = .{ .total = total, .limit = max_graph_nodes } },
        });
        return result;
    }
    var owners: std.StringHashMapUnmanaged([]const u8) = .empty;
    defer owners.deinit(allocator);
    var referenced_defs: std.StringHashMapUnmanaged(void) = .empty;
    defer referenced_defs.deinit(allocator);
    var referenced_values: std.StringHashMapUnmanaged(void) = .empty;
    defer referenced_values.deinit(allocator);
    var functions = tables[1].iterator();
    while (functions.next()) |entry| {
        if (entry.value_ptr.* != .object) continue;
        const return_id = entry.value_ptr.object.get("returnId") orelse continue;
        if (return_id != .string) continue;
        if (owners.get(return_id.string)) |first| {
            try result.errors.append(allocator, .{
                .message = try std.fmt.allocPrint(allocator, "FuncTable: duplicate returnId \"{s}\" shared by \"{s}\" and \"{s}\"", .{ return_id.string, first, entry.key_ptr.* }),
                .detail = .{ .duplicate = .{ .return_id = return_id.string, .first = first, .second = entry.key_ptr.* } },
            });
        } else try owners.put(allocator, return_id.string, entry.key_ptr.*);
    }
    functions = tables[1].iterator();
    while (functions.next()) |entry| try validateFunction(entry.key_ptr.*, entry.value_ptr.*, tables, &owners, &referenced_defs, &referenced_values, &result, allocator);
    var combines = tables[2].iterator();
    while (combines.next()) |entry| try validateCombineDefinition(entry.key_ptr.*, entry.value_ptr.*, &referenced_defs, &result, allocator);
    var pipes = tables[3].iterator();
    while (pipes.next()) |entry| try validatePipeDefinition(entry.key_ptr.*, entry.value_ptr.*, tables, &referenced_defs, &referenced_values, &result, allocator);
    var conditions = tables[4].iterator();
    while (conditions.next()) |entry| try validateCondDefinition(entry.key_ptr.*, entry.value_ptr.*, tables, &referenced_defs, &referenced_values, &result, allocator);
    try checkFunctionCycles(tables, &owners, &result, allocator);
    try checkPipeCycles(tables, &result, allocator);
    var values = tables[0].iterator();
    while (values.next()) |entry| if (!referenced_values.contains(entry.key_ptr.*)) {
        try result.warnings.append(allocator, .{
            .message = try std.fmt.allocPrint(allocator, "ValueTable[{s}]: Value is never referenced", .{entry.key_ptr.*}),
            .detail = .{ .value = .{ .value_id = entry.key_ptr.* } },
        });
    };
    return result;
}

fn has(table: std.json.ObjectMap, key: []const u8) bool {
    return table.contains(key);
}

fn validateFunction(
    func_id: []const u8,
    raw: std.json.Value,
    tables: [5]std.json.ObjectMap,
    return_ids: *const std.StringHashMapUnmanaged([]const u8),
    referenced_defs: *std.StringHashMapUnmanaged(void),
    referenced_values: *std.StringHashMapUnmanaged(void),
    result: *Result,
    allocator: std.mem.Allocator,
) !void {
    if (raw != .object) {
        try addFuncIssue(result, allocator, "FuncTable[{s}]: Invalid entry", func_id, .{ .func = .{ .func_id = func_id } });
        return;
    }
    const kind_value = raw.object.get("kind") orelse {
        try addFuncIssue(result, allocator, "FuncTable[{s}]: Missing or invalid kind", func_id, .{ .func_kind = .{ .func_id = func_id, .kind = null } });
        return;
    };
    if (kind_value != .string) {
        try addFuncIssue(result, allocator, "FuncTable[{s}]: Missing or invalid kind", func_id, .{ .func_kind = .{ .func_id = func_id, .kind = null } });
        return;
    }
    const kind = kind_value.string;
    if (!std.mem.eql(u8, kind, "combine") and !std.mem.eql(u8, kind, "pipe") and !std.mem.eql(u8, kind, "cond")) {
        const message = try std.fmt.allocPrint(allocator, "FuncTable[{s}]: Unknown kind \"{s}\"", .{ func_id, kind });
        try result.errors.append(allocator, .{ .message = message, .detail = .{ .func_kind = .{ .func_id = func_id, .kind = kind } } });
        return;
    }
    const def_value = raw.object.get("defId") orelse {
        try addFuncIssue(result, allocator, "FuncTable[{s}]: Missing or invalid defId", func_id, .{ .func = .{ .func_id = func_id } });
        return;
    };
    if (def_value != .string) {
        try addFuncIssue(result, allocator, "FuncTable[{s}]: Missing or invalid defId", func_id, .{ .func = .{ .func_id = func_id } });
        return;
    }
    const def_id = def_value.string;
    if (!has(tables[2], def_id) and !has(tables[3], def_id) and !has(tables[4], def_id)) {
        const message = try std.fmt.allocPrint(allocator, "FuncTable[{s}]: Definition {s} does not exist", .{ func_id, def_id });
        try result.errors.append(allocator, .{ .message = message, .detail = .{ .func_def = .{ .func_id = func_id, .def_id = def_id } } });
    } else try referenced_defs.put(allocator, def_id, {});
    const return_value = raw.object.get("returnId");
    if (return_value == null or return_value.? != .string)
        try addFuncIssue(result, allocator, "FuncTable[{s}]: Missing or invalid returnId", func_id, .{ .func = .{ .func_id = func_id } });
    const expected_table: usize = if (std.mem.eql(u8, kind, "combine")) 2 else if (std.mem.eql(u8, kind, "pipe")) 3 else 4;
    if (!has(tables[expected_table], def_id)) {
        const table_name = if (expected_table == 2) "CombineFuncDefTable" else if (expected_table == 3) "PipeFuncDefTable" else "CondFuncDefTable";
        const message = try std.fmt.allocPrint(allocator, "FuncTable[{s}]: kind \"{s}\" must reference {s}, got {s}", .{ func_id, kind, table_name, def_id });
        try result.errors.append(allocator, .{ .message = message, .detail = .{ .func_def_kind = .{ .func_id = func_id, .def_id = def_id, .kind = kind } } });
    }
    const arg_map = raw.object.get("argMap");
    if (!std.mem.eql(u8, kind, "cond") and (arg_map == null or arg_map.? != .object)) {
        const message = try std.fmt.allocPrint(allocator, "FuncTable[{s}]: kind \"{s}\" requires argMap", .{ func_id, kind });
        try result.errors.append(allocator, .{ .message = message, .detail = .{ .func_kind = .{ .func_id = func_id, .kind = kind } } });
        return;
    }
    if (std.mem.eql(u8, kind, "cond") and arg_map != null and arg_map.? != .object) {
        try addFuncIssue(result, allocator, "FuncTable[{s}]: cond argMap must be an object when provided", func_id, .{ .func = .{ .func_id = func_id } });
        return;
    }
    if (arg_map) |map| if (map == .object) {
        var args = map.object.iterator();
        while (args.next()) |arg| {
            if (arg.value_ptr.* != .string) {
                const message = try std.fmt.allocPrint(allocator, "FuncTable[{s}].argMap['{s}']: Argument ID must be a string", .{ func_id, arg.key_ptr.* });
                try result.errors.append(allocator, .{ .message = message, .detail = .{ .func_arg_id = .{ .func_id = func_id, .arg_name = arg.key_ptr.*, .arg_id = arg.value_ptr.* } } });
            } else if (!has(tables[0], arg.value_ptr.string) and !return_ids.contains(arg.value_ptr.string)) {
                const message = try std.fmt.allocPrint(allocator, "FuncTable[{s}].argMap['{s}']: Referenced ID {s} does not exist", .{ func_id, arg.key_ptr.*, arg.value_ptr.string });
                try result.errors.append(allocator, .{ .message = message, .detail = .{ .func_arg_id = .{ .func_id = func_id, .arg_name = arg.key_ptr.*, .arg_id = arg.value_ptr.* } } });
            } else try referenced_values.put(allocator, arg.value_ptr.string, {});
        }
        if (std.mem.eql(u8, kind, "combine")) for ([_][]const u8{ "a", "b" }) |arg_name| if (!map.object.contains(arg_name)) {
            const message = try std.fmt.allocPrint(allocator, "FuncTable[{s}].argMap: Combine function requires argument \"{s}\"", .{ func_id, arg_name });
            try result.errors.append(allocator, .{ .message = message, .detail = .{ .func_arg = .{ .func_id = func_id, .arg_name = arg_name } } });
        };
        if (std.mem.eql(u8, kind, "combine") and tables[2].get(def_id) != null)
            try validateFunctionTypes(func_id, map.object, tables[2].get(def_id).?, tables, result, allocator);
    };
}

fn inferReferenceType(id: []const u8, tables: [5]std.json.ObjectMap) ?[]const u8 {
    if (tables[0].get(id)) |item| {
        if (item == .object) if (item.object.get("symbol")) |symbol| if (symbol == .string) return symbol.string;
    }
    var functions = tables[1].iterator();
    while (functions.next()) |entry| {
        if (entry.value_ptr.* != .object) continue;
        const return_id = entry.value_ptr.object.get("returnId") orelse continue;
        const def_id = entry.value_ptr.object.get("defId") orelse continue;
        if (return_id != .string or def_id != .string or !std.mem.eql(u8, return_id.string, id)) continue;
        if (tables[2].get(def_id.string)) |definition| {
            if (definition == .object) if (definition.object.get("name")) |name| if (name == .string)
                return preset.returnType(name.string, null);
        }
    }
    return null;
}

fn inferFunctionIdType(id: []const u8, tables: [5]std.json.ObjectMap) ?[]const u8 {
    const entry = tables[1].get(id) orelse return null;
    if (entry != .object) return null;
    const return_id = entry.object.get("returnId") orelse return null;
    return if (return_id == .string) inferReferenceType(return_id.string, tables) else null;
}

fn validateFunctionTypes(
    func_id: []const u8,
    arg_map: std.json.ObjectMap,
    definition: std.json.Value,
    tables: [5]std.json.ObjectMap,
    result: *Result,
    allocator: std.mem.Allocator,
) !void {
    if (definition != .object) return;
    const name = definition.object.get("name") orelse return;
    const transforms = definition.object.get("transformFn") orelse return;
    if (name != .string or transforms != .object) return;
    const expected = preset.parameterType(name.string);
    for ([_][]const u8{ "a", "b" }) |arg_name| {
        const arg_id = arg_map.get(arg_name) orelse continue;
        if (arg_id != .string) continue;
        var current = inferReferenceType(arg_id.string, tables) orelse {
            try result.warnings.append(allocator, .{
                .message = try std.fmt.allocPrint(allocator, "FuncTable[{s}].argMap['{s}']: type of argument \"{s}\" could not be inferred, skipping compatibility check", .{ func_id, arg_name, arg_id.string }),
                .detail = .{ .func_arg_id = .{ .func_id = func_id, .arg_name = arg_name, .arg_id = arg_id } },
            });
            continue;
        };
        const chain = transforms.object.get(arg_name) orelse continue;
        if (chain != .array) continue;
        for (chain.array.items) |function| {
            if (function != .string) continue;
            if (preset.inputType(function.string)) |input_type| if (!std.mem.eql(u8, current, input_type)) {
                try result.errors.append(allocator, .{
                    .message = try std.fmt.allocPrint(allocator, "FuncTable[{s}].argMap['{s}']: Argument has type \"{s}\" but transform function \"{s}\" expects \"{s}\"", .{ func_id, arg_name, current, function.string, input_type }),
                    .detail = .{ .transform_type = .{ .func_id = func_id, .arg_id = arg_id.string, .arg_type = current, .transform_fn = function.string, .expected_type = input_type } },
                });
            };
            if (preset.returnType(function.string, null)) |return_type| current = return_type;
        }
        if (expected) |expected_type| if (!std.mem.eql(u8, current, expected_type)) {
            try result.errors.append(allocator, .{
                .message = try std.fmt.allocPrint(allocator, "FuncTable[{s}].argMap['{s}']: Argument resolves to type \"{s}\" but combine function \"{s}\" expects \"{s}\"", .{ func_id, arg_name, current, name.string, expected_type }),
                .detail = .{ .combine_type = .{ .func_id = func_id, .arg_id = arg_id.string, .arg_name = arg_name, .arg_type = current, .combine_fn = name.string, .expected_type = expected_type } },
            });
        };
    }
}

fn knownPreset(name: []const u8, allocator: std.mem.Allocator) !bool {
    var probe = preset.call(name, &.{}, allocator) catch |err| {
        if (err == error.UnknownFunction) return false;
        if (err == error.OutOfMemory) return err;
        return true;
    };
    probe.deinit(allocator);
    return true;
}

fn validateCombineDefinition(
    def_id: []const u8,
    raw: std.json.Value,
    referenced_defs: *const std.StringHashMapUnmanaged(void),
    result: *Result,
    allocator: std.mem.Allocator,
) !void {
    if (raw != .object) {
        try addDefIssue(result, allocator, "CombineFuncDefTable[{s}]: Invalid entry", def_id);
        return;
    }
    const name = raw.object.get("name");
    if (name == null or name.? != .string or name.?.string.len == 0) {
        const stored = name orelse .null;
        try result.errors.append(allocator, .{
            .message = try std.fmt.allocPrint(allocator, "CombineFuncDefTable[{s}]: Invalid or missing function name", .{def_id}),
            .detail = .{ .def_name = .{ .def_id = def_id, .name = stored } },
        });
    } else if (!try knownPreset(name.?.string, allocator) or !std.mem.startsWith(u8, name.?.string, "combineFn")) {
        try result.errors.append(allocator, .{
            .message = try std.fmt.allocPrint(allocator, "CombineFuncDefTable[{s}]: Invalid or unknown combine function \"{s}\"", .{ def_id, name.?.string }),
            .detail = .{ .def_combine = .{ .def_id = def_id, .combine_fn = name.?.string } },
        });
    }
    const transforms = raw.object.get("transformFn");
    if (transforms == null or transforms.? != .object) {
        try addDefIssue(result, allocator, "CombineFuncDefTable[{s}]: Missing transform function definitions", def_id);
        return;
    }
    for ([_][]const u8{ "a", "b" }) |key| {
        const chain = transforms.?.object.get(key);
        if (chain == null or chain.? != .array) {
            try result.errors.append(allocator, .{
                .message = try std.fmt.allocPrint(allocator, "CombineFuncDefTable[{s}]: Missing transform function '{s}'", .{ def_id, key }),
                .detail = .{ .def = .{ .def_id = def_id } },
            });
            continue;
        }
        for (chain.?.array.items) |function| {
            if (function != .string) {
                try result.errors.append(allocator, .{
                    .message = try std.fmt.allocPrint(allocator, "CombineFuncDefTable[{s}]: Transform function '{s}' has invalid entry", .{ def_id, key }),
                    .detail = .{ .def = .{ .def_id = def_id } },
                });
                continue;
            }
            if (!try knownPreset(function.string, allocator) or !std.mem.startsWith(u8, function.string, "transformFn")) {
                try result.errors.append(allocator, .{
                    .message = try std.fmt.allocPrint(allocator, "CombineFuncDefTable[{s}].transformFn.{s}: Invalid or unknown transform function \"{s}\"", .{ def_id, key, function.string }),
                    .detail = .{ .def_transform = .{ .def_id = def_id, .transform_fn = function.string } },
                });
            }
        }
        if (name != null and name.? == .string and chain.?.array.items.len > 0) {
            const last = chain.?.array.items[chain.?.array.items.len - 1];
            const expected = preset.parameterType(name.?.string);
            if (last == .string and expected != null) if (preset.returnType(last.string, null)) |return_type| if (!std.mem.eql(u8, return_type, expected.?)) {
                const ordinal = if (std.mem.eql(u8, key, "a")) "first" else "second";
                try result.errors.append(allocator, .{
                    .message = try std.fmt.allocPrint(allocator, "CombineFuncDefTable[{s}]: Transform function '{s}' returns \"{s}\" but combine function \"{s}\" expects \"{s}\" for {s} parameter", .{ def_id, key, return_type, name.?.string, expected.?, ordinal }),
                    .detail = .{ .def_compat = .{ .def_id = def_id, .transform_fn = last.string, .transform_return_type = return_type, .combine_fn = name.?.string, .expected_type = expected.? } },
                });
            };
        }
    }
    if (!referenced_defs.contains(def_id)) {
        try result.warnings.append(allocator, .{
            .message = try std.fmt.allocPrint(allocator, "CombineFuncDefTable[{s}]: Definition is never used", .{def_id}),
            .detail = .{ .def = .{ .def_id = def_id } },
        });
    }
}

fn addDefIssue(result: *Result, allocator: std.mem.Allocator, comptime format: []const u8, def_id: []const u8) !void {
    try result.errors.append(allocator, .{ .message = try std.fmt.allocPrint(allocator, format, .{def_id}), .detail = .{ .def = .{ .def_id = def_id } } });
}

fn addPipeIssue(result: *Result, allocator: std.mem.Allocator, message: []u8, def_id: []const u8, step_index: ?usize, arg_name: ?[]const u8) !void {
    try result.errors.append(allocator, .{ .message = message, .detail = .{ .pipe = .{ .def_id = def_id, .step_index = step_index, .arg_name = arg_name } } });
}

fn validatePipeDefinition(
    def_id: []const u8,
    raw: std.json.Value,
    tables: [5]std.json.ObjectMap,
    referenced_defs: *const std.StringHashMapUnmanaged(void),
    referenced_values: *std.StringHashMapUnmanaged(void),
    result: *Result,
    allocator: std.mem.Allocator,
) !void {
    if (raw != .object) {
        try addDefIssue(result, allocator, "PipeFuncDefTable[{s}]: Invalid entry", def_id);
        return;
    }
    const sequence = raw.object.get("sequence");
    if (sequence == null or sequence.? != .array) {
        try addDefIssue(result, allocator, "PipeFuncDefTable[{s}]: Missing or invalid sequence", def_id);
        return;
    }
    if (sequence.?.array.items.len == 0) {
        try addDefIssue(result, allocator, "PipeFuncDefTable[{s}]: Sequence is empty", def_id);
        return;
    }
    var declared_args: std.StringHashMapUnmanaged(void) = .empty;
    defer declared_args.deinit(allocator);
    if (raw.object.get("args")) |args| {
        if (args != .array) {
            try addDefIssue(result, allocator, "PipeFuncDefTable[{s}]: 'args' must be an array of strings", def_id);
        } else for (args.array.items, 0..) |arg, index| {
            if (arg != .string) {
                try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, "PipeFuncDefTable[{s}].args[{d}]: argument name must be a string", .{ def_id, index }), def_id, null, null);
            } else try declared_args.put(allocator, arg.string, {});
        }
    }
    for (sequence.?.array.items, 0..) |step, step_index| {
        if (step != .object) {
            try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, "PipeFuncDefTable[{s}].sequence[{d}]: Step must be an object", .{ def_id, step_index }), def_id, step_index, null);
            continue;
        }
        const step_def = step.object.get("defId");
        if (step_def == null or step_def.? != .string) {
            try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, "PipeFuncDefTable[{s}].sequence[{d}]: Missing step defId", .{ def_id, step_index }), def_id, step_index, null);
            continue;
        }
        const step_id = step_def.?.string;
        const in_combine = tables[2].contains(step_id);
        const in_pipe = tables[3].contains(step_id);
        const in_cond = tables[4].contains(step_id);
        if (!in_combine and !in_pipe and !in_cond) {
            try result.errors.append(allocator, .{
                .message = try std.fmt.allocPrint(allocator, "PipeFuncDefTable[{s}].sequence[{d}]: Referenced definition {s} does not exist", .{ def_id, step_index, step_id }),
                .detail = .{ .pipe_step_def = .{ .def_id = def_id, .step_index = step_index, .step_def_id = step_id } },
            });
            continue;
        }
        if (!in_combine and !in_pipe and in_cond) {
            try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, "PipeFuncDefTable[{s}].sequence[{d}]: CondFunc definition {s} cannot be used as a pipe step; only combine and pipe definitions are supported", .{ def_id, step_index, step_id }), def_id, step_index, null);
            continue;
        }
        const bindings = step.object.get("argBindings");
        if (bindings == null or bindings.? != .object) {
            try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, "PipeFuncDefTable[{s}].sequence[{d}]: Missing or invalid argBindings", .{ def_id, step_index }), def_id, step_index, null);
            continue;
        }
        var iterator = bindings.?.object.iterator();
        while (iterator.next()) |entry| try validatePipeBinding(def_id, step_index, entry.key_ptr.*, entry.value_ptr.*, &declared_args, tables[0], referenced_values, result, allocator);
    }
    if (!referenced_defs.contains(def_id)) {
        try result.warnings.append(allocator, .{
            .message = try std.fmt.allocPrint(allocator, "PipeFuncDefTable[{s}]: Definition is never used", .{def_id}),
            .detail = .{ .def = .{ .def_id = def_id } },
        });
    }
}

fn validatePipeBinding(def_id: []const u8, step_index: usize, arg_name: []const u8, binding: std.json.Value, declared_args: *const std.StringHashMapUnmanaged(void), values: std.json.ObjectMap, referenced_values: *std.StringHashMapUnmanaged(void), result: *Result, allocator: std.mem.Allocator) !void {
    const prefix = "PipeFuncDefTable[{s}].sequence[{d}]";
    if (binding != .object or binding.object.get("source") == null or binding.object.get("source").? != .string) {
        try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, prefix ++ ": Argument binding for '{s}' is invalid", .{ def_id, step_index, arg_name }), def_id, step_index, arg_name);
        return;
    }
    const source = binding.object.get("source").?.string;
    if (std.mem.eql(u8, source, "input")) {
        const name = binding.object.get("argName");
        if (name == null or name.? != .string or name.?.string.len == 0) {
            try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, prefix ++ ": 'input' binding for '{s}' must include string argName", .{ def_id, step_index, arg_name }), def_id, step_index, arg_name);
        } else if (!declared_args.contains(name.?.string)) {
            try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, prefix ++ ": Argument binding for '{s}' references undefined PipeFunc input '{s}'", .{ def_id, step_index, arg_name, name.?.string }), def_id, step_index, arg_name);
        }
        return;
    }
    if (std.mem.eql(u8, source, "step")) {
        const index = binding.object.get("stepIndex");
        if (index == null or (index.? != .integer and index.? != .float)) {
            try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, prefix ++ ": 'step' binding for '{s}' must include numeric stepIndex", .{ def_id, step_index, arg_name }), def_id, step_index, arg_name);
        } else {
            const valid = if (index.? == .integer) index.?.integer >= 0 and index.?.integer < step_index else false;
            if (!valid) try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, prefix ++ ": Argument binding for '{s}' references invalid step index (must be < {d})", .{ def_id, step_index, arg_name, step_index }), def_id, step_index, arg_name);
        }
        return;
    }
    if (std.mem.eql(u8, source, "value")) {
        const id = binding.object.get("id");
        if (id == null or id.? != .string or id.?.string.len == 0) {
            try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, prefix ++ ": 'value' binding for '{s}' must include string id", .{ def_id, step_index, arg_name }), def_id, step_index, arg_name);
        } else if (!values.contains(id.?.string)) {
            try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, prefix ++ ": Argument binding for '{s}' references non-existent ValueId {s}", .{ def_id, step_index, arg_name, id.?.string }), def_id, step_index, arg_name);
        } else try referenced_values.put(allocator, id.?.string, {});
        return;
    }
    try addPipeIssue(result, allocator, try std.fmt.allocPrint(allocator, prefix ++ ": Argument binding for '{s}' has unknown source \"{s}\"", .{ def_id, step_index, arg_name, source }), def_id, step_index, arg_name);
}

fn validateCondDefinition(
    def_id: []const u8,
    raw: std.json.Value,
    tables: [5]std.json.ObjectMap,
    referenced_defs: *const std.StringHashMapUnmanaged(void),
    referenced_values: *std.StringHashMapUnmanaged(void),
    result: *Result,
    allocator: std.mem.Allocator,
) !void {
    if (raw != .object) {
        try addDefIssue(result, allocator, "CondFuncDefTable[{s}]: Invalid entry", def_id);
        return;
    }
    const condition = raw.object.get("conditionId");
    if (condition == null or condition.? != .object) {
        try addDefIssue(result, allocator, "CondFuncDefTable[{s}]: Missing or invalid conditionId", def_id);
    } else {
        const kind = condition.?.object.get("kind");
        const id = condition.?.object.get("id");
        if (kind == null or kind.? != .string or id == null or id.? != .string) {
            try addDefIssue(result, allocator, "CondFuncDefTable[{s}].conditionId: Must include string kind and id", def_id);
        } else if (!std.mem.eql(u8, kind.?.string, "value") and !std.mem.eql(u8, kind.?.string, "func")) {
            try result.errors.append(allocator, .{
                .message = try std.fmt.allocPrint(allocator, "CondFuncDefTable[{s}].conditionId: Unknown kind \"{s}\"", .{ def_id, kind.?.string }),
                .detail = .{ .def = .{ .def_id = def_id } },
            });
        } else if (std.mem.eql(u8, kind.?.string, "value")) {
            if (!tables[0].contains(id.?.string)) {
                try result.errors.append(allocator, .{
                    .message = try std.fmt.allocPrint(allocator, "CondFuncDefTable[{s}].conditionId: Referenced ValueId {s} does not exist", .{ def_id, id.?.string }),
                    .detail = .{ .condition_ref = .{ .def_id = def_id, .condition_id = id.?.string } },
                });
            } else {
                try referenced_values.put(allocator, id.?.string, {});
                if (inferReferenceType(id.?.string, tables)) |condition_type| if (!std.mem.eql(u8, condition_type, "boolean")) {
                    try result.errors.append(allocator, .{
                        .message = try std.fmt.allocPrint(allocator, "CondFuncDefTable[{s}].conditionId: Condition value must be boolean, got \"{s}\"", .{ def_id, condition_type }),
                        .detail = .{ .condition = .{ .def_id = def_id, .condition_id = id.?.string, .condition_type = condition_type } },
                    });
                };
            }
        } else if (!tables[1].contains(id.?.string)) {
            try result.errors.append(allocator, .{
                .message = try std.fmt.allocPrint(allocator, "CondFuncDefTable[{s}].conditionId: Referenced FuncId {s} does not exist", .{ def_id, id.?.string }),
                .detail = .{ .condition_ref = .{ .def_id = def_id, .condition_id = id.?.string } },
            });
        } else if (inferFunctionIdType(id.?.string, tables)) |condition_type| if (!std.mem.eql(u8, condition_type, "boolean")) {
            try result.errors.append(allocator, .{
                .message = try std.fmt.allocPrint(allocator, "CondFuncDefTable[{s}].conditionId: Function condition must return boolean, got \"{s}\"", .{ def_id, condition_type }),
                .detail = .{ .condition = .{ .def_id = def_id, .condition_id = id.?.string, .condition_type = condition_type } },
            });
        };
    }
    for ([_][]const u8{ "trueBranchId", "falseBranchId" }) |branch_key| {
        const branch = raw.object.get(branch_key);
        if (branch == null or branch.? != .string) {
            try result.errors.append(allocator, .{
                .message = try std.fmt.allocPrint(allocator, "CondFuncDefTable[{s}].{s}: Missing or invalid FuncId", .{ def_id, branch_key }),
                .detail = .{ .branch_key = .{ .def_id = def_id, .key = branch_key } },
            });
        } else if (!tables[1].contains(branch.?.string)) {
            try result.errors.append(allocator, .{
                .message = try std.fmt.allocPrint(allocator, "CondFuncDefTable[{s}].{s}: Referenced FuncId {s} does not exist", .{ def_id, branch_key, branch.?.string }),
                .detail = .{ .branch = .{ .def_id = def_id, .key = branch_key, .id = branch.?.string } },
            });
        }
    }
    if (!referenced_defs.contains(def_id)) {
        try result.warnings.append(allocator, .{
            .message = try std.fmt.allocPrint(allocator, "CondFuncDefTable[{s}]: Definition is never used", .{def_id}),
            .detail = .{ .def = .{ .def_id = def_id } },
        });
    }
}

const Dependencies = std.StringArrayHashMapUnmanaged(std.ArrayList([]const u8));

fn deinitDependencies(deps: *Dependencies, allocator: std.mem.Allocator) void {
    for (deps.values()) |*items| items.deinit(allocator);
    deps.deinit(allocator);
}

fn appendDependency(deps: *Dependencies, node: []const u8, dependency: []const u8, allocator: std.mem.Allocator) !void {
    const found = deps.getPtr(node) orelse return;
    for (found.items) |existing| if (std.mem.eql(u8, existing, dependency)) return;
    try found.append(allocator, dependency);
}

fn checkFunctionCycles(tables: [5]std.json.ObjectMap, owners: *const std.StringHashMapUnmanaged([]const u8), result: *Result, allocator: std.mem.Allocator) !void {
    var deps: Dependencies = .empty;
    defer deinitDependencies(&deps, allocator);
    var functions = tables[1].iterator();
    while (functions.next()) |entry| try deps.put(allocator, entry.key_ptr.*, .empty);
    functions = tables[1].iterator();
    while (functions.next()) |entry| {
        if (entry.value_ptr.* != .object) continue;
        if (entry.value_ptr.object.get("argMap")) |args| if (args == .object) {
            var iterator = args.object.iterator();
            while (iterator.next()) |arg| if (arg.value_ptr.* == .string) if (owners.get(arg.value_ptr.string)) |producer|
                try appendDependency(&deps, entry.key_ptr.*, producer, allocator);
        };
        const def_id = entry.value_ptr.object.get("defId") orelse continue;
        if (def_id != .string) continue;
        const condition = tables[4].get(def_id.string) orelse continue;
        if (condition != .object) continue;
        if (condition.object.get("conditionId")) |condition_id| if (condition_id == .object) {
            const kind = condition_id.object.get("kind");
            const id = condition_id.object.get("id");
            if (kind != null and kind.? == .string and std.mem.eql(u8, kind.?.string, "func") and id != null and id.? == .string)
                try appendDependency(&deps, entry.key_ptr.*, id.?.string, allocator);
        };
        for ([_][]const u8{ "trueBranchId", "falseBranchId" }) |key| if (condition.object.get(key)) |branch| if (branch == .string)
            try appendDependency(&deps, entry.key_ptr.*, branch.string, allocator);
    }
    try detectCycles(&deps, "FuncTable", true, result, allocator);
}

fn checkPipeCycles(tables: [5]std.json.ObjectMap, result: *Result, allocator: std.mem.Allocator) !void {
    var deps: Dependencies = .empty;
    defer deinitDependencies(&deps, allocator);
    var pipes = tables[3].iterator();
    while (pipes.next()) |entry| try deps.put(allocator, entry.key_ptr.*, .empty);
    pipes = tables[3].iterator();
    while (pipes.next()) |entry| {
        if (entry.value_ptr.* != .object) continue;
        const sequence = entry.value_ptr.object.get("sequence") orelse continue;
        if (sequence != .array) continue;
        for (sequence.array.items) |step| {
            if (step != .object) continue;
            const def_id = step.object.get("defId") orelse continue;
            if (def_id == .string and tables[3].contains(def_id.string))
                try appendDependency(&deps, entry.key_ptr.*, def_id.string, allocator);
        }
    }
    try detectCycles(&deps, "PipeFuncDefTable", false, result, allocator);
}

const CycleFrame = struct { node: []const u8, next: usize = 0 };

fn detectCycles(deps: *const Dependencies, label: []const u8, normalize: bool, result: *Result, allocator: std.mem.Allocator) !void {
    var states: std.StringHashMapUnmanaged(u8) = .empty;
    defer states.deinit(allocator);
    var path = std.ArrayList([]const u8).empty;
    defer path.deinit(allocator);
    var work = std.ArrayList(CycleFrame).empty;
    defer work.deinit(allocator);
    for (deps.keys()) |root| {
        if (states.get(root) != null) continue;
        try states.put(allocator, root, 1);
        try path.append(allocator, root);
        try work.append(allocator, .{ .node = root });
        while (work.items.len > 0) {
            const frame = &work.items[work.items.len - 1];
            const children = deps.get(frame.node).?.items;
            if (frame.next >= children.len) {
                try states.put(allocator, frame.node, 2);
                _ = path.pop();
                _ = work.pop();
                continue;
            }
            const child = children[frame.next];
            frame.next += 1;
            if (!deps.contains(child)) continue;
            const state = states.get(child) orelse 0;
            if (state == 0) {
                try states.put(allocator, child, 1);
                try path.append(allocator, child);
                try work.append(allocator, .{ .node = child });
            } else if (state == 1) {
                var start: usize = 0;
                while (start < path.items.len and !std.mem.eql(u8, path.items[start], child)) : (start += 1) {}
                try reportCycle(path.items[start..], child, label, normalize, result, allocator);
            }
        }
    }
}

fn reportCycle(path: []const []const u8, closing: []const u8, label: []const u8, normalize: bool, result: *Result, allocator: std.mem.Allocator) !void {
    var start: usize = 0;
    if (normalize and path.len > 0) for (path, 0..) |node, index| if (std.mem.order(u8, node, path[start]) == .lt) {
        start = index;
    };
    const cycle = try allocator.alloc([]const u8, path.len + 1);
    errdefer allocator.free(cycle);
    for (0..path.len) |index| cycle[index] = path[(start + index) % path.len];
    cycle[path.len] = if (normalize) cycle[0] else closing;
    var joined = std.ArrayList(u8).empty;
    defer joined.deinit(allocator);
    for (cycle, 0..) |node, index| {
        if (index != 0) try joined.appendSlice(allocator, " -> ");
        try joined.appendSlice(allocator, node);
    }
    try result.errors.append(allocator, .{
        .message = try std.fmt.allocPrint(allocator, "{s}: Cycle detected {s}", .{ label, joined.items }),
        .detail = .{ .cycle = cycle },
    });
}

fn addFuncIssue(result: *Result, allocator: std.mem.Allocator, comptime format: []const u8, func_id: []const u8, detail: Detail) !void {
    try result.errors.append(allocator, .{ .message = try std.fmt.allocPrint(allocator, format, .{func_id}), .detail = detail });
}

fn addMissing(result: *Result, name: []const u8, allocator: std.mem.Allocator) !void {
    try result.errors.append(allocator, .{
        .message = try std.fmt.allocPrint(allocator, "ExecutionContext is missing required table: {s}", .{name}),
        .detail = .{ .table = name },
    });
}

test "legacy validation checks required tables and duplicate returns" {
    var missing = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, "{}", .{});
    defer missing.deinit();
    var missing_result = try validate(missing.value, std.testing.allocator);
    defer missing_result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 5), missing_result.errors.items.len);

    const duplicate =
        \\{"valueTable":{"x":{},"y":{}},"funcTable":{"a":{"kind":"combine","defId":"add","argMap":{"a":"x","b":"y"},"returnId":"same"},"b":{"kind":"combine","defId":"add","argMap":{"a":"x","b":"y"},"returnId":"same"}},"combineFuncDefTable":{"add":{"name":"combineFnNumber::add","transformFn":{"a":[],"b":[]}}},"pipeFuncDefTable":{},"condFuncDefTable":{}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, duplicate, .{});
    defer parsed.deinit();
    var result = try validate(parsed.value, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 1), result.errors.items.len);
}

test "legacy validation checks function structure and references in order" {
    const fixture =
        \\{"valueTable":{},"funcTable":{"bad":[],"unknown":{"kind":"wat","defId":"x","returnId":"r"},"combine":{"kind":"combine","defId":"missing","argMap":{"a":42},"returnId":"out"}},"combineFuncDefTable":{},"pipeFuncDefTable":{},"condFuncDefTable":{}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, fixture, .{});
    defer parsed.deinit();
    var result = try validate(parsed.value, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings("FuncTable[bad]: Invalid entry", result.errors.items[0].message);
    try std.testing.expectEqualStrings("FuncTable[unknown]: Unknown kind \"wat\"", result.errors.items[1].message);
    try std.testing.expectEqualStrings("FuncTable[combine]: Definition missing does not exist", result.errors.items[2].message);
    try std.testing.expectEqualStrings("FuncTable[combine]: kind \"combine\" must reference CombineFuncDefTable, got missing", result.errors.items[3].message);
    try std.testing.expectEqualStrings("FuncTable[combine].argMap['a']: Argument ID must be a string", result.errors.items[4].message);
    try std.testing.expectEqualStrings("FuncTable[combine].argMap: Combine function requires argument \"b\"", result.errors.items[5].message);
}

test "legacy validation checks combine definitions and unused warnings" {
    const fixture =
        \\{"valueTable":{},"funcTable":{},"combineFuncDefTable":{"bad":{"name":"combineFnNumber::missing","transformFn":{"a":["transformFnNumber::missing"],"b":[]}},"unused":{"name":"combineFnNumber::add","transformFn":{"a":[],"b":[]}}},"pipeFuncDefTable":{},"condFuncDefTable":{}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, fixture, .{});
    defer parsed.deinit();
    var result = try validate(parsed.value, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 2), result.errors.items.len);
    try std.testing.expect(std.mem.indexOf(u8, result.errors.items[0].message, "unknown combine function") != null);
    try std.testing.expect(std.mem.indexOf(u8, result.errors.items[1].message, "unknown transform function") != null);
    try std.testing.expectEqual(@as(usize, 2), result.warnings.items.len);
    try std.testing.expectEqualStrings("CombineFuncDefTable[unused]: Definition is never used", result.warnings.items[1].message);
}

test "legacy validation checks function transform input types" {
    const fixture =
        \\{"valueTable":{"text":{"symbol":"string"},"number":{"symbol":"number"}},"funcTable":{"sum":{"kind":"combine","defId":"add","argMap":{"a":"text","b":"number"},"returnId":"out"}},"combineFuncDefTable":{"add":{"name":"combineFnNumber::add","transformFn":{"a":["transformFnNumber::pass"],"b":["transformFnNumber::pass"]}}},"pipeFuncDefTable":{},"condFuncDefTable":{}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, fixture, .{});
    defer parsed.deinit();
    var result = try validate(parsed.value, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 1), result.errors.items.len);
    try std.testing.expect(std.mem.indexOf(u8, result.errors.items[0].message, "Argument has type \"string\"") != null);
}

test "legacy validation checks final transform compatibility" {
    const fixture =
        \\{"valueTable":{},"funcTable":{},"combineFuncDefTable":{"bad":{"name":"combineFnNumber::add","transformFn":{"a":["transformFnString::pass"],"b":["transformFnNumber::pass"]}}},"pipeFuncDefTable":{},"condFuncDefTable":{}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, fixture, .{});
    defer parsed.deinit();
    var result = try validate(parsed.value, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 1), result.errors.items.len);
    try std.testing.expect(std.mem.indexOf(u8, result.errors.items[0].message, "expects \"number\" for first parameter") != null);
}

test "legacy validation checks pipe binding sources and step definitions" {
    const fixture =
        \\{"valueTable":{},"funcTable":{"run":{"kind":"pipe","defId":"pipe","argMap":{},"returnId":"out"}},"combineFuncDefTable":{"add":{"name":"combineFnNumber::add","transformFn":{"a":[],"b":[]}}},
        \\ "pipeFuncDefTable":{"pipe":{"args":["x"],"sequence":[{"defId":"add","argBindings":{"a":{"source":"input","argName":"missing"},"b":{"source":"step","stepIndex":0}}},{"defId":"add","argBindings":{"a":{"source":"value","id":"absent"}}},{"defId":"condition","argBindings":{}}]}},
        \\ "condFuncDefTable":{"condition":{}}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, fixture, .{});
    defer parsed.deinit();
    var result = try validate(parsed.value, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expect(result.errors.items.len >= 4);
    try std.testing.expect(std.mem.indexOf(u8, result.errors.items[0].message, "undefined PipeFunc input") != null);
    try std.testing.expect(std.mem.indexOf(u8, result.errors.items[1].message, "invalid step index") != null);
    try std.testing.expect(std.mem.indexOf(u8, result.errors.items[2].message, "non-existent ValueId") != null);
    try std.testing.expect(std.mem.indexOf(u8, result.errors.items[3].message, "cannot be used as a pipe step") != null);
}

test "legacy validation checks conditional references and condition types" {
    const fixture =
        \\{"valueTable":{"number":{"symbol":"number"}},"funcTable":{},"combineFuncDefTable":{},"pipeFuncDefTable":{},"condFuncDefTable":{"condition":{"conditionId":{"kind":"value","id":"number"},"trueBranchId":"missingTrue","falseBranchId":"missingFalse"}}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, fixture, .{});
    defer parsed.deinit();
    var result = try validate(parsed.value, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 3), result.errors.items.len);
    try std.testing.expect(std.mem.indexOf(u8, result.errors.items[0].message, "must be boolean") != null);
    try std.testing.expect(std.mem.indexOf(u8, result.errors.items[1].message, "missingTrue does not exist") != null);
    try std.testing.expect(std.mem.indexOf(u8, result.errors.items[2].message, "missingFalse does not exist") != null);
    try std.testing.expectEqualStrings("CondFuncDefTable[condition]: Definition is never used", result.warnings.items[0].message);
}

test "legacy validation reports normalized function and pipe cycles" {
    const fixture =
        \\{"valueTable":{},"funcTable":{"z":{"kind":"cond","defId":"cz","returnId":"rz"},"a":{"kind":"cond","defId":"ca","returnId":"ra"}},"combineFuncDefTable":{},
        \\ "pipeFuncDefTable":{"p1":{"sequence":[{"defId":"p2","argBindings":{}}]},"p2":{"sequence":[{"defId":"p1","argBindings":{}}]}},
        \\ "condFuncDefTable":{"cz":{"conditionId":{"kind":"func","id":"a"},"trueBranchId":"a","falseBranchId":"a"},"ca":{"conditionId":{"kind":"func","id":"z"},"trueBranchId":"z","falseBranchId":"z"}}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, fixture, .{});
    defer parsed.deinit();
    var result = try validate(parsed.value, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    var found_function = false;
    var found_pipe = false;
    for (result.errors.items) |issue| {
        if (std.mem.eql(u8, issue.message, "FuncTable: Cycle detected a -> z -> a")) found_function = true;
        if (std.mem.indexOf(u8, issue.message, "PipeFuncDefTable: Cycle detected") != null) found_pipe = true;
    }
    try std.testing.expect(found_function);
    try std.testing.expect(found_pipe);
}

test "cycle detection handles a forty thousand node chain iteratively" {
    var deps: Dependencies = .empty;
    defer deinitDependencies(&deps, std.testing.allocator);
    var names = std.ArrayList([]u8).empty;
    defer {
        for (names.items) |name| std.testing.allocator.free(name);
        names.deinit(std.testing.allocator);
    }
    for (0..40_000) |index| {
        const name = try std.fmt.allocPrint(std.testing.allocator, "n{d}", .{index});
        try names.append(std.testing.allocator, name);
        try deps.put(std.testing.allocator, name, .empty);
        if (index > 0) try appendDependency(&deps, names.items[index - 1], name, std.testing.allocator);
    }
    var result: Result = .{};
    defer result.deinit(std.testing.allocator);
    try detectCycles(&deps, "FuncTable", true, &result, std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 0), result.errors.items.len);
}

test "legacy validation warns only for unreferenced values in table order" {
    const fixture =
        \\{"valueTable":{"arg":{"symbol":"number"},"condition":{"symbol":"boolean"},"literal":{"symbol":"number"},"unused":{"symbol":"string"}},
        \\ "funcTable":{"sum":{"kind":"combine","defId":"add","argMap":{"a":"arg","b":"arg"},"returnId":"sumOut"},"choose":{"kind":"cond","defId":"choice","returnId":"choiceOut"}},
        \\ "combineFuncDefTable":{"add":{"name":"combineFnNumber::add","transformFn":{"a":[],"b":[]}}},
        \\ "pipeFuncDefTable":{"pipe":{"args":[],"sequence":[{"defId":"add","argBindings":{"a":{"source":"value","id":"literal"},"b":{"source":"value","id":"literal"}}}]}},
        \\ "condFuncDefTable":{"choice":{"conditionId":{"kind":"value","id":"condition"},"trueBranchId":"sum","falseBranchId":"sum"}}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, fixture, .{});
    defer parsed.deinit();
    var result = try validate(parsed.value, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings("ValueTable[unused]: Value is never referenced", result.warnings.items[result.warnings.items.len - 1].message);
}
