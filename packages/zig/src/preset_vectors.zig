const std = @import("std");
const preset = @import("preset.zig");
const value = @import("value.zig");

const Input = struct { value: std.json.Value, tags: []const []const u8 };
const Vector = struct {
    name: []const u8,
    function: []const u8,
    inputs: []const Input,
    output: Input,
};

test "shared preset vectors" {
    const allocator = std.testing.allocator;
    const parsed = try std.json.parseFromSlice(
        []Vector,
        allocator,
        @embedFile("fixtures/preset-vectors.json"),
        .{ .ignore_unknown_fields = false },
    );
    defer parsed.deinit();
    for (parsed.value) |vector| {
        var inputs = std.ArrayList(value.OwnedTaggedValue).empty;
        defer {
            for (inputs.items) |*input| input.deinit(allocator);
            inputs.deinit(allocator);
        }
        var borrowed = std.ArrayList(value.TaggedValue).empty;
        defer borrowed.deinit(allocator);
        for (vector.inputs) |input| {
            var json_value = try value.fromJson(allocator, input.value);
            defer value.deinitValue(&json_value, allocator);
            try inputs.append(allocator, try value.build(json_value, input.tags, allocator));
            try borrowed.append(allocator, inputs.items[inputs.items.len - 1].borrowed());
        }
        var result = try preset.call(vector.function, borrowed.items, allocator);
        defer result.deinit(allocator);
        var expected = try value.fromJson(allocator, vector.output.value);
        defer value.deinitValue(&expected, allocator);
        if (!result.value.eql(expected)) {
            std.debug.print("shared preset vector failed: {s}\n", .{vector.name});
            return error.TestExpectedEqual;
        }
        try std.testing.expectEqual(vector.output.tags.len, result.tags.len);
        for (vector.output.tags, result.tags) |expected_tag, actual_tag| {
            try std.testing.expectEqualStrings(expected_tag, actual_tag);
        }
    }
}
