const std = @import("std");

pub const max_graph_nodes: usize = 50_000;

const Detail = union(enum) {
    table: []const u8,
    table_type: struct { table: []const u8, actual: []const u8 },
    size: struct { total: usize, limit: usize },
    duplicate: struct { return_id: []const u8, first: []const u8, second: []const u8 },
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
    return result;
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
        \\{"valueTable":{},"funcTable":{"a":{"returnId":"same"},"b":{"returnId":"same"}},"combineFuncDefTable":{},"pipeFuncDefTable":{},"condFuncDefTable":{}}
    ;
    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, duplicate, .{});
    defer parsed.deinit();
    var result = try validate(parsed.value, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 1), result.errors.items.len);
}
