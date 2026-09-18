//! The driver loop, with the world behind one interface.
//!
//! This is the half of a host that is not about any particular transport: load
//! a model, start a driver, pump it, answer the effects it asks for, and report
//! what happened. Who answers the effects is the caller's business — a child
//! process over a pipe, a fixture file, a library caller — so it arrives as a
//! `HookSource` rather than being reached for here.
//!
//! The WASM ABI does the same loop with the host on the far side of the
//! boundary. That is the only difference between the two shells.
const std = @import("std");
const scene_runner = @import("turnout_scene_runner");
const turnout_value = @import("turnout_runtime").value;

const effect = scene_runner.effect;
const model_runtime = scene_runner.model;
const runner = scene_runner.runner;
const state_runtime = scene_runner.state;

pub const Entry = union(enum) {
    scene: []const u8,
    route: []const u8,
};

/// Answers the effect requests a run produces.
///
/// A vtable rather than a comptime parameter so that one binary can carry
/// several transports and pick at run time, which is what a CLI flag is.
pub const HookSource = struct {
    context: *anyopaque,
    answerFn: *const fn (
        context: *anyopaque,
        request: effect.Request,
        arena: std.mem.Allocator,
    ) anyerror!effect.Result,

    pub fn answer(
        self: HookSource,
        request: effect.Request,
        arena: std.mem.Allocator,
    ) anyerror!effect.Result {
        return self.answerFn(self.context, request, arena);
    }
};

pub const PublishOutcome = struct {
    hook_name: []const u8,
    status: enum { ok, err },
    message: []const u8 = "",
};

pub const ActionRecord = struct {
    scene_id: []const u8,
    action_id: []const u8,
    publish_outcomes: []PublishOutcome,
};

pub const Outcome = struct {
    arena: std.heap.ArenaAllocator,
    actions: []ActionRecord,
    final_state: state_runtime.State,

    pub fn deinit(self: *Outcome, allocator: std.mem.Allocator) void {
        self.final_state.deinit(allocator);
        self.arena.deinit();
        self.* = undefined;
    }
};

pub const Options = struct {
    fail_on_publish_error: bool = false,
    max_scene_steps: usize = 10_000,
    max_route_transitions: usize = 1_000,
};

const Driver = union(enum) {
    scene: runner.SceneDriver,
    route: runner.RouteDriver,

    fn deinit(self: *Driver) void {
        switch (self.*) {
            inline else => |*driver| driver.deinit(),
        }
    }

    fn step(self: *Driver, model: *const model_runtime.RuntimeModel, fail_on_publish_error: bool) !runner.Event {
        return switch (self.*) {
            inline else => |*driver| driver.step(model, fail_on_publish_error),
        };
    }

    fn resumeEffect(self: *Driver, id: u64, result: effect.Result) !void {
        return switch (self.*) {
            inline else => |*driver| driver.@"resume"(id, result),
        };
    }

    fn partialState(self: *const Driver) *const state_runtime.State {
        return switch (self.*) {
            inline else => |*driver| driver.partialState(),
        };
    }
};

/// Runs one model to completion, answering every effect through `hooks`.
///
/// The returned outcome owns an arena holding the trace, so the ids it borrowed
/// from the model outlive the model handle no longer than the outcome does.
pub fn run(
    allocator: std.mem.Allocator,
    model: *const model_runtime.RuntimeModel,
    entry: Entry,
    initial_state: *const state_runtime.State,
    hooks: HookSource,
    options: Options,
) !Outcome {
    var driver: Driver = switch (entry) {
        .scene => |id| .{ .scene = try runner.SceneDriver.initWithLimit(
            allocator,
            model,
            id,
            initial_state,
            options.max_scene_steps,
        ) },
        .route => |id| .{ .route = try runner.RouteDriver.init(
            allocator,
            model,
            id,
            initial_state,
            options.max_scene_steps,
            options.max_route_transitions,
        ) },
    };
    defer driver.deinit();

    var arena: std.heap.ArenaAllocator = .init(allocator);
    errdefer arena.deinit();
    const trace_allocator = arena.allocator();
    var actions: std.ArrayList(ActionRecord) = .empty;

    while (true) {
        const event = try driver.step(model, options.fail_on_publish_error);
        switch (event) {
            .need_effect => |request| {
                // One arena per effect: a hook's answer is copied into the
                // runtime by resume, and nothing outlives the call.
                var effect_arena: std.heap.ArenaAllocator = .init(allocator);
                defer effect_arena.deinit();
                const result = try hooks.answer(request, effect_arena.allocator());
                try driver.resumeEffect(request.id, result);
            },
            .action_complete => |completed| {
                const outcomes = try trace_allocator.alloc(PublishOutcome, completed.publish_outcomes.len);
                for (completed.publish_outcomes, 0..) |outcome, index| {
                    outcomes[index] = .{
                        .hook_name = try trace_allocator.dupe(u8, outcome.hook_name),
                        .status = if (outcome.status == .ok) .ok else .err,
                        .message = try trace_allocator.dupe(u8, outcome.message orelse ""),
                    };
                }
                try actions.append(trace_allocator, .{
                    .scene_id = try trace_allocator.dupe(u8, completed.scene_id),
                    .action_id = try trace_allocator.dupe(u8, completed.action_id),
                    .publish_outcomes = outcomes,
                });
            },
            .scene_changed => {},
            .extend_model => return error.UnappliedExtend,
            .complete, .cancelled => break,
        }
    }

    return .{
        .arena = arena,
        .actions = try actions.toOwnedSlice(trace_allocator),
        .final_state = try driver.partialState().snapshot(allocator),
    };
}
