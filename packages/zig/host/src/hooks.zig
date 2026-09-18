//! Hook transports for the native host.
//!
//! Two of them. `ProcessHooks` spawns a program and speaks newline-delimited
//! JSON over its stdin and stdout, one request per line and one answer per
//! line. `FixtureHooks` reads the answers from a file instead, which is what
//! the conformance vectors are.
//!
//! Both put the same envelopes on the wire as the WASM ABI's `needEffect`
//! event and `resume` payload, deliberately: one effect protocol, framed two
//! ways. A hook program written against the ABI's documented shapes works here
//! without knowing which host is asking.
const std = @import("std");
const scene_runner = @import("turnout_scene_runner");

const effect = scene_runner.effect;

/// The request as it goes on the wire, matching the ABI's needEffect event.
pub const RequestJson = struct {
    event: []const u8 = "needEffect",
    id: u64,
    kind: []const u8,
    role: []const u8,
    hook: []const u8,
    sceneId: []const u8,
    actionId: []const u8,
    callbackIndex: usize,
    binding: ?[]const u8,
    bindings: []const []const u8,
    contextJson: []const u8,

    pub fn from(request: effect.Request) RequestJson {
        return .{
            .id = request.id,
            .kind = @tagName(request.kind),
            .role = @tagName(request.role),
            .hook = request.hook,
            .sceneId = request.scene_id,
            .actionId = request.action_id,
            .callbackIndex = request.callback_index,
            .binding = request.binding,
            .bindings = request.bindings,
            .contextJson = request.context_json,
        };
    }
};

/// The answer as it comes back, matching the ABI's resume payload.
pub const ResultJson = struct {
    id: u64,
    kind: []const u8,
    status: []const u8,
    /// Prepare success only: the value or record of values the hook resolved.
    value: ?std.json.Value = null,
    /// Failure only.
    message: ?[]const u8 = null,
    /// Publish failure only: "returned" or "thrown".
    source: ?[]const u8 = null,

    /// Converts to the runtime's own result type, borrowing from `arena`.
    ///
    /// The payload crosses as bytes because that is what the runtime parses:
    /// it decodes prepare payloads itself, so re-encoding here keeps one
    /// decoder rather than two that can disagree.
    pub fn toResult(
        self: ResultJson,
        request: effect.Request,
        arena: std.mem.Allocator,
    ) !effect.Result {
        if (self.id != request.id) return error.StaleHookAnswer;
        const kind = std.meta.stringToEnum(effect.Kind, self.kind) orelse
            return error.InvalidHookAnswer;
        if (kind != request.kind) return error.WrongHookAnswerKind;
        if (std.mem.eql(u8, self.status, "missing")) {
            return switch (kind) {
                .prepare => .{ .prepare = .missing },
                .publish => .{ .publish = .missing },
            };
        }
        if (std.mem.eql(u8, self.status, "failed")) {
            const message = try arena.dupe(u8, self.message orelse "hook failed");
            return switch (kind) {
                .prepare => .{ .prepare = .{ .failed = message } },
                .publish => .{ .publish = .{ .failed = .{
                    .source = if (std.mem.eql(u8, self.source orelse "returned", "thrown"))
                        .thrown
                    else
                        .returned,
                    .message = message,
                } } },
            };
        }
        if (!std.mem.eql(u8, self.status, "ok")) return error.InvalidHookAnswer;
        return switch (kind) {
            .publish => .{ .publish = .ok },
            // A hook that answered ok with no payload supplied no bindings,
            // which is an empty record rather than a null.
            .prepare => .{ .prepare = .{
                .ok = if (self.value) |payload|
                    try std.json.Stringify.valueAlloc(arena, payload, .{})
                else
                    try arena.dupe(u8, "{}"),
            } },
        };
    }
};

