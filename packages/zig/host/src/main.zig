//! `turnout-run` — the native Turnout host.
//!
//! The second shell over the engine, for callers with no JavaScript in reach.
//! It loads a model the Go compiler emitted, runs it in process, and prints
//! what happened. The engine underneath is the same one the WASM ABI wraps, so
//! the two hosts agree by construction rather than by care; what they agree on
//! is pinned by the vectors in `spec/conformance/host`.
const std = @import("std");
const scene_runner = @import("turnout_scene_runner");
const turnout_value = @import("turnout_runtime").value;

const hooks = @import("hooks.zig");
const run_host = @import("run.zig");

const model_runtime = scene_runner.model;
const state_runtime = scene_runner.state;
const structure = scene_runner.structure;

const usage =
    \\Usage: turnout-run run <model.json> [options]
    \\
    \\  --scene <id>        Run one scene. Exactly one of --scene or --route.
    \\  --route <id>        Run a route across scenes.
    \\  --state <file>      Initial STATE, as canonical tagged values keyed by path.
    \\  --hooks <file>      Hook answers, keyed by hook name.
    \\  --hook-program <p>  Serve hooks from a program over newline-delimited JSON.
    \\  --hook-arg <value>  An argument for that program. Repeat for several.
    \\  --fail-on-publish-error
    \\  --max-scene-steps <n>
    \\  --max-route-transitions <n>
    \\  --max-model-merges <n>
    \\  --no-check          Skip the structural check and run the model as given.
    \\
    \\Prints the final STATE and the actions that ran, as JSON, on stdout.
    \\
;

const Args = struct {
    model_path: []const u8,
    entry: run_host.Entry,
    state_path: ?[]const u8 = null,
    hooks_path: ?[]const u8 = null,
    hook_program: ?[]const u8 = null,
    hook_args: []const []const u8 = &.{},
    options: run_host.Options = .{},
    /// Whether to check the model's structure before running it.
    ///
    /// On by default. The engine resolves ids lazily, so a route whose entry
    /// scene is missing is a failure several steps into a run rather than at
    /// the start, and a duplicate scene id is not a failure at all — the index
    /// keeps the first and the second never runs. The TypeScript host has
    /// always checked up front; this is the same check, from the same place,
    /// so both hosts reject the same models for the same reasons.
    check: bool = true,
};

