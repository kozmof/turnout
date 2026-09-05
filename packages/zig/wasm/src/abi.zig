const std = @import("std");
const builtin = @import("builtin");
const compute = @import("turnout_runtime").compute;
const graph_compute = @import("turnout_runtime").graph_compute;
const graph_validate = @import("turnout_runtime").graph_validate;
const effect = @import("turnout_scene_runner").effect;
const model_runtime = @import("turnout_scene_runner").model;
const preset = @import("turnout_runtime").preset;
const runtime = @import("turnout_scene_runner").runner;
const state_runtime = @import("turnout_scene_runner").state;
const value = @import("turnout_runtime").value;

const NativeAllocator = if (builtin.target.cpu.arch.isWasm()) struct {} else std.heap.DebugAllocator(.{});
var native_allocator: NativeAllocator = if (builtin.target.cpu.arch.isWasm()) .{} else .init;
const allocator = if (builtin.target.cpu.arch.isWasm()) std.heap.wasm_allocator else native_allocator.allocator();

pub const abi_version: u16 = 1;
pub const response_magic: u32 = 0x4e525554;
pub const response_header_len: usize = 12;
pub const max_create_request_bytes: usize = 16 * 1024 * 1024;
pub const max_effect_result_bytes: usize = 16 * 1024 * 1024;
pub const max_compute_request_bytes: usize = 16 * 1024 * 1024;
pub const max_value_request_bytes: usize = 16 * 1024 * 1024;
pub const max_input_nesting: usize = 128;

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
    sceneId: ?[]const u8 = null,
    routeId: ?[]const u8 = null,
    initialState: ?std.json.Value = null,
    failOnPublishError: bool = false,
    maxSceneSteps: usize = 10_000,
    maxRouteTransitions: usize = 1_000,
};

const Driver = union(enum) {
    scene: runtime.SceneDriver,
    route: runtime.RouteDriver,

    fn deinit(self: *Driver) void {
        switch (self.*) {
            inline else => |*driver| driver.deinit(),
        }
    }

    fn step(self: *Driver, model: *const model_runtime.RuntimeModel, fail_on_publish_error: bool) !runtime.Event {
        return switch (self.*) {
            inline else => |*driver| driver.step(model, fail_on_publish_error),
        };
    }

    fn @"resume"(self: *Driver, id: u64, result: effect.Result) runtime.RuntimeError!void {
        return switch (self.*) {
            inline else => |*driver| driver.@"resume"(id, result),
        };
    }

    fn partialState(self: *const Driver) *const state_runtime.State {
        return switch (self.*) {
            inline else => |*driver| driver.partialState(),
        };
    }

    fn isDone(self: *const Driver) bool {
        return switch (self.*) {
            .scene => |driver| driver.finished,
            .route => |driver| driver.finished,
        };
    }
};

