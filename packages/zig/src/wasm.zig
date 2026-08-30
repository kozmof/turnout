const std = @import("std");
const builtin = @import("builtin");
const effect = @import("effect.zig");
const model_runtime = @import("model.zig");
const runtime = @import("runtime.zig");
const state_runtime = @import("state.zig");
const value = @import("value.zig");

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

const CreateRequest = struct {
    sceneId: []const u8,
    initialState: ?std.json.Value = null,
    failOnPublishError: bool = false,
    maxSceneSteps: usize = 10_000,
};

const Instance = struct {
    model: model_runtime.RuntimeModel,
    driver: runtime.SceneDriver,
    scene_id: []u8,
    fail_on_publish_error: bool,

    fn deinit(self: *Instance) void {
        self.driver.deinit();
        self.model.deinit();
        allocator.free(self.scene_id);
        allocator.destroy(self);
    }
};

var instances: std.AutoHashMapUnmanaged(u32, *Instance) = .empty;
var next_handle: u32 = 1;

fn bytesAt(address: usize, len: u32) []const u8 {
    if (len == 0) return &.{};
    const pointer: [*]const u8 = @ptrFromInt(address);
    return pointer[0..len];
}

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

fn responseAddress(status: Status, payload: []const u8) usize {
    const response = makeResponse(status, payload) catch return 0;
    return @intFromPtr(response.bytes.ptr);
}

fn jsonResponse(status: Status, payload: anytype) usize {
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    std.json.Stringify.value(payload, .{}, &output.writer) catch return 0;
    return responseAddress(status, output.written());
}

fn errorResponse(status: Status, code: []const u8) usize {
    return jsonResponse(status, .{ .@"error" = code });
}

fn runtimeError(err: anyerror) usize {
    return errorResponse(if (err == error.OutOfMemory) .out_of_memory else .runtime_error, @errorName(err));
}

fn putInitialValues(
    json: ?std.json.Value,
    values: *std.StringArrayHashMapUnmanaged(value.TaggedValue),
) !void {
    const initial = json orelse return;
    if (initial != .object) return error.InvalidInitialState;
    var fields = initial.object.iterator();
    while (fields.next()) |field| {
        const key = try allocator.dupe(u8, field.key_ptr.*);
        errdefer allocator.free(key);
        var converted = try value.fromJson(allocator, field.value_ptr.*);
        errdefer value.deinitValue(&converted, allocator);
        const tags = try allocator.alloc([]const u8, 0);
        errdefer allocator.free(tags);
        try values.put(allocator, key, .{ .value = converted, .tags = tags });
    }
}

fn deinitInitialValues(values: *std.StringArrayHashMapUnmanaged(value.TaggedValue)) void {
    var iterator = values.iterator();
    while (iterator.next()) |entry| {
        allocator.free(entry.key_ptr.*);
        value.deinitTaggedValue(entry.value_ptr, allocator);
    }
    values.deinit(allocator);
}

fn createInstance(model_bytes: []const u8, request_bytes: []const u8) !u32 {
    var request = try std.json.parseFromSlice(CreateRequest, allocator, request_bytes, .{
        .ignore_unknown_fields = true,
    });
    defer request.deinit();
    if (request.value.sceneId.len == 0) return error.InvalidSceneId;
    var model = try model_runtime.RuntimeModel.init(allocator, model_bytes, .{});
    errdefer model.deinit();
    var initial_values: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer deinitInitialValues(&initial_values);
    try putInitialValues(request.value.initialState, &initial_values);
    var initial_state = if (model.root().get("state")) |state_model|
        try state_runtime.State.initFromModel(state_model, &initial_values, allocator)
    else
        try state_runtime.State.initUnchecked(&initial_values, allocator);
    defer initial_state.deinit(allocator);
    const scene_id = try allocator.dupe(u8, request.value.sceneId);
    errdefer allocator.free(scene_id);
    const instance = try allocator.create(Instance);
    errdefer allocator.destroy(instance);
    instance.* = .{
        .model = model,
        .driver = try runtime.SceneDriver.initWithLimit(allocator, &model, scene_id, &initial_state, request.value.maxSceneSteps),
        .scene_id = scene_id,
        .fail_on_publish_error = request.value.failOnPublishError,
    };
    if (next_handle == 0) return error.HandleSpaceExhausted;
    const handle = next_handle;
    next_handle +%= 1;
    instances.put(allocator, handle, instance) catch |err| {
        instance.driver.deinit();
        return err;
    };
    return handle;
}

export fn turnout_runtime_create(model_address: usize, model_len: u32, request_address: usize, request_len: u32) usize {
    if (model_address == 0 or model_len == 0 or request_address == 0 or request_len == 0)
        return errorResponse(.invalid_input, "InvalidBuffer");
    const handle = createInstance(bytesAt(model_address, model_len), bytesAt(request_address, request_len)) catch |err|
        return if (err == error.OutOfMemory) errorResponse(.out_of_memory, @errorName(err)) else errorResponse(.invalid_input, @errorName(err));
    return jsonResponse(.ok, .{ .handle = handle });
}

