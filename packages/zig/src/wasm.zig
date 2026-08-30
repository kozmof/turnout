const std = @import("std");
const builtin = @import("builtin");

const allocator = if (builtin.target.cpu.arch.isWasm())
    std.heap.wasm_allocator
else
    std.heap.page_allocator;

export fn turnout_alloc(len: u32) usize {
    if (len == 0) return 0;
    const bytes = allocator.alloc(u8, len) catch return 0;
    return @intFromPtr(bytes.ptr);
}

export fn turnout_free(address: usize, len: u32) void {
    if (address == 0 or len == 0) return;
    const pointer: [*]u8 = @ptrFromInt(address);
    allocator.free(pointer[0..len]);
}

test "WASM ABI allocation round trips bytes" {
    const address = turnout_alloc(4);
    try std.testing.expect(address != 0);
    const bytes: *[4]u8 = @ptrFromInt(address);
    bytes.* = .{ 1, 2, 3, 4 };
    try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3, 4 }, bytes);
    turnout_free(address, 4);
    turnout_free(0, 0);
}