pub fn main(init: std.process.Init) !u8 {
    const gpa = init.gpa;
    const io = init.io;

    var argv: std.ArrayList([]const u8) = .empty;
    defer argv.deinit(gpa);
    var iterator = try std.process.Args.Iterator.initAllocator(init.minimal.args, gpa);
    defer iterator.deinit();
    _ = iterator.skip();
    while (iterator.next()) |argument| try argv.append(gpa, argument);

    var hook_args: std.ArrayList([]const u8) = .empty;
    defer hook_args.deinit(gpa);
    const args = parseArgs(argv.items, &hook_args, gpa) catch |err| {
        try fail(io, "{t}\n\n{s}", .{ err, usage });
        return 2;
    };

    const model_bytes = std.Io.Dir.cwd().readFileAlloc(io, args.model_path, gpa, .limited(16 << 20)) catch |err|
        return report(io, @errorName(err), "{s}: {t}\n", .{ args.model_path, err });
    defer gpa.free(model_bytes);
    var model = model_runtime.RuntimeModel.init(gpa, model_bytes, .{}) catch |err|
        return report(io, @errorName(err), "{s}: {t}\n", .{ args.model_path, err });
    defer model.deinit();

    if (args.check) {
        var issues = try structure.validate(model.parsed.value, gpa);
        defer issues.deinit();
        if (!issues.ok()) {
            // Every violation at once: a model with four mistakes should take
            // one fix cycle, not four.
            for (issues.messages) |message| {
                try fail(io, "{s}: {s}\n", .{ args.model_path, message });
            }
            // Not `report`: this is the one failure that carries a list as well
            // as a code, because a model with four mistakes should take one fix
            // cycle rather than four.
            var error_buffer: [4096]u8 = undefined;
            var error_out = std.Io.File.stdout().writer(io, &error_buffer);
            try error_out.interface.print("{{\"error\":\"MalformedModel\",\"errors\":", .{});
            try std.json.Stringify.value(issues.messages, .{}, &error_out.interface);
            try error_out.interface.print("}}\n", .{});
            try error_out.interface.flush();
            return 1;
        }
    }

    var initial_values: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    var parsed_state: ?std.json.Parsed(std.json.Value) = null;
    defer {
        for (initial_values.values()) |*item| turnout_value.deinitTaggedValue(item, gpa);
        initial_values.deinit(gpa);
        if (parsed_state) |*parsed| parsed.deinit();
    }
    if (args.state_path) |path| {
        const bytes = std.Io.Dir.cwd().readFileAlloc(io, path, gpa, .limited(16 << 20)) catch |err|
            return report(io, @errorName(err), "{s}: {t}\n", .{ path, err });
        defer gpa.free(bytes);
        parsed_state = std.json.parseFromSlice(std.json.Value, gpa, bytes, .{}) catch |err|
            return report(io, "InvalidJson", "{s}: {t}\n", .{ path, err });
        if (parsed_state.?.value != .object) {
            return report(io, "InvalidState", "{s}: initial STATE must be a JSON object\n", .{path});
        }
        var entries = parsed_state.?.value.object.iterator();
        while (entries.next()) |entry| {
            var owned = turnout_value.fromCanonicalValue(entry.value_ptr.*, gpa) catch |err|
                return report(io, @errorName(err), "{s}: {s}: {t}\n", .{ path, entry.key_ptr.*, err });
            errdefer owned.deinit(gpa);
            try initial_values.put(gpa, entry.key_ptr.*, owned.borrowed());
        }
    }

    // A model can declare a STATE the engine cannot hold — a schema type nested
    // past its node pool is the one that reaches here — and that has to read as
    // a refusal of the model, not as this host falling over.
    var initial_state = (if (model.root().get("state")) |state_model|
        state_runtime.State.initFromModel(state_model, &initial_values, gpa)
    else
        state_runtime.State.initUnchecked(&initial_values, gpa)) catch |err|
        return report(io, @errorName(err), "{s}: STATE rejected: {t}\n", .{ args.model_path, err });
    defer initial_state.deinit(gpa);

    var fixture: ?hooks.FixtureHooks = null;
    var process_hooks: ?hooks.ProcessHooks = null;
    defer {
        if (fixture) |*source| source.deinit();
        if (process_hooks) |*source| source.deinit();
    }
    const hook_source = if (args.hook_program) |program| blk: {
        var program_argv: std.ArrayList([]const u8) = .empty;
        defer program_argv.deinit(gpa);
        try program_argv.append(gpa, program);
        try program_argv.appendSlice(gpa, args.hook_args);
        process_hooks = hooks.ProcessHooks.init(gpa, io, program_argv.items) catch |err|
            return report(io, @errorName(err), "{s}: {t}\n", .{ program, err });
        break :blk process_hooks.?.source();
    } else if (args.hooks_path) |path| blk: {
        const bytes = std.Io.Dir.cwd().readFileAlloc(io, path, gpa, .limited(16 << 20)) catch |err|
            return report(io, @errorName(err), "{s}: {t}\n", .{ path, err });
        defer gpa.free(bytes);
        fixture = hooks.FixtureHooks.init(gpa, bytes) catch |err|
            return report(io, @errorName(err), "{s}: {t}\n", .{ path, err });
        break :blk fixture.?.source();
    } else noHooks();

    var outcome = run_host.run(
        gpa,
        &model,
        args.entry,
        &initial_state,
        hook_source,
        args.options,
    ) catch |err| return report(io, @errorName(err), "run failed: {t}\n", .{err});
    defer outcome.deinit(gpa);

    var buffer: [64 * 1024]u8 = undefined;
    var stdout = std.Io.File.stdout().writer(io, &buffer);
    try writeOutcome(&stdout.interface, &outcome, gpa);
    try stdout.interface.flush();
    return 0;
}

