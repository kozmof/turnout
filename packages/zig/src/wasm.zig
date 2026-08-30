const std = @import("std");
const builtin = @import("builtin");

const allocator = if (builtin.target.cpu.arch.isWasm())
    std.heap.wasm_allocator
else
    std.heap.page_allocator;

pub const abi_version: u16 = 1;
pub const response_magic: u32 = 0x4e525554;
pub const response_header_len: usize = 12;
pub const Status = enum(u16) {
    ok = 0,
    invalid_input = 1,
    invalid_handle = 2,
    runtime_error = 3,
    out_of_memory = 4,
    internal_error = 5,
};

pub const Response = struct {
    bytes: []u8,

    pub fn deinit(self: *Response) void {
        allocator.free(self.bytes);
        self.* = undefined;
    }
};

export fn turnout_abi_version() u32 {
    return abi_version;
}

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

pub fn makeResponse(status: Status, payload: []const u8) error{OutOfMemory}!Response {
    const total = std.math.add(usize, response_header_len, payload.len) catch
        return error.OutOfMemory;
    if (payload.len > std.math.maxInt(u32)) return error.OutOfMemory;
    const bytes = try allocator.alloc(u8, total);
    std.mem.writeInt(u32, bytes[0..4], response_magic, .little);
    std.mem.writeInt(u16, bytes[4..6], abi_version, .little);
    std.mem.writeInt(u16, bytes[6..8], @intFromEnum(status), .little);
    std.mem.writeInt(u32, bytes[8..12], @intCast(payload.len), .little);
    @memcpy(bytes[response_header_len..], payload);
    return .{ .bytes = bytes };
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

test "WASM response envelope is versioned and little endian" {
    var response = try makeResponse(.invalid_input, "{\"error\":\"bad request\"}");
    defer response.deinit();
    try std.testing.expectEqual(response_magic, std.mem.readInt(u32, response.bytes[0..4], .little));
    try std.testing.expectEqual(abi_version, std.mem.readInt(u16, response.bytes[4..6], .little));
    try std.testing.expectEqual(
        @intFromEnum(Status.invalid_input),
        std.mem.readInt(u16, response.bytes[6..8], .little),
    );
    const payload_len = std.mem.readInt(u32, response.bytes[8..12], .little);
    try std.testing.expectEqual(@as(u32, 23), payload_len);
    try std.testing.expectEqualStrings(
        "{\"error\":\"bad request\"}",
        response.bytes[response_header_len..],
    );
}