export fn turnout_runtime_destroy(handle: u32) usize {
    const removed = instances.fetchRemove(handle) orelse return errorResponse(.invalid_handle, "InvalidHandle");
    removed.value.deinit();
    if (instances.count() == 0) {
        instances.deinit(allocator);
        instances = .empty;
    }
    return jsonResponse(.ok, .{ .destroyed = handle });
}

fn eventResponse(event: runtime.Event) usize {
    return switch (event) {
        .need_effect => |request| jsonResponse(.ok, .{ .event = "needEffect", .id = request.id, .kind = @tagName(request.kind), .hook = request.hook, .sceneId = request.scene_id, .actionId = request.action_id, .callbackIndex = request.callback_index, .binding = request.binding, .contextJson = request.context_json }),
        .action_complete => |completed| jsonResponse(.ok, .{ .event = "actionComplete", .sceneId = completed.scene_id, .actionId = completed.action_id }),
        .scene_changed => |changed| jsonResponse(.ok, .{ .event = "sceneChanged", .from = changed.from, .to = changed.to }),
        .complete => jsonResponse(.ok, .{ .event = "complete" }),
        .cancelled => jsonResponse(.ok, .{ .event = "cancelled" }),
    };
}

export fn turnout_runtime_step(handle: u32) usize {
    const instance = instances.get(handle) orelse return errorResponse(.invalid_handle, "InvalidHandle");
    const event = instance.driver.step(&instance.model, instance.fail_on_publish_error) catch |err| return runtimeError(err);
    return eventResponse(event);
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

const DecodedEffectResult = struct {
    id: u64,
    result: effect.Result,
    parsed: std.json.Parsed(std.json.Value),
    payload: ?[]u8,

    fn deinit(self: *DecodedEffectResult) void {
        self.parsed.deinit();
        if (self.payload) |payload| allocator.free(payload);
        self.* = undefined;
    }
};

fn parseEffectResult(bytes: []const u8) !DecodedEffectResult {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, bytes, .{});
    errdefer parsed.deinit();
    if (parsed.value != .object) return error.InvalidEffectResult;
    const object = parsed.value.object;
    const id_value = object.get("id") orelse return error.InvalidEffectResult;
    const kind_value = object.get("kind") orelse return error.InvalidEffectResult;
    const status_value = object.get("status") orelse return error.InvalidEffectResult;
    if (id_value != .integer or id_value.integer < 0 or kind_value != .string or status_value != .string)
        return error.InvalidEffectResult;
    const id: u64 = @intCast(id_value.integer);
    var payload: ?[]u8 = null;
    errdefer if (payload) |owned| allocator.free(owned);
    const result: effect.Result = if (std.mem.eql(u8, kind_value.string, "prepare")) .{
        .prepare = if (std.mem.eql(u8, status_value.string, "ok")) blk: {
            const result_value = object.get("value") orelse return error.InvalidEffectResult;
            var output: std.Io.Writer.Allocating = .init(allocator);
            errdefer output.deinit();
            try std.json.Stringify.value(result_value, .{}, &output.writer);
            payload = try output.toOwnedSlice();
            break :blk .{ .ok = payload.? };
        } else if (std.mem.eql(u8, status_value.string, "missing"))
            .missing
        else if (std.mem.eql(u8, status_value.string, "failed")) blk: {
            const message = object.get("message") orelse return error.InvalidEffectResult;
            if (message != .string) return error.InvalidEffectResult;
            break :blk .{ .failed = message.string };
        } else return error.InvalidEffectResult,
    } else if (std.mem.eql(u8, kind_value.string, "publish")) .{
        .publish = if (std.mem.eql(u8, status_value.string, "ok"))
            .ok
        else if (std.mem.eql(u8, status_value.string, "missing"))
            .missing
        else if (std.mem.eql(u8, status_value.string, "failed")) blk: {
            const message = object.get("message") orelse return error.InvalidEffectResult;
            const source = object.get("source") orelse return error.InvalidEffectResult;
            if (message != .string or source != .string) return error.InvalidEffectResult;
            break :blk .{ .failed = .{
                .source = if (std.mem.eql(u8, source.string, "returned"))
                    .returned
                else if (std.mem.eql(u8, source.string, "thrown"))
                    .thrown
                else
                    return error.InvalidEffectResult,
                .message = message.string,
            } };
        } else return error.InvalidEffectResult,
    } else return error.InvalidEffectResult;
    return .{ .id = id, .result = result, .parsed = parsed, .payload = payload };
}

