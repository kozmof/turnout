const std = @import("std");

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
    while (functions.next()) |entry| try validateFunction(entry.key_ptr.*, entry.value_ptr.*, tables, &owners, &result, allocator);
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
    }
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
        \\{"valueTable":{"x":{},"y":{}},"funcTable":{"a":{"kind":"combine","defId":"add","argMap":{"a":"x","b":"y"},"returnId":"same"},"b":{"kind":"combine","defId":"add","argMap":{"a":"x","b":"y"},"returnId":"same"}},"combineFuncDefTable":{"add":{}},"pipeFuncDefTable":{},"condFuncDefTable":{}}
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