/// The hook source for a model that declares none. Reaching it means the model
/// declared a hook after all, and `missing` is what says so.
fn noHooks() run_host.HookSource {
    const Answer = struct {
        fn answer(
            _: *anyopaque,
            request: scene_runner.effect.Request,
            _: std.mem.Allocator,
        ) anyerror!scene_runner.effect.Result {
            return switch (request.kind) {
                .prepare => .{ .prepare = .missing },
                .publish => .{ .publish = .missing },
            };
        }
    };
    return .{ .context = undefined, .answerFn = Answer.answer };
}

fn writeOutcome(
    out: *std.Io.Writer,
    outcome: *const run_host.Outcome,
    allocator: std.mem.Allocator,
) !void {
    var writer: std.json.Stringify = .{ .writer = out, .options = .{ .whitespace = .indent_2 } };
    try writer.beginObject();
    try writer.objectField("finalState");
    const state_json = try outcome.final_state.canonicalJson(allocator);
    defer allocator.free(state_json);
    try writer.print("{s}", .{state_json});
    try writer.objectField("actions");
    try writer.beginArray();
    for (outcome.actions) |action| {
        try writer.beginObject();
        try writer.objectField("sceneId");
        try writer.write(action.scene_id);
        try writer.objectField("actionId");
        try writer.write(action.action_id);
        try writer.objectField("publishOutcomes");
        try writer.beginArray();
        for (action.publish_outcomes) |outcome_item| {
            try writer.beginObject();
            try writer.objectField("hookName");
            try writer.write(outcome_item.hook_name);
            try writer.objectField("status");
            try writer.write(if (outcome_item.status == .ok) "ok" else "error");
            if (outcome_item.status == .err) {
                try writer.objectField("message");
                try writer.write(outcome_item.message);
            }
            try writer.endObject();
        }
        try writer.endArray();
        try writer.endObject();
    }
    try writer.endArray();
    try writer.endObject();
    try out.writeByte('\n');
}

fn fail(io: std.Io, comptime format: []const u8, args: anytype) !void {
    var buffer: [4096]u8 = undefined;
    var stderr = std.Io.File.stderr().writer(io, &buffer);
    try stderr.interface.print(format, args);
    try stderr.interface.flush();
}

/// Report a failure and return the exit code for it: a sentence on stderr for
/// someone reading along, and the code as JSON on stdout for something parsing.
///
/// Every way a model the compiler produced can be refused goes through here. A
/// bare `try` that lets one escape `main` prints a Zig stack trace instead,
/// which names this host's source rather than the caller's model — and the
/// conformance vectors will not catch it, because they assert on error codes
/// and never on wording. A trace is not wording.
fn report(io: std.Io, code: []const u8, comptime format: []const u8, args: anytype) !u8 {
    try fail(io, format, args);
    var error_buffer: [512]u8 = undefined;
    var error_out = std.Io.File.stdout().writer(io, &error_buffer);
    try error_out.interface.print("{{\"error\":", .{});
    try std.json.Stringify.value(code, .{}, &error_out.interface);
    try error_out.interface.print("}}\n", .{});
    try error_out.interface.flush();
    return 1;
}

const ArgError = error{
    MissingCommand,
    UnknownCommand,
    MissingModel,
    MissingValue,
    UnknownOption,
    NoEntry,
    TwoEntries,
    InvalidNumber,
};