const Instance = struct {
    request: std.json.Parsed(CreateRequest),
    model: model_runtime.RuntimeModel,
    driver: Driver,
    entry_id: []u8,
    fail_on_publish_error: bool,

    fn deinit(self: *Instance) void {
        self.driver.deinit();
        self.model.deinit();
        self.request.deinit();
        allocator.free(self.entry_id);
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

// Handles three request shapes: a graph-context validation, a graph-context
// execution, and a compiler prog execution. The first two carry the graph
// format the TypeScript builder produces; the third carries the compiler's
// bindings. "validateLegacy" is the wire name for the first and is fixed by
// ABI version 1 — the modules behind it are named graph_* .
fn computeResponse(bytes: []const u8) !Response {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, bytes, .{});
    defer parsed.deinit();
    try validateInputNesting(parsed.value, 0);
    if (parsed.value != .object) return error.InvalidComputeRequest;
    if (parsed.value.object.get("operation")) |operation| {
        if (operation != .string or !std.mem.eql(u8, operation.string, "validateLegacy")) return error.InvalidComputeRequest;
        const context = parsed.value.object.get("context") orelse return error.InvalidComputeRequest;
        var result = try graph_validate.validate(context, allocator);
        defer result.deinit(allocator);
        var output: std.Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        try std.json.Stringify.value(result, .{}, &output.writer);
        return makeResponse(.ok, output.written());
    }
    if (parsed.value.object.get("context")) |context| {
        const root_func_id = parsed.value.object.get("rootFuncId") orelse return error.InvalidComputeRequest;
        if (root_func_id != .string) return error.InvalidComputeRequest;
        var result = try graph_compute.execute(context, root_func_id.string, allocator);
        defer result.deinit(allocator);
        var output: std.Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        var writer: std.json.Stringify = .{ .writer = &output.writer, .options = .{} };
        try writer.beginObject();
        try writer.objectField("value");
        try writer.write(value.CanonicalTagged{ .tagged = result.root.borrowed() });
        try writer.objectField("updatedValueTable");
        try writer.beginObject();
        var values = result.values.iterator();
        while (values.next()) |entry| {
            try writer.objectField(entry.key_ptr.*);
            try writer.write(value.CanonicalTagged{ .tagged = entry.value_ptr.borrowed() });
        }
        try writer.endObject();
        try writer.endObject();
        return makeResponse(.ok, output.written());
    }
    const program = parsed.value.object.get("prog") orelse return error.InvalidComputeRequest;
    const root = parsed.value.object.get("root") orelse return error.InvalidComputeRequest;
    const raw_inputs = parsed.value.object.get("inputs") orelse return error.InvalidComputeRequest;
    if (root != .string or raw_inputs != .object) return error.InvalidComputeRequest;

    var inputs: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer deinitInitialValues(&inputs);
    var iterator = raw_inputs.object.iterator();
    while (iterator.next()) |entry| {
        const key = try allocator.dupe(u8, entry.key_ptr.*);
        errdefer allocator.free(key);
        const converted = try value.fromCanonicalValue(entry.value_ptr.*, allocator);
        errdefer {
            var borrowed = converted.borrowed();
            value.deinitTaggedValue(&borrowed, allocator);
        }
        try inputs.put(allocator, key, converted.borrowed());
    }

    var result = try compute.executeProgramWithBindings(program, root.string, &inputs, allocator);
    defer result.deinit(allocator);
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    var writer: std.json.Stringify = .{ .writer = &output.writer, .options = .{} };
    try writer.beginObject();
    try writer.objectField("value");
    try writer.write(value.CanonicalTagged{ .tagged = result.root.borrowed() });
    try writer.objectField("bindings");
    try writer.beginObject();
    var bindings = result.bindings.iterator();
    while (bindings.next()) |entry| {
        try writer.objectField(entry.key_ptr.*);
        try writer.write(value.CanonicalTagged{ .tagged = entry.value_ptr.borrowed() });
    }
    try writer.endObject();
    try writer.endObject();
    return makeResponse(.ok, output.written());
}

export fn turnout_compute_execute(address: usize, len: u32) usize {
    if (address == 0 or len == 0) return errorResponse(.invalid_input, "InvalidBuffer");
    if (len > max_compute_request_bytes) return errorResponse(.invalid_input, "ComputeRequestTooLarge");
    const response = computeResponse(bytesAt(address, len)) catch |err|
        return if (err == error.OutOfMemory)
            errorResponse(.out_of_memory, @errorName(err))
        else
            errorResponse(.runtime_error, @errorName(err));
    return @intFromPtr(response.bytes.ptr);
}

fn valueResponse(bytes: []const u8) !Response {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, bytes, .{});
    defer parsed.deinit();
    try validateInputNesting(parsed.value, 0);
    if (parsed.value != .object) return error.InvalidValueRequest;
    const operation = parsed.value.object.get("operation") orelse return error.InvalidValueRequest;
    if (operation != .string) return error.InvalidValueRequest;

    if (std.mem.eql(u8, operation.string, "predicate")) {
        const raw = parsed.value.object.get("value") orelse return error.InvalidValueRequest;
        const predicate = parsed.value.object.get("predicate") orelse return error.InvalidValueRequest;
        if (predicate != .string) return error.InvalidValueRequest;
        var decoded = try value.fromCanonicalValue(raw, allocator);
        defer decoded.deinit(allocator);
        const matches = try valuePredicate(
            decoded.borrowed(),
            predicate.string,
            parsed.value.object.get("argument"),
        );
        var output: std.Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        try std.json.Stringify.value(.{ .matches = matches }, .{}, &output.writer);
        return makeResponse(.ok, output.written());
    }

    if (std.mem.eql(u8, operation.string, "statePathValid")) {
        const path = parsed.value.object.get("path") orelse return error.InvalidValueRequest;
        if (path != .string) return error.InvalidValueRequest;
        try state_runtime.validatePath(path.string);
        return jsonResponseValue(.{ .valid = true });
    }

    if (std.mem.eql(u8, operation.string, "schemaMatches")) {
        const raw = parsed.value.object.get("value") orelse return error.InvalidValueRequest;
        const schema_type = parsed.value.object.get("schemaType") orelse return error.InvalidValueRequest;
        if (schema_type != .string) return error.InvalidValueRequest;
        var decoded = try value.fromCanonicalValue(raw, allocator);
        defer decoded.deinit(allocator);
        const matches = try state_runtime.matchesSchemaType(decoded.value, schema_type.string);
        return jsonResponseValue(.{ .matches = matches });
    }

    if (std.mem.eql(u8, operation.string, "literalToValue")) {
        const raw = parsed.value.object.get("value") orelse return error.InvalidValueRequest;
        const schema_type = parsed.value.object.get("schemaType") orelse return error.InvalidValueRequest;
        if (schema_type != .string) return error.InvalidValueRequest;
        var result = try state_runtime.literalToValue(raw, schema_type.string, allocator);
        defer result.deinit(allocator);
        const payload = try value.canonicalJson(result.borrowed(), allocator);
        defer allocator.free(payload);
        return makeResponse(.ok, payload);
    }

    if (std.mem.eql(u8, operation.string, "metadata")) {
        const name = parsed.value.object.get("name") orelse return error.InvalidValueRequest;
        if (name != .string) return error.InvalidValueRequest;
        const known = blk: {
            var probe = preset.call(name.string, &.{}, allocator) catch |err|
                break :blk err != error.UnknownFunction;
            probe.deinit(allocator);
            break :blk true;
        };
        if (!known) return jsonResponseValue(.{
            .inputType = @as(?[]const u8, null),
            .parameterType = @as(?[]const u8, null),
            .returnType = @as(?[]const u8, null),
            .arity = @as(?usize, null),
        });
        const element = if (parsed.value.object.get("elementType")) |raw| blk: {
            if (raw != .string) return error.InvalidValueRequest;
            break :blk raw.string;
        } else null;
        const output_type = preset.returnType(name.string, element);
        const input_type = preset.inputType(name.string);
        const parameter_type = preset.parameterType(name.string);
        return jsonResponseValue(.{
            .inputType = input_type,
            .parameterType = parameter_type,
            .returnType = output_type,
            .arity = preset.arity(name.string),
        });
    }

    if (std.mem.eql(u8, operation.string, "passTransform")) {
        const type_symbol = parsed.value.object.get("type") orelse return error.InvalidValueRequest;
        if (type_symbol != .string) return error.InvalidValueRequest;
        return jsonResponseValue(.{ .name = preset.passTransform(type_symbol.string) });
    }

    if (std.mem.eql(u8, operation.string, "infer")) {
        const query = parsed.value.object.get("query") orelse return error.InvalidValueRequest;
        const context = parsed.value.object.get("context") orelse return error.InvalidValueRequest;
        if (query != .string or context != .object) return error.InvalidValueRequest;

        // Batched form: infer every listed function against one context. Returns
        // types positionally so the host zips them back onto the ids it sent.
        if (std.mem.eql(u8, query.string, "functions")) {
            const ids = parsed.value.object.get("ids") orelse return error.InvalidValueRequest;
            if (ids != .array) return error.InvalidValueRequest;
            const types = try allocator.alloc(?[]const u8, ids.array.items.len);
            defer allocator.free(types);
            for (ids.array.items, types) |item, *slot| {
                if (item != .string) return error.InvalidValueRequest;
                var visited_functions: std.StringHashMapUnmanaged(void) = .empty;
                defer visited_functions.deinit(allocator);
                var visited_pipes: std.StringHashMapUnmanaged(void) = .empty;
                defer visited_pipes.deinit(allocator);
                slot.* = try inferFunctionType(context, item.string, &visited_functions, &visited_pipes);
            }
            return jsonResponseValue(.{ .types = types });
        }

        const id = parsed.value.object.get("id") orelse return error.InvalidValueRequest;
        if (id != .string) return error.InvalidValueRequest;
        const inferred = if (std.mem.eql(u8, query.string, "value"))
            inferValueType(context, id.string)
        else if (std.mem.eql(u8, query.string, "element"))
            inferValueElementType(context, id.string)
        else if (std.mem.eql(u8, query.string, "combine"))
            try inferCombineType(context, id.string)
        else if (std.mem.eql(u8, query.string, "function")) blk: {
            var visited_functions: std.StringHashMapUnmanaged(void) = .empty;
            defer visited_functions.deinit(allocator);
            var visited_pipes: std.StringHashMapUnmanaged(void) = .empty;
            defer visited_pipes.deinit(allocator);
            break :blk try inferFunctionType(context, id.string, &visited_functions, &visited_pipes);
        } else return error.InvalidValueRequest;
        return jsonResponseValue(.{ .type = inferred });
    }

    var result = if (std.mem.eql(u8, operation.string, "normalize")) blk: {
        const raw = parsed.value.object.get("value") orelse return error.InvalidValueRequest;
        var decoded = try value.fromCanonicalValue(raw, allocator);
        defer decoded.deinit(allocator);
        break :blk try value.build(decoded.value, decoded.tags, allocator);
    } else if (std.mem.eql(u8, operation.string, "derive")) blk: {
        const raw = parsed.value.object.get("value") orelse return error.InvalidValueRequest;
        const raw_sources = parsed.value.object.get("sources") orelse return error.InvalidValueRequest;
        if (raw_sources != .array) return error.InvalidValueRequest;
        var decoded = try value.fromCanonicalValue(raw, allocator);
        defer decoded.deinit(allocator);
        var tags = try value.mergeTags(decoded.tags, &.{}, allocator);
        defer allocator.free(tags);
        for (raw_sources.array.items) |source| {
            var parsed_source = try value.fromCanonicalValue(source, allocator);
            defer parsed_source.deinit(allocator);
            const merged = try value.mergeTags(tags, parsed_source.tags, allocator);
            allocator.free(tags);
            tags = merged;
        }
        break :blk try value.build(decoded.value, tags, allocator);
    } else if (std.mem.eql(u8, operation.string, "preset")) blk: {
        const name = parsed.value.object.get("name") orelse return error.InvalidValueRequest;
        const raw_args = parsed.value.object.get("args") orelse return error.InvalidValueRequest;
        if (name != .string or raw_args != .array) return error.InvalidValueRequest;
        var owned = std.ArrayList(value.OwnedTaggedValue).empty;
        defer {
            for (owned.items) |*item| item.deinit(allocator);
            owned.deinit(allocator);
        }
        var args = std.ArrayList(value.TaggedValue).empty;
        defer args.deinit(allocator);
        for (raw_args.array.items) |raw| {
            try owned.ensureUnusedCapacity(allocator, 1);
            owned.appendAssumeCapacity(try value.fromCanonicalValue(raw, allocator));
            try args.append(allocator, owned.items[owned.items.len - 1].borrowed());
        }
        break :blk try preset.call(name.string, args.items, allocator);
    } else return error.InvalidValueRequest;
    defer result.deinit(allocator);
    const payload = try value.canonicalJson(result.borrowed(), allocator);
    defer allocator.free(payload);
    return makeResponse(.ok, payload);
}

