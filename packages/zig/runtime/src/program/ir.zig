//! The lowered form of a compute program.
//!
//! A `Program` is what a model's JSON becomes once it has been read. It is a
//! derived runtime entity: never serialized, never version-negotiated, and free
//! to hold arena-allocated slices and resolved indices because nothing outside
//! this process ever sees it.
//!
//! Two properties matter for everything built on top:
//!
//!   - **References are indices.** A binding, parameter, or pipe step is reached
//!     by position, resolved once when the program is loaded. Evaluation never
//!     hashes a string.
//!   - **Errors are data.** A reference that cannot be resolved, or a shape the
//!     loader rejects, becomes an `invalid` node carrying the error to raise.
//!     Evaluation raises it only if it actually reaches that node, which is what
//!     keeps an unresolvable reference in an untaken conditional branch legal.
//!
//! Strings are borrowed from the source JSON, which outlives the program.

const std = @import("std");
const preset = @import("../preset.zig");
const value = @import("../value.zig");

/// Errors evaluation can raise. The loader stores these in `invalid` nodes
/// rather than failing, so that an error surfaces where it used to: at the
/// moment the node is evaluated.
pub const EvalError = error{
    ConditionTypeMismatch,
    DuplicateParameter,
    EmptyPipe,
    InvalidArgument,
    InvalidExpression,
    InvalidStepReference,
    MissingBindingValue,
    MissingReference,
    MissingRootBinding,
    UnsupportedArgument,
};

/// A resolved preset, or the error to raise for a name that does not name one.
pub const Function = union(enum) {
    resolved: preset.Fn,
    unknown,
};

/// Where an argument gets its value. Every variant but `literal` and `invalid`
/// is an index resolved when the program was loaded.
pub const Arg = union(enum) {
    /// A binding declared earlier in the program.
    binding: u32,
    /// A parameter of the enclosing pipe.
    param: u32,
    /// The result of an earlier step of the enclosing pipe.
    step: u32,
    /// An inline value, already converted out of JSON.
    literal: value.Value,
    /// A reference with a chain of transforms applied to it.
    transform: Transform,
    invalid: EvalError,
};

pub const Transform = struct {
    /// Always a `binding`, `param`, or `invalid`; transforms do not nest.
    source: *const Arg,
    functions: []const Function,
};

pub const Call = struct {
    function: Function,
    args: []const Arg,
};

pub const PipeStep = union(enum) {
    call: Call,
    invalid: EvalError,
};

pub const Pipe = struct {
    /// Bound in order before any step runs; index order is parameter order.
    params: []const Arg,
    steps: []const PipeStep,
};

pub const Cond = struct {
    condition: Arg,
    then_branch: Arg,
    else_branch: Arg,
};

pub const Body = union(enum) {
    /// No expression. The value comes from the prepared inputs, falling back to
    /// this literal; `null` means an input is required and its absence is
    /// `MissingBindingValue`.
    supplied: ?value.Value,
    combine: Call,
    pipe: Pipe,
    cond: Cond,
    invalid: EvalError,
};

pub const Binding = struct {
    /// Borrowed from the source JSON. Needed to match prepared inputs and to
    /// key the result map; never used to resolve a reference.
    name: []const u8,
    body: Body,
};

/// What the program resolves to. `none` and `unresolved` differ: declaring no
/// root yields a `missing` null, while naming one that does not exist is an
/// error.
pub const Root = union(enum) {
    none,
    binding: u32,
    unresolved,
};

/// A lowered program. Its slices live in whatever allocator lowered it, which
/// is why the arena is not part of it: a model lowers every one of its programs
/// into a single arena, while a one-off lowering owns its own.
pub const Program = struct {
    bindings: []const Binding,
    root: Root,
};

/// A program that owns the arena it was lowered into. Used where a program has
/// no longer-lived home, such as a single ad-hoc execution.
pub const OwnedProgram = struct {
    arena: std.heap.ArenaAllocator,
    program: Program,

    pub fn deinit(self: *OwnedProgram) void {
        self.arena.deinit();
        self.* = undefined;
    }
};