/// Answers from a file: `{"<hook name>": {<answer>}}`.
///
/// The answer object is a `ResultJson` without its `id` and `kind`, which the
/// request already fixes. A hook the file does not name answers `missing`,
/// which is how "unregistered" is spelled on the wire.
pub const FixtureHooks = struct {
    parsed: std.json.Parsed(std.json.Value),

    pub fn init(allocator: std.mem.Allocator, bytes: []const u8) !FixtureHooks {
        const parsed = try std.json.parseFromSlice(std.json.Value, allocator, bytes, .{});
        errdefer parsed.deinit();
        if (parsed.value != .object) return error.InvalidHookFixture;
        return .{ .parsed = parsed };
    }

    pub fn deinit(self: *FixtureHooks) void {
        self.parsed.deinit();
        self.* = undefined;
    }

    pub fn source(self: *FixtureHooks) @import("run.zig").HookSource {
        return .{ .context = self, .answerFn = answer };
    }

    fn answer(
        context: *anyopaque,
        request: effect.Request,
        arena: std.mem.Allocator,
    ) anyerror!effect.Result {
        const self: *FixtureHooks = @ptrCast(@alignCast(context));
        const entry = self.parsed.value.object.get(request.hook) orelse {
            return switch (request.kind) {
                .prepare => .{ .prepare = .missing },
                .publish => .{ .publish = .missing },
            };
        };
        if (entry != .object) return error.InvalidHookFixture;
        const answer_json: ResultJson = .{
            .id = request.id,
            .kind = @tagName(request.kind),
            .status = if (entry.object.get("status")) |status| blk: {
                if (status != .string) return error.InvalidHookFixture;
                break :blk status.string;
            } else "ok",
            .value = entry.object.get("value"),
            .message = if (entry.object.get("message")) |message| blk: {
                if (message != .string) return error.InvalidHookFixture;
                break :blk message.string;
            } else null,
            .source = if (entry.object.get("source")) |src| blk: {
                if (src != .string) return error.InvalidHookFixture;
                break :blk src.string;
            } else null,
        };
        return answer_json.toResult(request, arena);
    }
};

/// Answers from a program: one JSON request per line in, one per line out.
pub const ProcessHooks = struct {
    io: std.Io,
    child: std.process.Child,
    stdin: std.Io.File.Writer,
    stdout: std.Io.File.Reader,
    stdin_buffer: []u8,
    stdout_buffer: []u8,
    allocator: std.mem.Allocator,

    pub const max_line_bytes = 16 * 1024 * 1024;

    pub fn init(
        allocator: std.mem.Allocator,
        io: std.Io,
        argv: []const []const u8,
    ) !ProcessHooks {
        var child = try std.process.spawn(io, .{
            .argv = argv,
            .stdin = .pipe,
            .stdout = .pipe,
            .stderr = .inherit,
        });
        errdefer _ = child.wait(io) catch {};

        const stdin_buffer = try allocator.alloc(u8, 4096);
        errdefer allocator.free(stdin_buffer);
        const stdout_buffer = try allocator.alloc(u8, 64 * 1024);
        errdefer allocator.free(stdout_buffer);

        return .{
            .io = io,
            .child = child,
            .stdin = child.stdin.?.writer(io, stdin_buffer),
            .stdout = child.stdout.?.reader(io, stdout_buffer),
            .stdin_buffer = stdin_buffer,
            .stdout_buffer = stdout_buffer,
            .allocator = allocator,
        };
    }

    /// Closes the program's input so it sees end of stream, then waits for it.
    pub fn deinit(self: *ProcessHooks) void {
        self.stdin.interface.flush() catch {};
        if (self.child.stdin) |stdin| {
            stdin.close(self.io);
            self.child.stdin = null;
        }
        _ = self.child.wait(self.io) catch {};
        self.allocator.free(self.stdin_buffer);
        self.allocator.free(self.stdout_buffer);
        self.* = undefined;
    }

    pub fn source(self: *ProcessHooks) @import("run.zig").HookSource {
        return .{ .context = self, .answerFn = answer };
    }

    fn answer(
        context: *anyopaque,
        request: effect.Request,
        arena: std.mem.Allocator,
    ) anyerror!effect.Result {
        const self: *ProcessHooks = @ptrCast(@alignCast(context));
        try std.json.Stringify.value(RequestJson.from(request), .{}, &self.stdin.interface);
        try self.stdin.interface.writeByte('\n');
        try self.stdin.interface.flush();

        // takeDelimiter, not takeDelimiterExclusive: the exclusive one leaves
        // the newline in the buffer, so the next read returns an empty line.
        const line = try self.stdout.interface.takeDelimiter('\n') orelse
            return error.HookProgramClosed;
        const parsed = try std.json.parseFromSlice(ResultJson, arena, line, .{
            .ignore_unknown_fields = true,
        });
        return parsed.value.toResult(request, arena);
    }
};