fn contextTable(context: std.json.Value, name: []const u8) ?std.json.ObjectMap {
    const table = context.object.get(name) orelse return null;
    return if (table == .object) table.object else null;
}

fn inferValueType(context: std.json.Value, id: []const u8) ?[]const u8 {
    const table = contextTable(context, "valueTable") orelse return null;
    const item = table.get(id) orelse return null;
    if (item != .object) return null;
    const symbol = item.object.get("symbol") orelse return null;
    return if (symbol == .string) symbol.string else null;
}

fn inferValueElementType(context: std.json.Value, id: []const u8) ?[]const u8 {
    const table = contextTable(context, "valueTable") orelse return null;
    const item = table.get(id) orelse return null;
    if (item != .object) return null;
    const symbol = item.object.get("symbol") orelse return null;
    if (symbol != .string or !std.mem.eql(u8, symbol.string, "array")) return null;
    if (item.object.get("subSymbol")) |sub_symbol|
        if (sub_symbol == .string) return sub_symbol.string;
    const items = item.object.get("value") orelse return null;
    if (items != .array or items.array.items.len == 0 or items.array.items[0] != .object) return null;
    const first_symbol = items.array.items[0].object.get("symbol") orelse return null;
    return if (first_symbol == .string) first_symbol.string else null;
}

fn inferCombineType(context: std.json.Value, id: []const u8) !?[]const u8 {
    const table = contextTable(context, "combineFuncDefTable") orelse return null;
    const definition = table.get(id) orelse return null;
    if (definition != .object) return null;
    const name = definition.object.get("name") orelse return null;
    if (name != .string) return null;
    var probe = preset.call(name.string, &.{}, allocator) catch |err| switch (err) {
        error.UnknownFunction => return null,
        else => return preset.returnType(name.string, null),
    };
    probe.deinit(allocator);
    return preset.returnType(name.string, null);
}

fn inferFunctionType(
    context: std.json.Value,
    id: []const u8,
    visited_functions: *std.StringHashMapUnmanaged(void),
    visited_pipes: *std.StringHashMapUnmanaged(void),
) !?[]const u8 {
    if (visited_functions.contains(id)) return null;
    try visited_functions.put(allocator, id, {});
    defer _ = visited_functions.remove(id);
    const functions = contextTable(context, "funcTable") orelse return null;
    const entry = functions.get(id) orelse return null;
    if (entry != .object) return null;
    const kind = entry.object.get("kind") orelse return null;
    const definition_id = entry.object.get("defId") orelse return null;
    if (kind != .string or definition_id != .string) return null;
    if (std.mem.eql(u8, kind.string, "combine")) return try inferCombineType(context, definition_id.string);
    if (std.mem.eql(u8, kind.string, "pipe"))
        return inferPipeType(context, definition_id.string, visited_pipes);
    if (!std.mem.eql(u8, kind.string, "cond")) return null;
    const definitions = contextTable(context, "condFuncDefTable") orelse return null;
    const definition = definitions.get(definition_id.string) orelse return null;
    if (definition != .object) return null;
    const true_id = definition.object.get("trueBranchId") orelse return null;
    const false_id = definition.object.get("falseBranchId") orelse return null;
    if (true_id != .string or false_id != .string) return null;
    const true_type = try inferFunctionType(context, true_id.string, visited_functions, visited_pipes) orelse return null;
    const false_type = try inferFunctionType(context, false_id.string, visited_functions, visited_pipes) orelse return null;
    return if (std.mem.eql(u8, true_type, false_type)) true_type else null;
}

fn inferPipeType(
    context: std.json.Value,
    id: []const u8,
    visited: *std.StringHashMapUnmanaged(void),
) !?[]const u8 {
    if (visited.contains(id)) return null;
    try visited.put(allocator, id, {});
    defer _ = visited.remove(id);
    const pipes = contextTable(context, "pipeFuncDefTable") orelse return null;
    const definition = pipes.get(id) orelse return null;
    if (definition != .object) return null;
    const sequence = definition.object.get("sequence") orelse return null;
    if (sequence != .array or sequence.array.items.len == 0) return null;
    const last = sequence.array.items[sequence.array.items.len - 1];
    if (last != .object) return null;
    const definition_id = last.object.get("defId") orelse return null;
    if (definition_id != .string) return null;
    if (contextTable(context, "combineFuncDefTable")) |combines|
        if (combines.contains(definition_id.string)) return try inferCombineType(context, definition_id.string);
    if (pipes.contains(definition_id.string)) return inferPipeType(context, definition_id.string, visited);
    return null;
}