export fn turnout_runtime_resume(handle: u32, address: usize, len: u32) usize {
    const instance = instances.get(handle) orelse return errorResponse(.invalid_handle, "InvalidHandle");
    if (address == 0 or len == 0) return errorResponse(.invalid_input, "InvalidBuffer");
    var decoded = parseEffectResult(bytesAt(address, len)) catch |err|
        return if (err == error.OutOfMemory) errorResponse(.out_of_memory, @errorName(err)) else errorResponse(.invalid_input, @errorName(err));
    defer decoded.deinit();
    instance.driver.@"resume"(decoded.id, decoded.result) catch |err| return runtimeError(err);
    return jsonResponse(.ok, .{ .resumed = decoded.id });
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

fn responseSlice(address: usize) []u8 {
    const pointer: [*]u8 = @ptrFromInt(address);
    const payload_len = std.mem.readInt(u32, pointer[8..12], .little);
    return pointer[0 .. response_header_len + payload_len];
}

fn freeResponse(address: usize) void {
    const bytes = responseSlice(address);
    turnout_free(address, @intCast(bytes.len));
}

fn expectResponse(address: usize, status: Status, event: ?[]const u8) !std.json.Parsed(std.json.Value) {
    try std.testing.expect(address != 0);
    const bytes = responseSlice(address);
    try std.testing.expectEqual(@intFromEnum(status), std.mem.readInt(u16, bytes[6..8], .little));
    const parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, bytes[response_header_len..], .{});
    if (event) |wanted| {
        const actual = parsed.value.object.get("event") orelse return error.MissingEvent;
        try std.testing.expectEqualStrings(wanted, actual.string);
    }
    return parsed;
}

test "WASM lifecycle creates steps resumes and destroys a runtime" {
    const model =
        \\{"version":2,"scenes":[{"id":"main","entryAction":"start","actions":[{"id":"start","prepare":[{"binding":"input","fromHook":"load"}],"compute":{"root":"result","prog":{"bindings":[{"name":"input","type":"number"},{"name":"result","type":"number","expr":{"combine":{"fn":"add","args":[{"ref":"input"},{"lit":2}]}}}]}},"merge":[{"binding":"result","toState":"result.value"}],"publish":["save"]}]}]}
    ;
    const config =
        \\{"sceneId":"main","initialState":{}}
    ;
    const created_address = turnout_runtime_create(@intFromPtr(model.ptr), model.len, @intFromPtr(config.ptr), config.len);
    defer freeResponse(created_address);
    var created = try expectResponse(created_address, .ok, null);
    defer created.deinit();
    const handle: u32 = @intCast(created.value.object.get("handle").?.integer);

    const prepare_address = turnout_runtime_step(handle);
    defer freeResponse(prepare_address);
    var prepare = try expectResponse(prepare_address, .ok, "needEffect");
    defer prepare.deinit();
    try std.testing.expectEqualStrings("prepare", prepare.value.object.get("kind").?.string);
    const prepare_id = prepare.value.object.get("id").?.integer;

    const prepare_result = try std.fmt.allocPrint(std.testing.allocator, "{{\"id\":{d},\"kind\":\"prepare\",\"status\":\"ok\",\"value\":{{\"input\":{{\"symbol\":\"number\",\"value\":5,\"tags\":[]}}}}}}", .{prepare_id});
    defer std.testing.allocator.free(prepare_result);
    const resumed_prepare_address = turnout_runtime_resume(handle, @intFromPtr(prepare_result.ptr), @intCast(prepare_result.len));
    defer freeResponse(resumed_prepare_address);
    var resumed_prepare = try expectResponse(resumed_prepare_address, .ok, null);
    defer resumed_prepare.deinit();

    const publish_address = turnout_runtime_step(handle);
    defer freeResponse(publish_address);
    var publish = try expectResponse(publish_address, .ok, "needEffect");
    defer publish.deinit();
    try std.testing.expectEqualStrings("publish", publish.value.object.get("kind").?.string);
    const publish_id = publish.value.object.get("id").?.integer;

    const publish_result = try std.fmt.allocPrint(std.testing.allocator, "{{\"id\":{d},\"kind\":\"publish\",\"status\":\"ok\"}}", .{publish_id});
    defer std.testing.allocator.free(publish_result);
    const resumed_publish_address = turnout_runtime_resume(handle, @intFromPtr(publish_result.ptr), @intCast(publish_result.len));
    defer freeResponse(resumed_publish_address);
    var resumed_publish = try expectResponse(resumed_publish_address, .ok, null);
    defer resumed_publish.deinit();

    const action_address = turnout_runtime_step(handle);
    defer freeResponse(action_address);
    var action = try expectResponse(action_address, .ok, "actionComplete");
    defer action.deinit();
    const complete_address = turnout_runtime_step(handle);
    defer freeResponse(complete_address);
    var complete = try expectResponse(complete_address, .ok, "complete");
    defer complete.deinit();

    const destroyed_address = turnout_runtime_destroy(handle);
    defer freeResponse(destroyed_address);
    var destroyed = try expectResponse(destroyed_address, .ok, null);
    defer destroyed.deinit();
    const stale_address = turnout_runtime_step(handle);
    defer freeResponse(stale_address);
    var stale = try expectResponse(stale_address, .invalid_handle, null);
    defer stale.deinit();
}

test "WASM lifecycle rejects malformed creation input" {
    const invalid = "{}";
    const config =
        \\{"sceneId":"main"}
    ;
    const address = turnout_runtime_create(@intFromPtr(invalid.ptr), invalid.len, @intFromPtr(config.ptr), config.len);
    defer freeResponse(address);
    var response = try expectResponse(address, .invalid_input, null);
    defer response.deinit();
}
