//! Turnout runtime layer: values, preset functions, and the compute graph.
//!
//! This layer is self-contained. It never imports the scene-runner layer.
//! The TypeScript counterpart is `packages/ts/runtime`.

pub const value = @import("value.zig");
pub const value_vectors = @import("value_vectors.zig");
pub const preset = @import("preset.zig");
pub const preset_vectors = @import("preset_vectors.zig");
pub const compute = @import("compute.zig");
pub const program_ir = @import("program/ir.zig");
pub const program_load = @import("program/load.zig");
pub const program_eval = @import("program/eval.zig");
pub const compute_vectors = @import("compute_vectors.zig");
pub const graph_compute = @import("graph_compute.zig");
pub const graph_validate = @import("graph_validate.zig");
pub const fn_aliases = @import("generated/fn_aliases.zig");

test {
    _ = value;
    _ = value_vectors;
    _ = preset;
    _ = preset_vectors;
    _ = compute;
    _ = program_ir;
    _ = program_load;
    _ = program_eval;
    _ = compute_vectors;
    _ = graph_compute;
    _ = graph_validate;
    _ = fn_aliases;
}