fn jsonResponseValue(payload: anytype) !Response {
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try std.json.Stringify.value(payload, .{}, &output.writer);
    return makeResponse(.ok, output.written());
}

fn valuePredicate(tagged: value.TaggedValue, predicate: []const u8, argument: ?std.json.Value) !bool {
    if (std.mem.eql(u8, predicate, "number")) return tagged.value == .number;
    if (std.mem.eql(u8, predicate, "string")) return tagged.value == .string;
    if (std.mem.eql(u8, predicate, "boolean")) return tagged.value == .boolean;
    if (std.mem.eql(u8, predicate, "null")) return tagged.value == .null_value;
    if (std.mem.eql(u8, predicate, "array")) return tagged.value == .array;
    if (std.mem.eql(u8, predicate, "record")) return tagged.value == .record;
    if (std.mem.eql(u8, predicate, "typedArray"))
        return tagged.value == .array and tagged.value.array.element != .untyped;
    if (std.mem.eql(u8, predicate, "pure")) return value.isPure(tagged);
    if (std.mem.eql(u8, predicate, "hasTag")) {
        const tag = argument orelse return error.InvalidValueRequest;
        if (tag != .string) return error.InvalidValueRequest;
        return value.hasTag(tagged, tag.string);
    }
    if (std.mem.eql(u8, predicate, "valid")) {
        const expected = argument orelse return true;
        if (expected != .object) return error.InvalidValueRequest;
        if (expected.object.get("symbol")) |symbol| {
            if (symbol != .string or !valueHasSymbol(tagged.value, symbol.string)) return false;
        }
        if (expected.object.get("subSymbol")) |sub_symbol| {
            if (sub_symbol != .string or !valueHasSubSymbol(tagged.value, sub_symbol.string)) return false;
        }
        return true;
    }
    return error.InvalidValueRequest;
}

fn valueHasSymbol(input: value.Value, symbol: []const u8) bool {
    if (std.mem.eql(u8, symbol, "number")) return input == .number;
    if (std.mem.eql(u8, symbol, "string")) return input == .string;
    if (std.mem.eql(u8, symbol, "boolean")) return input == .boolean;
    if (std.mem.eql(u8, symbol, "null")) return input == .null_value;
    if (std.mem.eql(u8, symbol, "array")) return input == .array;
    if (std.mem.eql(u8, symbol, "record")) return input == .record;
    return false;
}

fn valueHasSubSymbol(input: value.Value, sub_symbol: []const u8) bool {
    return switch (input) {
        .null_value => |reason| std.mem.eql(u8, sub_symbol, if (reason == .not_found) "not-found" else @tagName(reason)),
        .array => |array| switch (array.element) {
            .untyped => false,
            .number => std.mem.eql(u8, sub_symbol, "number"),
            .string => std.mem.eql(u8, sub_symbol, "string"),
            .boolean => std.mem.eql(u8, sub_symbol, "boolean"),
            .null_value => std.mem.eql(u8, sub_symbol, "null"),
        },
        else => false,
    };
}