test "an answer becomes the runtime's own result" {
    const allocator = std.testing.allocator;
    var arena: std.heap.ArenaAllocator = .init(allocator);
    defer arena.deinit();
    const request: effect.Request = .{
        .id = 7,
        .kind = .prepare,
        .hook = "load",
        .scene_id = "main",
        .action_id = "start",
        .callback_index = 0,
        .binding = "input",
        .context_json = "{}",
    };

    const ok: ResultJson = .{ .id = 7, .kind = "prepare", .status = "ok", .value = .{ .integer = 4 } };
    const result = try ok.toResult(request, arena.allocator());
    try std.testing.expectEqualStrings("4", result.prepare.ok);

    // A hook that answered ok with nothing supplied no bindings.
    const empty: ResultJson = .{ .id = 7, .kind = "prepare", .status = "ok" };
    try std.testing.expectEqualStrings("{}", (try empty.toResult(request, arena.allocator())).prepare.ok);

    const missing: ResultJson = .{ .id = 7, .kind = "prepare", .status = "missing" };
    try std.testing.expect((try missing.toResult(request, arena.allocator())).prepare == .missing);

    const failed: ResultJson = .{ .id = 7, .kind = "prepare", .status = "failed", .message = "no" };
    try std.testing.expectEqualStrings(
        "no",
        (try failed.toResult(request, arena.allocator())).prepare.failed,
    );
}

test "an answer is rejected when it does not match the request" {
    const allocator = std.testing.allocator;
    var arena: std.heap.ArenaAllocator = .init(allocator);
    defer arena.deinit();
    const request: effect.Request = .{
        .id = 7,
        .kind = .prepare,
        .hook = "load",
        .scene_id = "main",
        .action_id = "start",
        .callback_index = 0,
        .binding = null,
        .context_json = "{}",
    };
    const stale: ResultJson = .{ .id = 6, .kind = "prepare", .status = "ok" };
    try std.testing.expectError(error.StaleHookAnswer, stale.toResult(request, arena.allocator()));
    const wrong_kind: ResultJson = .{ .id = 7, .kind = "publish", .status = "ok" };
    try std.testing.expectError(
        error.WrongHookAnswerKind,
        wrong_kind.toResult(request, arena.allocator()),
    );
    const nonsense: ResultJson = .{ .id = 7, .kind = "prepare", .status = "shrug" };
    try std.testing.expectError(error.InvalidHookAnswer, nonsense.toResult(request, arena.allocator()));
}

test "a publish failure carries its source" {
    const allocator = std.testing.allocator;
    var arena: std.heap.ArenaAllocator = .init(allocator);
    defer arena.deinit();
    const request: effect.Request = .{
        .id = 1,
        .kind = .publish,
        .hook = "save",
        .scene_id = "main",
        .action_id = "start",
        .callback_index = 0,
        .binding = null,
        .context_json = "{}",
    };
    const thrown: ResultJson = .{
        .id = 1,
        .kind = "publish",
        .status = "failed",
        .message = "sink down",
        .source = "thrown",
    };
    const result = try thrown.toResult(request, arena.allocator());
    try std.testing.expectEqual(effect.PublishFailureSource.thrown, result.publish.failed.source);
    try std.testing.expectEqualStrings("sink down", result.publish.failed.message);

    // An unnamed source is the ordinary one: the hook reported, not raised.
    const returned: ResultJson = .{ .id = 1, .kind = "publish", .status = "failed", .message = "no" };
    const plain = try returned.toResult(request, arena.allocator());
    try std.testing.expectEqual(effect.PublishFailureSource.returned, plain.publish.failed.source);
}

test "a fixture answers by hook name and reports the rest missing" {
    const allocator = std.testing.allocator;
    var fixture = try FixtureHooks.init(allocator,
        \\{"load": {"value": {"symbol": "number", "value": 2, "tags": []}}}
    );
    defer fixture.deinit();
    var arena: std.heap.ArenaAllocator = .init(allocator);
    defer arena.deinit();
    const source = fixture.source();

    const known = try source.answer(.{
        .id = 1,
        .kind = .prepare,
        .hook = "load",
        .scene_id = "main",
        .action_id = "start",
        .callback_index = 0,
        .binding = "input",
        .context_json = "{}",
    }, arena.allocator());
    try std.testing.expectEqualStrings(
        \\{"symbol":"number","value":2,"tags":[]}
    , known.prepare.ok);

    // A hook the fixture does not name is how "unregistered" is spelled.
    const unknown = try source.answer(.{
        .id = 2,
        .kind = .prepare,
        .hook = "absent",
        .scene_id = "main",
        .action_id = "start",
        .callback_index = 1,
        .binding = "other",
        .context_json = "{}",
    }, arena.allocator());
    try std.testing.expect(unknown.prepare == .missing);
}
