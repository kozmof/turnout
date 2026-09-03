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
    def: struct { def_id: []const u8 },
    def_name: struct { def_id: []const u8, name: std.json.Value },
    def_transform: struct { def_id: []const u8, transform_fn: []const u8 },
};

const Issue = struct {
    message: []u8,
    detail: Detail,

    fn deinit(self: Issue, allocator: std.mem.Allocator) void {
        allocator.free(self.message);
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
    while (functions.next()) |entry| try validateFunction(entry.key_ptr.*, entry.value_ptr.*, tables, &owners, &referenced_defs, &result, allocator);
    var combines = tables[2].iterator();
    while (combines.next()) |entry| try validateCombineDefinition(entry.key_ptr.*, entry.value_ptr.*, &referenced_defs, &result, allocator);
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
            }
        }
        if (std.mem.eql(u8, kind, "combine")) for ([_][]const u8{ "a", "b" }) |arg_name| if (!map.object.contains(arg_name)) {
            const message = try std.fmt.allocPrint(allocator, "FuncTable[{s}].argMap: Combine function requires argument \"{s}\"", .{ func_id, arg_name });
            try result.errors.append(allocator, .{ .message = message, .detail = .{ .func_arg = .{ .func_id = func_id, .arg_name = arg_name } } });
        };
    };
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
            .detail = .{ .def_transform = .{ .def_id = def_id, .transform_fn = name.?.string } },
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