export fn turnout_value_operate(address: usize, len: u32) usize {
    if (address == 0 or len == 0) return errorResponse(.invalid_input, "InvalidBuffer");
    if (len > max_value_request_bytes) return errorResponse(.invalid_input, "ValueRequestTooLarge");
    const response = valueResponse(bytesAt(address, len)) catch |err|
        return if (err == error.OutOfMemory)
            errorResponse(.out_of_memory, @errorName(err))
        else
            errorResponse(.runtime_error, @errorName(err));
    return @intFromPtr(response.bytes.ptr);
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
        const converted = value.fromCanonicalValue(field.value_ptr.*, allocator) catch
            return error.InvalidInitialState;
        errdefer {
            var borrowed = converted.borrowed();
            value.deinitTaggedValue(&borrowed, allocator);
        }
        try values.put(allocator, key, converted.borrowed());
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

fn validateInputNesting(json: std.json.Value, depth: usize) !void {
    if (depth > max_input_nesting) return error.InputTooDeep;
    switch (json) {
        .object => |object| {
            var fields = object.iterator();
            while (fields.next()) |field| try validateInputNesting(field.value_ptr.*, depth + 1);
        },
        .array => |array| for (array.items) |item| try validateInputNesting(item, depth + 1),
        else => {},
    }
}

fn createInstance(model_bytes: []const u8, request_bytes: []const u8) !u32 {
    if (request_bytes.len > max_create_request_bytes) return error.InitialStateTooLarge;
    var request = try std.json.parseFromSlice(CreateRequest, allocator, request_bytes, .{
        .ignore_unknown_fields = true,
        .max_value_len = max_create_request_bytes,
    });
    var request_transferred = false;
    defer if (!request_transferred) request.deinit();
    try validateInputNesting(request.value.initialState orelse .null, 0);
    if ((request.value.sceneId == null) == (request.value.routeId == null)) return error.InvalidEntryId;
    const entry = request.value.sceneId orelse request.value.routeId.?;
    if (entry.len == 0) return error.InvalidEntryId;
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
    const entry_id = try allocator.dupe(u8, entry);
    errdefer allocator.free(entry_id);
    const instance = try allocator.create(Instance);
    errdefer allocator.destroy(instance);
    instance.* = .{
        .request = request,
        .model = model,
        .driver = if (request.value.sceneId != null)
            .{ .scene = try runtime.SceneDriver.initWithLimit(allocator, &model, entry_id, &initial_state, request.value.maxSceneSteps) }
        else
            .{ .route = try runtime.RouteDriver.init(allocator, &model, entry_id, &initial_state, request.value.maxSceneSteps, request.value.maxRouteTransitions) },
        .entry_id = entry_id,
        .fail_on_publish_error = request.value.failOnPublishError,
    };
    if (next_handle == 0) return error.HandleSpaceExhausted;
    const handle = next_handle;
    next_handle +%= 1;
    instances.put(allocator, handle, instance) catch |err| {
        instance.driver.deinit();
        return err;
    };
    request_transferred = true;
    return handle;
}

export fn turnout_runtime_create(model_address: usize, model_len: u32, request_address: usize, request_len: u32) usize {
    if (request_len > max_create_request_bytes) return errorResponse(.invalid_input, "InitialStateTooLarge");
    if (model_address == 0 or model_len == 0 or request_address == 0 or request_len == 0)
        return errorResponse(.invalid_input, "InvalidBuffer");
    const handle = createInstance(bytesAt(model_address, model_len), bytesAt(request_address, request_len)) catch |err|
        return if (err == error.OutOfMemory) errorResponse(.out_of_memory, @errorName(err)) else errorResponse(.invalid_input, @errorName(err));
    // Report the limits actually in force, whether they came from the request or
    // from the defaults above, so a host never has to restate them.
    const instance = instances.get(handle) orelse return errorResponse(.internal_error, "MissingInstance");
    return jsonResponse(.ok, .{
        .handle = handle,
        .maxSceneSteps = instance.request.value.maxSceneSteps,
        .maxRouteTransitions = instance.request.value.maxRouteTransitions,
    });
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

const ActionCompleteJson = struct {
    completed: @FieldType(runtime.Event, "action_complete"),

    pub fn jsonStringify(self: ActionCompleteJson, writer: anytype) !void {
        const completed = self.completed;
        try writer.beginObject();
        try writer.objectField("event");
        try writer.write("actionComplete");
        try writer.objectField("sceneId");
        try writer.write(completed.scene_id);
        try writer.objectField("actionId");
        try writer.write(completed.action_id);
        try writer.objectField("computeRoot");
        try writer.write(value.CanonicalTagged{ .tagged = completed.compute_root });
        try writer.objectField("nextActionIds");
        try writer.beginArray();
        if (completed.next_action_id) |action_id| try writer.write(action_id);
        try writer.endArray();
        try writer.objectField("publishOutcomes");
        try writer.beginArray();
        for (completed.publish_outcomes) |outcome| {
            try writer.beginObject();
            try writer.objectField("hookName");
            try writer.write(outcome.hook_name);
            try writer.objectField("status");
            try writer.write(@tagName(outcome.status));
            try writer.objectField("message");
            try writer.write(outcome.message);
            try writer.endObject();
        }
        try writer.endArray();
        try writer.objectField("warnings");
        try writer.beginArray();
        for (completed.merge_warnings) |warning| {
            try writer.beginObject();
            try writer.objectField("kind");
            try writer.write("merge");
            try writer.objectField("binding");
            try writer.write(warning.binding);
            try writer.objectField("toState");
            try writer.write(warning.to_state);
            try writer.endObject();
        }
        if (completed.unchecked_write_paths.len != 0) {
            try writer.beginObject();
            try writer.objectField("kind");
            try writer.write("uncheckedStateWrite");
            try writer.objectField("writtenPaths");
            try writer.write(completed.unchecked_write_paths);
            try writer.endObject();
        }
        for (completed.next_warnings) |warning| {
            try writer.beginObject();
            try writer.objectField("kind");
            try writer.write((warning.kind));
            try writer.objectField("ruleIndex");
            try writer.write(warning.rule_index);
            try writer.objectField("conditionName");
            try writer.write(warning.condition_name);
            try writer.objectField("actualType");
            try writer.write(warning.actual_type);
            try writer.objectField("targetActionId");
            try writer.write(warning.target_action_id);
            try writer.endObject();
        }
        try writer.endArray();
        try writer.objectField("sceneWarnings");
        try writer.beginArray();
        if (completed.duplicate_warning) |warning| {
            try writer.beginObject();
            try writer.objectField("kind");
            try writer.write("duplicate_enqueue");
            try writer.objectField("actionId");
            try writer.write(warning.action_id);
            try writer.objectField("fromActionId");
            try writer.write(warning.from_action_id);
            try writer.objectField("firstEnqueuedBy");
            try writer.write(warning.first_enqueued_by);
            try writer.endObject();
        }
        try writer.endArray();
        try writer.endObject();
    }
};

fn eventResponse(event: runtime.Event) usize {
    return switch (event) {
        .need_effect => |request| jsonResponse(.ok, .{ .event = "needEffect", .id = request.id, .kind = @tagName(request.kind), .hook = request.hook, .sceneId = request.scene_id, .actionId = request.action_id, .callbackIndex = request.callback_index, .binding = request.binding, .contextJson = request.context_json }),
        .action_complete => |completed| jsonResponse(.ok, ActionCompleteJson{ .completed = completed }),
        .scene_changed => |changed| jsonResponse(.ok, .{ .event = "sceneChanged", .from = changed.from, .to = changed.to }),
        .complete => jsonResponse(.ok, .{ .event = "complete" }),
        .cancelled => jsonResponse(.ok, .{ .event = "cancelled" }),
    };
}

export fn turnout_runtime_step(handle: u32) usize {
    const instance = instances.get(handle) orelse return errorResponse(.invalid_handle, "InvalidHandle");
    const event = instance.driver.step(&instance.model, instance.fail_on_publish_error) catch |err| {
        if (err == error.SceneNotFound) {
            switch (instance.driver) {
                .route => |driver| if (driver.pending_scene_id) |scene_id| {
                    return jsonResponse(.runtime_error, .{ .@"error" = (err), .sceneId = scene_id });
                },
                .scene => {},
            }
        }
        return runtimeError(err);
    };
    return eventResponse(event);
}

fn snapshotResponse(instance: *const Instance) usize {
    const state_json = instance.driver.partialState().canonicalJson(allocator) catch |err|
        return runtimeError(err);
    defer allocator.free(state_json);
    const payload = std.fmt.allocPrint(
        allocator,
        "{{\"state\":{s},\"done\":{s}}}",
        .{ state_json, if (instance.driver.isDone()) "true" else "false" },
    ) catch return errorResponse(.out_of_memory, "OutOfMemory");
    defer allocator.free(payload);
    return responseAddress(.ok, payload);
}

export fn turnout_runtime_snapshot(handle: u32) usize {
    const instance = instances.get(handle) orelse return errorResponse(.invalid_handle, "InvalidHandle");
    return snapshotResponse(instance);
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
    if (bytes.len > max_effect_result_bytes) return error.EffectResultTooLarge;
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, bytes, .{
        .max_value_len = max_effect_result_bytes,
    });
    errdefer parsed.deinit();
    try validateInputNesting(parsed.value, 0);
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
    if (len > max_effect_result_bytes) return errorResponse(.invalid_input, "EffectResultTooLarge");
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

test "WASM stateless compute executes canonical inputs and returns bindings" {
    const request =
        \\{"root":"result","inputs":{"input":{"symbol":"number","value":5,"tags":["source"]}},"prog":{"bindings":[
        \\  {"name":"input","type":"number"},
        \\  {"name":"result","type":"number","expr":{"combine":{"fn":"add","args":[{"ref":"input"},{"lit":2}]}}}
        \\]}}
    ;
    const address = turnout_compute_execute(@intFromPtr(request.ptr), request.len);
    defer freeResponse(address);
    var response = try expectResponse(address, .ok, null);
    defer response.deinit();
    const result = response.value.object.get("value").?.object;
    try std.testing.expectEqualStrings("number", result.get("symbol").?.string);
    try std.testing.expectEqual(@as(i64, 7), result.get("value").?.integer);
    try std.testing.expectEqualStrings("source", result.get("tags").?.array.items[0].string);
    const bindings = response.value.object.get("bindings").?.object;
    try std.testing.expectEqual(@as(i64, 5), bindings.get("input").?.object.get("value").?.integer);
    try std.testing.expectEqual(@as(i64, 7), bindings.get("result").?.object.get("value").?.integer);
}

test "WASM stateless compute executes a graph context" {
    const request =
        \\{"rootFuncId":"sum","context":{"valueTable":{"a":{"symbol":"number","value":2,"tags":[]},"b":{"symbol":"number","value":3,"tags":[]}},
        \\ "funcTable":{"sum":{"kind":"combine","defId":"add","argMap":{"a":"a","b":"b"},"returnId":"total"}},
        \\ "combineFuncDefTable":{"add":{"name":"combineFnNumber::add","transformFn":{"a":["transformFnNumber::pass"],"b":["transformFnNumber::pass"]}}},
        \\ "pipeFuncDefTable":{},"condFuncDefTable":{}}}
    ;
    const address = turnout_compute_execute(@intFromPtr(request.ptr), request.len);
    defer freeResponse(address);
    var response = try expectResponse(address, .ok, null);
    defer response.deinit();
    try std.testing.expectEqual(@as(i64, 5), response.value.object.get("value").?.object.get("value").?.integer);
    try std.testing.expectEqual(@as(i64, 5), response.value.object.get("updatedValueTable").?.object.get("total").?.object.get("value").?.integer);
}

test "WASM stateless compute validates a graph context" {
    const request =
        \\{"operation":"validateLegacy","context":{"valueTable":{"x":{},"y":{}},"funcTable":{"a":{"kind":"combine","defId":"add","argMap":{"a":"x","b":"y"},"returnId":"same"},"b":{"kind":"combine","defId":"add","argMap":{"a":"x","b":"y"},"returnId":"same"}},"combineFuncDefTable":{"add":{"name":"combineFnNumber::add","transformFn":{"a":[],"b":[]}}},"pipeFuncDefTable":{},"condFuncDefTable":{}}}
    ;
    const address = turnout_compute_execute(@intFromPtr(request.ptr), request.len);
    defer freeResponse(address);
    var response = try expectResponse(address, .ok, null);
    defer response.deinit();
    try std.testing.expect(!response.value.object.get("valid").?.bool);
    const errors = response.value.object.get("errors").?.array.items;
    try std.testing.expectEqual(@as(usize, 1), errors.len);
    try std.testing.expectEqualStrings("same", errors[0].object.get("details").?.object.get("returnId").?.string);
}

test "WASM stateless compute rejects malformed and oversized requests" {
    const malformed = "{}";
    const malformed_address = turnout_compute_execute(@intFromPtr(malformed.ptr), malformed.len);
    defer freeResponse(malformed_address);
    var malformed_response = try expectResponse(malformed_address, .runtime_error, null);
    defer malformed_response.deinit();
    try std.testing.expectEqualStrings(
        "InvalidComputeRequest",
        malformed_response.value.object.get("error").?.string,
    );

    const one = "x";
    const oversized_address = turnout_compute_execute(
        @intFromPtr(one.ptr),
        max_compute_request_bytes + 1,
    );
    defer freeResponse(oversized_address);
    var oversized_response = try expectResponse(oversized_address, .invalid_input, null);
    defer oversized_response.deinit();
    try std.testing.expectEqualStrings(
        "ComputeRequestTooLarge",
        oversized_response.value.object.get("error").?.string,
    );
}

test "WASM stateless Value operation normalizes and calls presets" {
    const normalize =
        \\{"operation":"normalize","value":{"symbol":"number","value":3,"tags":["a","a"]}}
    ;
    const normalize_address = turnout_value_operate(@intFromPtr(normalize.ptr), normalize.len);
    defer freeResponse(normalize_address);
    var normalized = try expectResponse(normalize_address, .ok, null);
    defer normalized.deinit();
    try std.testing.expectEqual(@as(usize, 1), normalized.value.object.get("tags").?.array.items.len);

    const derive =
        \\{"operation":"derive","value":{"symbol":"string","value":"result","tags":[]},"sources":[
        \\  {"symbol":"number","value":1,"tags":["left"]},
        \\  {"symbol":"number","value":2,"tags":["right","left"]}
        \\]}
    ;
    const derive_address = turnout_value_operate(@intFromPtr(derive.ptr), derive.len);
    defer freeResponse(derive_address);
    var derived = try expectResponse(derive_address, .ok, null);
    defer derived.deinit();
    try std.testing.expectEqualStrings("left", derived.value.object.get("tags").?.array.items[0].string);
    try std.testing.expectEqualStrings("right", derived.value.object.get("tags").?.array.items[1].string);

    const call =
        \\{"operation":"preset","name":"combineFnNumber::add","args":[
        \\  {"symbol":"number","value":3,"tags":["left"]},
        \\  {"symbol":"number","value":4,"tags":["right"]}
        \\]}
    ;
    const call_address = turnout_value_operate(@intFromPtr(call.ptr), call.len);
    defer freeResponse(call_address);
    var called = try expectResponse(call_address, .ok, null);
    defer called.deinit();
    try std.testing.expectEqual(@as(i64, 7), called.value.object.get("value").?.integer);
    try std.testing.expectEqualStrings("left", called.value.object.get("tags").?.array.items[0].string);
    try std.testing.expectEqualStrings("right", called.value.object.get("tags").?.array.items[1].string);

    const predicate =
        \\{"operation":"predicate","predicate":"typedArray","value":{"symbol":"array","value":[],"subSymbol":"number","tags":[]}}
    ;
    const predicate_address = turnout_value_operate(@intFromPtr(predicate.ptr), predicate.len);
    defer freeResponse(predicate_address);
    var matched = try expectResponse(predicate_address, .ok, null);
    defer matched.deinit();
    try std.testing.expect(matched.value.object.get("matches").?.bool);

    const schema_match =
        \\{"operation":"schemaMatches","schemaType":"arr<number>","value":{"symbol":"array","value":[{"symbol":"number","value":1,"tags":[]}],"subSymbol":"number","tags":[]}}
    ;
    const schema_match_address = turnout_value_operate(@intFromPtr(schema_match.ptr), schema_match.len);
    defer freeResponse(schema_match_address);
    var schema_matched = try expectResponse(schema_match_address, .ok, null);
    defer schema_matched.deinit();
    try std.testing.expect(schema_matched.value.object.get("matches").?.bool);

    const literal =
        \\{"operation":"literalToValue","schemaType":"arr<number>","value":[1,2]}
    ;
    const literal_address = turnout_value_operate(@intFromPtr(literal.ptr), literal.len);
    defer freeResponse(literal_address);
    var literal_value = try expectResponse(literal_address, .ok, null);
    defer literal_value.deinit();
    try std.testing.expectEqualStrings("number", literal_value.value.object.get("subSymbol").?.string);
}

test "WASM stateless Value operation infers graph types" {
    const context =
        \\{"valueTable":{"array":{"symbol":"array","value":[],"subSymbol":"number"}},
        \\ "funcTable":{"pipe":{"kind":"pipe","defId":"outer"},"cond":{"kind":"cond","defId":"choice"},"left":{"kind":"combine","defId":"add"},"right":{"kind":"combine","defId":"add"}},
        \\ "combineFuncDefTable":{"add":{"name":"combineFnNumber::add"},"unknown":{"name":"combineFnNumber::missing"}},
        \\ "pipeFuncDefTable":{"outer":{"sequence":[{"defId":"inner"}]},"inner":{"sequence":[{"defId":"add"}]}},
        \\ "condFuncDefTable":{"choice":{"trueBranchId":"left","falseBranchId":"right"}}}
    ;
    const queries = [_]struct { query: []const u8, id: []const u8, expected: ?[]const u8 }{
        .{ .query = "value", .id = "array", .expected = "array" },
        .{ .query = "element", .id = "array", .expected = "number" },
        .{ .query = "combine", .id = "add", .expected = "number" },
        .{ .query = "function", .id = "pipe", .expected = "number" },
        .{ .query = "function", .id = "cond", .expected = "number" },
        .{ .query = "combine", .id = "unknown", .expected = null },
    };
    for (queries) |query| {
        const request = try std.fmt.allocPrint(
            std.testing.allocator,
            "{{\"operation\":\"infer\",\"query\":\"{s}\",\"id\":\"{s}\",\"context\":{s}}}",
            .{ query.query, query.id, context },
        );
        defer std.testing.allocator.free(request);
        const address = turnout_value_operate(@intFromPtr(request.ptr), @intCast(request.len));
        defer freeResponse(address);
        var response = try expectResponse(address, .ok, null);
        defer response.deinit();
        const inferred = response.value.object.get("type").?;
        if (query.expected) |expected|
            try std.testing.expectEqualStrings(expected, inferred.string)
        else
            try std.testing.expect(inferred == .null);
    }
}

test "WASM stateless Value operation infers a batch of function types" {
    const context =
        \\{"valueTable":{},
        \\ "funcTable":{"pipe":{"kind":"pipe","defId":"outer"},"cond":{"kind":"cond","defId":"choice"},"mixed":{"kind":"cond","defId":"clash"},"left":{"kind":"combine","defId":"add"},"right":{"kind":"combine","defId":"add"},"text":{"kind":"combine","defId":"concat"}},
        \\ "combineFuncDefTable":{"add":{"name":"combineFnNumber::add"},"concat":{"name":"combineFnString::concat"}},
        \\ "pipeFuncDefTable":{"outer":{"sequence":[{"defId":"add"}]}},
        \\ "condFuncDefTable":{"choice":{"trueBranchId":"left","falseBranchId":"right"},"clash":{"trueBranchId":"left","falseBranchId":"text"}}}
    ;
    const request = try std.fmt.allocPrint(
        std.testing.allocator,
        "{{\"operation\":\"infer\",\"query\":\"functions\",\"ids\":[\"pipe\",\"cond\",\"text\",\"mixed\",\"absent\"],\"context\":{s}}}",
        .{context},
    );
    defer std.testing.allocator.free(request);
    const address = turnout_value_operate(@intFromPtr(request.ptr), @intCast(request.len));
    defer freeResponse(address);
    var response = try expectResponse(address, .ok, null);
    defer response.deinit();

    const types = response.value.object.get("types").?.array;
    try std.testing.expectEqual(@as(usize, 5), types.items.len);
    try std.testing.expectEqualStrings("number", types.items[0].string);
    try std.testing.expectEqualStrings("number", types.items[1].string);
    try std.testing.expectEqualStrings("string", types.items[2].string);
    // Branch types disagree, so the cond has no inferable type.
    try std.testing.expect(types.items[3] == .null);
    try std.testing.expect(types.items[4] == .null);
}

test "WASM stateless Value operation rejects a malformed batched inference request" {
    const context = "{\"valueTable\":{},\"funcTable\":{},\"combineFuncDefTable\":{},\"pipeFuncDefTable\":{},\"condFuncDefTable\":{}}";
    const requests = [_][]const u8{
        "{\"operation\":\"infer\",\"query\":\"functions\",\"context\":" ++ context ++ "}",
        "{\"operation\":\"infer\",\"query\":\"functions\",\"ids\":\"pipe\",\"context\":" ++ context ++ "}",
        "{\"operation\":\"infer\",\"query\":\"functions\",\"ids\":[7],\"context\":" ++ context ++ "}",
    };
    for (requests) |request| {
        const address = turnout_value_operate(@intFromPtr(request.ptr), @intCast(request.len));
        defer freeResponse(address);
        var response = try expectResponse(address, .runtime_error, null);
        defer response.deinit();
    }
}

test "WASM stateless Value operation rejects malformed and oversized requests" {
    const malformed = "{}";
    const malformed_address = turnout_value_operate(@intFromPtr(malformed.ptr), malformed.len);
    defer freeResponse(malformed_address);
    var malformed_response = try expectResponse(malformed_address, .runtime_error, null);
    defer malformed_response.deinit();
    try std.testing.expectEqualStrings(
        "InvalidValueRequest",
        malformed_response.value.object.get("error").?.string,
    );

    const one = "x";
    const oversized_address = turnout_value_operate(@intFromPtr(one.ptr), max_value_request_bytes + 1);
    defer freeResponse(oversized_address);
    var oversized_response = try expectResponse(oversized_address, .invalid_input, null);
    defer oversized_response.deinit();
    try std.testing.expectEqualStrings(
        "ValueRequestTooLarge",
        oversized_response.value.object.get("error").?.string,
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

    const prepare_result = try std.fmt.allocPrint(std.testing.allocator, "{{\"id\":{d},\"kind\":\"prepare\",\"status\":\"ok\",\"value\":{{\"symbol\":\"number\",\"value\":5,\"tags\":[]}}}}", .{prepare_id});
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
    try std.testing.expectEqualStrings("start", action.value.object.get("actionId").?.string);
    try std.testing.expectEqual(@as(i64, 7), action.value.object.get("computeRoot").?.object.get("value").?.integer);
    try std.testing.expectEqual(@as(usize, 0), action.value.object.get("nextActionIds").?.array.items.len);
    const publish_outcomes = action.value.object.get("publishOutcomes").?.array.items;
    try std.testing.expectEqual(@as(usize, 1), publish_outcomes.len);
    try std.testing.expectEqualStrings("save", publish_outcomes[0].object.get("hookName").?.string);
    try std.testing.expectEqualStrings("ok", publish_outcomes[0].object.get("status").?.string);
    const warnings = action.value.object.get("warnings").?.array.items;
    try std.testing.expectEqual(@as(usize, 1), warnings.len);
    try std.testing.expectEqualStrings("uncheckedStateWrite", warnings[0].object.get("kind").?.string);
    const complete_address = turnout_runtime_step(handle);
    defer freeResponse(complete_address);
    var complete = try expectResponse(complete_address, .ok, "complete");
    defer complete.deinit();
    const snapshot_address = turnout_runtime_snapshot(handle);
    defer freeResponse(snapshot_address);
    var snapshot = try expectResponse(snapshot_address, .ok, null);
    defer snapshot.deinit();
    try std.testing.expect(snapshot.value.object.get("done").?.bool);
    const result_value = snapshot.value.object
        .get("state").?.object
        .get("result.value").?.object
        .get("value").?.integer;
    try std.testing.expectEqual(@as(i64, 7), result_value);

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

test "WASM boundary rejects oversized model STATE and effect inputs" {
    const one = "x";
    const config =
        \\{"sceneId":"main"}
    ;

    const oversized_state = turnout_runtime_create(
        @intFromPtr(one.ptr),
        one.len,
        @intFromPtr(one.ptr),
        max_create_request_bytes + 1,
    );
    defer freeResponse(oversized_state);
    var state_response = try expectResponse(oversized_state, .invalid_input, null);
    defer state_response.deinit();
    try std.testing.expectEqualStrings(
        "InitialStateTooLarge",
        state_response.value.object.get("error").?.string,
    );

    const oversized_model = turnout_runtime_create(
        @intFromPtr(one.ptr),
        (model_runtime.Limits{}).max_model_bytes + 1,
        @intFromPtr(config.ptr),
        config.len,
    );
    defer freeResponse(oversized_model);
    var model_response = try expectResponse(oversized_model, .invalid_input, null);
    defer model_response.deinit();
    try std.testing.expectEqualStrings(
        "ModelTooLarge",
        model_response.value.object.get("error").?.string,
    );

    const pointer: [*]const u8 = one.ptr;
    try std.testing.expectError(
        error.EffectResultTooLarge,
        parseEffectResult(pointer[0 .. max_effect_result_bytes + 1]),
    );
}

test "WASM boundary rejects deeply nested STATE and effect inputs" {
    var request = std.ArrayList(u8).empty;
    defer request.deinit(std.testing.allocator);
    try request.appendSlice(std.testing.allocator, "{\"sceneId\":\"main\",\"initialState\":");
    for (0..max_input_nesting + 1) |_| try request.append(std.testing.allocator, '[');
    try request.appendSlice(std.testing.allocator, "null");
    for (0..max_input_nesting + 1) |_| try request.append(std.testing.allocator, ']');
    try request.append(std.testing.allocator, '}');

    const model = "{\"version\":2}";
    const address = turnout_runtime_create(
        @intFromPtr(model.ptr),
        model.len,
        @intFromPtr(request.items.ptr),
        @intCast(request.items.len),
    );
    defer freeResponse(address);
    var response = try expectResponse(address, .invalid_input, null);
    defer response.deinit();
    try std.testing.expectEqualStrings(
        "InputTooDeep",
        response.value.object.get("error").?.string,
    );

    var effect_input = std.ArrayList(u8).empty;
    defer effect_input.deinit(std.testing.allocator);
    for (0..max_input_nesting + 1) |_| try effect_input.append(std.testing.allocator, '[');
    try effect_input.appendSlice(std.testing.allocator, "null");
    for (0..max_input_nesting + 1) |_| try effect_input.append(std.testing.allocator, ']');
    try std.testing.expectError(
        error.InputTooDeep,
        parseEffectResult(effect_input.items),
    );
}

test "native WASM ABI lifecycle has no outstanding allocations" {
    if (comptime builtin.target.cpu.arch.isWasm()) return;
    try std.testing.expectEqual(
        @as(usize, 0),
        native_allocator.detectLeaks(),
    );
}

test "WASM route lifecycle emits scene transitions" {
    const model =
        \\{"version":2,"routes":[{"id":"route","entrySceneId":"one","match":[{"patterns":["one.start"],"target":"two"}]}],"scenes":[
        \\{"id":"one","entryAction":"start","actions":[{"id":"start"}]},
        \\{"id":"two","entryAction":"finish","actions":[{"id":"finish"}]}
        \\]}
    ;
    const config =
        \\{"routeId":"route","initialState":{},"maxRouteTransitions":2}
    ;
    const created_address = turnout_runtime_create(@intFromPtr(model.ptr), model.len, @intFromPtr(config.ptr), config.len);
    defer freeResponse(created_address);
    var created = try expectResponse(created_address, .ok, null);
    defer created.deinit();
    const handle: u32 = @intCast(created.value.object.get("handle").?.integer);

    const first_address = turnout_runtime_step(handle);
    defer freeResponse(first_address);
    var first = try expectResponse(first_address, .ok, "actionComplete");
    defer first.deinit();
    try std.testing.expectEqualStrings("one", first.value.object.get("sceneId").?.string);

    const changed_address = turnout_runtime_step(handle);
    defer freeResponse(changed_address);
    var changed = try expectResponse(changed_address, .ok, "sceneChanged");
    defer changed.deinit();
    try std.testing.expectEqualStrings("two", changed.value.object.get("to").?.string);

    const second_address = turnout_runtime_step(handle);
    defer freeResponse(second_address);
    var second = try expectResponse(second_address, .ok, "actionComplete");
    defer second.deinit();
    try std.testing.expectEqualStrings("two", second.value.object.get("sceneId").?.string);

    const complete_address = turnout_runtime_step(handle);
    defer freeResponse(complete_address);
    var complete = try expectResponse(complete_address, .ok, "complete");
    defer complete.deinit();

    const destroyed_address = turnout_runtime_destroy(handle);
    defer freeResponse(destroyed_address);
    var destroyed = try expectResponse(destroyed_address, .ok, null);
    defer destroyed.deinit();
}
