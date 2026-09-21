const std = @import("std");

pub const Code = enum {
    out_of_memory,
    scene_not_found,
    no_entry_action,
    action_not_found,
    duplicate_action_id,
    max_scene_steps_exceeded,
    route_not_found,
    no_entry_scene,
    invalid_route,
    max_route_transitions_exceeded,
    unknown_function,
    invalid_arity,
    type_mismatch,
    division_by_zero,
    hook_required,
    unregistered_hook,
    missing_hook_field,
    missing_extend_hook,
    prepare_hook_failed,
    publish_hook_failed,
    extend_hook_failed,
    model_merge_conflict,
    missing_action_binding,
    unknown_state_path,
    reserved_state_path,
    unknown_schema_type,
    invalid_literal,
    execution_failed,
};

/// One error and the code it becomes.
pub const Mapping = struct { err: anyerror, code: Code };

/// Every error that gets a code of its own.
///
/// A table rather than a chain of `if`s, because the chain was the whole
/// problem: `fromError` ends in `.execution_failed`, so an error nobody mapped
/// was indistinguishable from one that genuinely has no better name, and
/// nothing failed when a driver grew an error the table had never heard of.
/// `error.PrepareHookFailed` and `error.PublishHookFailed` were both in that
/// state — raised on live driver paths, collapsed to `.execution_failed` here,
/// while the WASM host surfaced them by name and so saw codes the native host
/// could not. As data the mapping can be checked: `runtime_error_vectors.zig`
/// reads this table against the drivers' declared error sets and fails on an
/// error that is neither here nor classified as deliberately unmapped.
pub const mappings = [_]Mapping{
    .{ .err = error.OutOfMemory, .code = .out_of_memory },
    .{ .err = error.SceneNotFound, .code = .scene_not_found },
    .{ .err = error.NoEntryAction, .code = .no_entry_action },
    .{ .err = error.ActionNotFound, .code = .action_not_found },
    .{ .err = error.DuplicateActionId, .code = .duplicate_action_id },
    .{ .err = error.MaxStepsExceeded, .code = .max_scene_steps_exceeded },
    .{ .err = error.RouteNotFound, .code = .route_not_found },
    .{ .err = error.NoEntryScene, .code = .no_entry_scene },
    .{ .err = error.InvalidRoute, .code = .invalid_route },
    .{ .err = error.MaxRouteTransitionsExceeded, .code = .max_route_transitions_exceeded },
    .{ .err = error.UnknownFunction, .code = .unknown_function },
    .{ .err = error.InvalidArity, .code = .invalid_arity },
    .{ .err = error.TypeMismatch, .code = .type_mismatch },
    .{ .err = error.ConditionTypeMismatch, .code = .type_mismatch },
    .{ .err = error.DivisionByZero, .code = .division_by_zero },
    .{ .err = error.HookRequired, .code = .hook_required },
    .{ .err = error.UnregisteredHook, .code = .unregistered_hook },
    .{ .err = error.MissingHookField, .code = .missing_hook_field },
    .{ .err = error.MissingExtendHook, .code = .missing_extend_hook },
    .{ .err = error.PrepareHookFailed, .code = .prepare_hook_failed },
    .{ .err = error.PublishHookFailed, .code = .publish_hook_failed },
    .{ .err = error.ExtendHookFailed, .code = .extend_hook_failed },
    .{ .err = error.ModelMergeConflict, .code = .model_merge_conflict },
    .{ .err = error.MissingActionBinding, .code = .missing_action_binding },
    .{ .err = error.UnknownPath, .code = .unknown_state_path },
    .{ .err = error.ReservedPath, .code = .reserved_state_path },
    .{ .err = error.UnknownSchemaType, .code = .unknown_schema_type },
    .{ .err = error.InvalidLiteral, .code = .invalid_literal },
    .{ .err = error.EmptyLiteralArray, .code = .invalid_literal },
};

pub fn fromError(err: anyerror) Code {
    for (mappings) |entry| {
        if (err == entry.err) return entry.code;
    }
    return .execution_failed;
}

test "runtime errors map to stable codes" {
    try std.testing.expectEqual(Code.unknown_function, fromError(error.UnknownFunction));
    try std.testing.expectEqual(Code.max_scene_steps_exceeded, fromError(error.MaxStepsExceeded));
    try std.testing.expectEqual(Code.unregistered_hook, fromError(error.UnregisteredHook));
    try std.testing.expectEqual(Code.missing_hook_field, fromError(error.MissingHookField));
    try std.testing.expectEqual(Code.prepare_hook_failed, fromError(error.PrepareHookFailed));
    try std.testing.expectEqual(Code.publish_hook_failed, fromError(error.PublishHookFailed));
    try std.testing.expectEqual(Code.execution_failed, fromError(error.UnmappedFailure));
}

test "no error is mapped twice" {
    for (mappings, 0..) |entry, index| {
        for (mappings[index + 1 ..]) |later| {
            if (entry.err == later.err) return error.DuplicateMapping;
        }
    }
}