fn parseArgs(
    argv: []const []const u8,
    hook_args: *std.ArrayList([]const u8),
    allocator: std.mem.Allocator,
) (ArgError || std.mem.Allocator.Error)!Args {
    if (argv.len == 0) return error.MissingCommand;
    if (!std.mem.eql(u8, argv[0], "run")) return error.UnknownCommand;
    if (argv.len < 2) return error.MissingModel;

    var scene_id: ?[]const u8 = null;
    var route_id: ?[]const u8 = null;
    var args: Args = .{ .model_path = argv[1], .entry = .{ .scene = "" } };

    var index: usize = 2;
    while (index < argv.len) : (index += 1) {
        const argument = argv[index];
        if (std.mem.eql(u8, argument, "--no-check")) {
            args.check = false;
            continue;
        }
        if (std.mem.eql(u8, argument, "--fail-on-publish-error")) {
            args.options.fail_on_publish_error = true;
            continue;
        }
        index += 1;
        if (index == argv.len) return error.MissingValue;
        const option = argv[index];
        if (std.mem.eql(u8, argument, "--scene")) {
            scene_id = option;
        } else if (std.mem.eql(u8, argument, "--route")) {
            route_id = option;
        } else if (std.mem.eql(u8, argument, "--state")) {
            args.state_path = option;
        } else if (std.mem.eql(u8, argument, "--hooks")) {
            args.hooks_path = option;
        } else if (std.mem.eql(u8, argument, "--hook-program")) {
            args.hook_program = option;
        } else if (std.mem.eql(u8, argument, "--hook-arg")) {
            try hook_args.append(allocator, option);
        } else if (std.mem.eql(u8, argument, "--max-scene-steps")) {
            args.options.max_scene_steps = std.fmt.parseInt(usize, option, 10) catch
                return error.InvalidNumber;
        } else if (std.mem.eql(u8, argument, "--max-route-transitions")) {
            args.options.max_route_transitions = std.fmt.parseInt(usize, option, 10) catch
                return error.InvalidNumber;
        } else if (std.mem.eql(u8, argument, "--max-model-merges")) {
            args.options.max_model_merges = std.fmt.parseInt(usize, option, 10) catch
                return error.InvalidNumber;
        } else {
            return error.UnknownOption;
        }
    }

    if (scene_id != null and route_id != null) return error.TwoEntries;
    if (scene_id) |id| {
        args.entry = .{ .scene = id };
    } else if (route_id) |id| {
        args.entry = .{ .route = id };
    } else return error.NoEntry;
    args.hook_args = hook_args.items;
    return args;
}

fn parseTestArgs(argv: []const []const u8) !Args {
    var hook_args: std.ArrayList([]const u8) = .empty;
    defer hook_args.deinit(std.testing.allocator);
    return parseArgs(argv, &hook_args, std.testing.allocator);
}

test "arguments take exactly one entry point" {
    try std.testing.expectError(error.NoEntry, parseTestArgs(&.{ "run", "model.json" }));
    try std.testing.expectError(
        error.TwoEntries,
        parseTestArgs(&.{ "run", "model.json", "--scene", "a", "--route", "b" }),
    );
    try std.testing.expectError(error.UnknownCommand, parseTestArgs(&.{"convert"}));
    try std.testing.expectError(error.MissingCommand, parseTestArgs(&.{}));
    try std.testing.expectError(
        error.MissingValue,
        parseTestArgs(&.{ "run", "model.json", "--scene" }),
    );
    try std.testing.expectError(
        error.UnknownOption,
        parseTestArgs(&.{ "run", "model.json", "--scene", "a", "--nope", "x" }),
    );
}

test "arguments carry the run's entry, files, and limits" {
    const args = try parseTestArgs(&.{
        "run",                     "flow.json",
        "--route",                 "main",
        "--state",                 "state.json",
        "--hooks",                 "hooks.json",
        "--max-model-merges",      "3",
        "--max-scene-steps",       "7",
        "--fail-on-publish-error",
    });
    try std.testing.expectEqualStrings("flow.json", args.model_path);
    try std.testing.expectEqualStrings("main", args.entry.route);
    try std.testing.expectEqualStrings("state.json", args.state_path.?);
    try std.testing.expectEqualStrings("hooks.json", args.hooks_path.?);
    try std.testing.expectEqual(@as(usize, 7), args.options.max_scene_steps);
    try std.testing.expectEqual(@as(usize, 3), args.options.max_model_merges);
    // The structural check is on unless a caller opts out of it.
    try std.testing.expect(args.check);
    const unchecked = try parseTestArgs(&.{ "run", "model.json", "--scene", "a", "--no-check" });
    try std.testing.expect(!unchecked.check);
    try std.testing.expect(args.options.fail_on_publish_error);
}

test {
    _ = hooks;
    _ = run_host;
}
