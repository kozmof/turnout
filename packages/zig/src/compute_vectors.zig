const std = @import("std");
const compute = @import("compute.zig");
const value = @import("value.zig");

const Input = struct { name: []const u8, value: std.json.Value, tags: []const []const u8 };
const Output = struct { symbol: []const u8, value: std.json.Value, reason: ?[]const u8 = null, tags: []const []const u8 };
const Vector = struct { name: []const u8, compute: std.json.Value, inputs: []const Input, output: Output };

test "shared compute vectors" {
    const allocator = std.testing.allocator;
    const parsed = try std.json.parseFromSlice(
        []Vector,
        allocator,
        @embedFile("fixtures/compute-vectors.json"),
        .{},
    );
    defer parsed.deinit();
    for (parsed.value) |vector| {
        var inputs: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
        defer {
            for (inputs.values()) |*input| value.deinitTaggedValue(input, allocator);
            inputs.deinit(allocator);
        }
        for (vector.inputs) |input| {
            var converted = try value.fromJson(allocator, input.value);
            const tags = value.mergeTags(input.tags, &.{}, allocator) catch |err| {
                value.deinitValue(&converted, allocator);
                return err;
            };
            var tagged: value.TaggedValue = .{ .value = converted, .tags = tags };
            inputs.put(allocator, input.name, tagged) catch |err| {
                value.deinitTaggedValue(&tagged, allocator);
                return err;
            };
        }
        var result = try compute.executeJson(vector.compute, &inputs, allocator);
        defer result.deinit(allocator);
        var expected = try value.fromJson(allocator, vector.output.value);
        defer value.deinitValue(&expected, allocator);
        if (!result.value.eql(expected)) {
            std.debug.print("shared compute vector failed: {s}\n", .{vector.name});
            return error.TestExpectedEqual;
        }
        if (std.mem.eql(u8, vector.output.symbol, "null"))
            try std.testing.expectEqual(value.NullReason.missing, result.value.null_value);
        try std.testing.expectEqual(vector.output.tags.len, result.tags.len);
        for (vector.output.tags, result.tags) |expected_tag, actual_tag|
            try std.testing.expectEqualStrings(expected_tag, actual_tag);
    }
}

const ErrorVector = struct { name: []const u8, compute: std.json.Value, @"error": []const u8 };

test "shared compute error vectors" {
    const allocator = std.testing.allocator;
    const parsed = try std.json.parseFromSlice(
        []ErrorVector,
        allocator,
        @embedFile("fixtures/compute-error-vectors.json"),
        .{},
    );
    defer parsed.deinit();
    const inputs: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    for (parsed.value) |vector| {
        if (std.mem.eql(u8, vector.@"error", "DivisionByZero"))
            try std.testing.expectError(error.DivisionByZero, compute.executeJson(vector.compute, &inputs, allocator))
        else if (std.mem.eql(u8, vector.@"error", "MissingReference"))
            try std.testing.expectError(error.MissingReference, compute.executeJson(vector.compute, &inputs, allocator))
        else if (std.mem.eql(u8, vector.@"error", "ConditionTypeMismatch"))
            try std.testing.expectError(error.ConditionTypeMismatch, compute.executeJson(vector.compute, &inputs, allocator))
        else if (std.mem.eql(u8, vector.@"error", "EmptyPipe"))
            try std.testing.expectError(error.EmptyPipe, compute.executeJson(vector.compute, &inputs, allocator))
        else
            return error.InvalidVector;
    }
}
