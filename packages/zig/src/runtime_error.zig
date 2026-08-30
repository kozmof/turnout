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
    missing_action_binding,
    unknown_state_path,
    reserved_state_path,
    unknown_schema_type,
    invalid_literal,
    execution_failed,
};

pub fn fromError(err: anyerror) Code {
    if (err == error.OutOfMemory) return .out_of_memory;
    if (err == error.SceneNotFound) return .scene_not_found;
    if (err == error.NoEntryAction) return .no_entry_action;
    if (err == error.ActionNotFound) return .action_not_found;
    if (err == error.DuplicateActionId) return .duplicate_action_id;
    if (err == error.MaxStepsExceeded) return .max_scene_steps_exceeded;
    if (err == error.RouteNotFound) return .route_not_found;
    if (err == error.NoEntryScene) return .no_entry_scene;
    if (err == error.InvalidRoute) return .invalid_route;
    if (err == error.MaxRouteTransitionsExceeded) return .max_route_transitions_exceeded;
    if (err == error.UnknownFunction) return .unknown_function;
    if (err == error.InvalidArity) return .invalid_arity;
    if (err == error.TypeMismatch or err == error.ConditionTypeMismatch) return .type_mismatch;
    if (err == error.DivisionByZero) return .division_by_zero;
    if (err == error.HookRequired) return .hook_required;
    if (err == error.MissingActionBinding) return .missing_action_binding;
    if (err == error.UnknownPath) return .unknown_state_path;
    if (err == error.ReservedPath) return .reserved_state_path;
    if (err == error.UnknownSchemaType) return .unknown_schema_type;
    if (err == error.InvalidLiteral or err == error.EmptyLiteralArray) return .invalid_literal;
    return .execution_failed;
}

test "runtime errors map to stable codes" {
    try std.testing.expectEqual(Code.unknown_function, fromError(error.UnknownFunction));
    try std.testing.expectEqual(Code.max_scene_steps_exceeded, fromError(error.MaxStepsExceeded));
    try std.testing.expectEqual(Code.execution_failed, fromError(error.UnmappedFailure));
}
