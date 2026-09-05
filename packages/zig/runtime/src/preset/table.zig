//! Comptime dispatch table for the preset functions.
//!
//! One declarative list drives three things that used to be a 39-entry linear
//! alias scan and a 43-comparison `std.mem.eql` chain: the `Fn` enum, the name
//! lookup, and the dispatch switch. Adding a preset means adding a row; the
//! arity and the argument types are read from the kernel's own signature, so a
//! mismatch is a compile error rather than a runtime `InvalidArity`.
//!
//! The authoring-time metadata (`inputType`, `returnType`, and friends) stays in
//! `preset.zig`. It answers by name prefix, deliberately including names this
//! table does not list, which hand-written graphs from the builder API rely on.

const std = @import("std");
const kernel = @import("kernel.zig");
const value = @import("../value.zig");

const TaggedValue = value.TaggedValue;
const Value = value.Value;

pub const Error = kernel.Error;

/// What dispatch can fail with: a preset's own errors plus allocation.
pub const CallError = kernel.Error || std.mem.Allocator.Error;

/// Which argument tags flow into the result.
///
/// `merge_all` is the rule almost everywhere: union the tags of every argument,
/// first occurrence first. The two exceptions are load-bearing and were found in
/// the code being replaced, not chosen here.
pub const Tags = enum {
    /// Union of every argument's tags.
    merge_all,
    /// First argument only. `extractNum` alone does this.
    first,
    /// Accessed element first, then the container and key. `arrGet`/`recordGet`.
    element_first,
};

pub const CallFn = *const fn ([]const TaggedValue, std.mem.Allocator) CallError!value.OwnedTaggedValue;

pub const Row = struct {
    /// Sentinel-terminated so the name can become an enum field name directly.
    name: [:0]const u8,
    call: CallFn,
    /// Arguments the kernel consumes, read from its signature.
    arity: usize,
};

fn row(comptime name: [:0]const u8, comptime impl: anytype, comptime tags: Tags) Row {
    return .{
        .name = name,
        .call = Invoker(impl, tags).call,
        .arity = argCount(@TypeOf(impl)),
    };
}

/// Every preset the runtime accepts. Order fixes the `Fn` enum values, so rows
/// are appended rather than inserted.
pub const rows = [_]Row{
    // combineFnNumber
    row("combineFnNumber::add", kernel.add, .merge_all),
    row("combineFnNumber::minus", kernel.minus, .merge_all),
    row("combineFnNumber::multiply", kernel.multiply, .merge_all),
    row("combineFnNumber::divide", kernel.divide, .merge_all),
    row("combineFnNumber::mod", kernel.modulo, .merge_all),
    row("combineFnNumber::max", kernel.maximum, .merge_all),
    row("combineFnNumber::min", kernel.minimum, .merge_all),
    row("combineFnNumber::greaterThan", kernel.greaterThan, .merge_all),
    row("combineFnNumber::greaterThanOrEqual", kernel.greaterThanOrEqual, .merge_all),
    row("combineFnNumber::lessThan", kernel.lessThan, .merge_all),
    row("combineFnNumber::lessThanOrEqual", kernel.lessThanOrEqual, .merge_all),
    // combineFnBoolean
    row("combineFnBoolean::and", kernel.boolAnd, .merge_all),
    row("combineFnBoolean::or", kernel.boolOr, .merge_all),
    row("combineFnBoolean::xor", kernel.boolXor, .merge_all),
    // combineFnGeneric
    row("combineFnGeneric::isEqual", kernel.isEqual, .merge_all),
    row("combineFnGeneric::isNotEqual", kernel.isNotEqual, .merge_all),
    // combineFnString
    row("combineFnString::concat", kernel.strConcat, .merge_all),
    row("combineFnString::includes", kernel.strIncludes, .merge_all),
    row("combineFnString::startsWith", kernel.strStartsWith, .merge_all),
    row("combineFnString::endsWith", kernel.strEndsWith, .merge_all),
    row("combineFnString::extract", kernel.strExtract, .merge_all),
    row("combineFnString::extractNum", kernel.strExtractNum, .first),
    // combineFnArray
    row("combineFnArray::concat", kernel.arrConcat, .merge_all),
    row("combineFnArray::includes", kernel.arrIncludes, .merge_all),
    row("combineFnArray::get", kernel.arrGet, .element_first),
    row("combineFnArray::getNumber", kernel.arrGet, .element_first),
    row("combineFnArray::getString", kernel.arrGet, .element_first),
    row("combineFnArray::getBoolean", kernel.arrGet, .element_first),
    row("combineFnArray::getArray", kernel.arrGet, .element_first),
    row("combineFnArray::getRecord", kernel.arrGet, .element_first),
    // combineFnRecord
    row("combineFnRecord::get", kernel.recordGet, .element_first),
    row("combineFnRecord::getNumber", kernel.recordGet, .element_first),
    row("combineFnRecord::getString", kernel.recordGet, .element_first),
    row("combineFnRecord::getBoolean", kernel.recordGet, .element_first),
    row("combineFnRecord::getArray", kernel.recordGet, .element_first),
    row("combineFnRecord::getRecord", kernel.recordGet, .element_first),
    row("combineFnRecord::set", recordSet, .merge_all),
    // transformFnNumber
    row("transformFnNumber::abs", kernel.absolute, .merge_all),
    row("transformFnNumber::floor", kernel.floor, .merge_all),
    row("transformFnNumber::ceil", kernel.ceil, .merge_all),
    row("transformFnNumber::round", kernel.round, .merge_all),
    row("transformFnNumber::negate", kernel.negate, .merge_all),
    row("transformFnNumber::toStr", kernel.numToStr, .merge_all),
    row("transformFnNumber::pass", kernel.pass, .merge_all),
    // transformFnBoolean
    row("transformFnBoolean::not", kernel.boolNot, .merge_all),
    row("transformFnBoolean::toStr", kernel.boolToStr, .merge_all),
    row("transformFnBoolean::pass", kernel.pass, .merge_all),
    // transformFnString
    row("transformFnString::trim", kernel.strTrim, .merge_all),
    row("transformFnString::toNumber", kernel.strToNumber, .merge_all),
    row("transformFnString::toLowerCase", kernel.strLower, .merge_all),
    row("transformFnString::toUpperCase", kernel.strUpper, .merge_all),
    row("transformFnString::length", kernel.strLength, .merge_all),
    row("transformFnString::pass", kernel.pass, .merge_all),
    // transformFnArray
    row("transformFnArray::length", kernel.arrLength, .merge_all),
    row("transformFnArray::isEmpty", kernel.arrIsEmpty, .merge_all),
    row("transformFnArray::pass", kernel.pass, .merge_all),
    // remaining pass-throughs
    row("transformFnNull::pass", kernel.pass, .merge_all),
    row("transformFnRecord::pass", kernel.pass, .merge_all),
};

/// One integer per preset. Field names are the wire names, so `@tagName` round
/// trips and no second table is needed to recover a name.
pub const Fn = blk: {
    const Tag = std.math.IntFittingRange(0, rows.len - 1);
    var names: [rows.len][:0]const u8 = undefined;
    for (rows, 0..) |entry, index| names[index] = entry.name;
    break :blk @Enum(Tag, .exhaustive, &names, &std.simd.iota(Tag, rows.len));
};

/// Comptime perfect hash. Consulted once per program load, never per execution.
pub const byName = blk: {
    var pairs: [rows.len]struct { []const u8, Fn } = undefined;
    for (rows, 0..) |entry, index| pairs[index] = .{ entry.name, @as(Fn, @enumFromInt(index)) };
    break :blk std.StaticStringMap(Fn).initComptime(pairs);
};

pub fn lookup(name: []const u8) ?Fn {
    if (byName.get(name)) |found| return found;
    // Historic catch-all: any `X::pass` is the identity. The enumerated rows
    // cover every name the compiler emits, so this only keeps hand-written
    // graphs from the authoring API working.
    if (std.mem.endsWith(u8, name, "::pass")) return @field(Fn, "transformFnNull::pass");
    return null;
}

pub fn rowOf(function: Fn) Row {
    return rows[@intFromEnum(function)];
}

/// Arguments the preset consumes. Unlike the authoring-time `preset.arity`,
/// which reports how many slots a *combine* binds, this is the real count for
/// every preset, transforms included.
pub fn argumentCount(function: Fn) usize {
    return rowOf(function).arity;
}

/// Dispatch through a dense integer index, not a chain of string comparisons.
pub fn call(
    function: Fn,
    args: []const TaggedValue,
    allocator: std.mem.Allocator,
) CallError!value.OwnedTaggedValue {
    return rowOf(function).call(args, allocator);
}

// ── signature-derived invocation ────────────────────────────────────────────

fn takesAllocator(comptime Impl: type) bool {
    const params = @typeInfo(Impl).@"fn".params;
    return params.len > 0 and params[0].type.? == std.mem.Allocator;
}

fn argCount(comptime Impl: type) usize {
    const params = @typeInfo(Impl).@"fn".params;
    return params.len - @intFromBool(takesAllocator(Impl));
}

/// Bridges a kernel's plain signature to the tagged-value calling convention:
/// arity check, argument unpacking, tag merge, and result ownership, all derived
/// from the kernel's own type. Nothing here can drift from the kernel, because
/// it is read from the kernel.
fn Invoker(comptime impl: anytype, comptime tags: Tags) type {
    const Impl = @TypeOf(impl);
    const with_allocator = takesAllocator(Impl);
    const offset = @intFromBool(with_allocator);
    const arity = @typeInfo(Impl).@"fn".params.len - offset;

    return struct {
        fn call(
            args: []const TaggedValue,
            allocator: std.mem.Allocator,
        ) CallError!value.OwnedTaggedValue {
            if (args.len != arity) return error.InvalidArity;

            var call_args: std.meta.ArgsTuple(Impl) = undefined;
            if (with_allocator) call_args[0] = allocator;
            inline for (0..arity) |index| {
                call_args[index + offset] = try unpack(
                    @TypeOf(call_args[index + offset]),
                    args[index],
                );
            }

            const raw = @call(.auto, impl, call_args);
            const result = if (@typeInfo(@TypeOf(raw)) == .error_union) try raw else raw;
            return build(@TypeOf(result), result, args, allocator);
        }

        fn build(
            comptime Result: type,
            result: Result,
            args: []const TaggedValue,
            allocator: std.mem.Allocator,
        ) CallError!value.OwnedTaggedValue {
            if (tags == .element_first) {
                // The accessed element's own tags come first, then the tags of
                // the container and the key that reached it.
                const access = try value.mergeTags(args[0].tags, args[1].tags, allocator);
                defer allocator.free(access);
                const merged = try value.mergeTags(result.tags, access, allocator);
                defer allocator.free(merged);
                return value.build(result.value, merged, allocator);
            }

            const merged = try resultTags(args, allocator);
            defer allocator.free(merged);

            return switch (Result) {
                f64 => value.buildNumber(result, merged, allocator),
                bool => value.buildBoolean(result, merged, allocator),
                []const u8 => value.buildString(result, merged, allocator),
                kernel.Rendered => value.buildString(result.slice(), merged, allocator),
                Value => value.build(result, merged, allocator),
                // Owned buffers: copied into the result, then released.
                []u8 => blk: {
                    defer allocator.free(result);
                    break :blk value.buildString(result, merged, allocator);
                },
                []TaggedValue => blk: {
                    defer allocator.free(result);
                    break :blk value.build(.{ .array = .{ .items = result } }, merged, allocator);
                },
                // The kernel already owns its result; the tag policy still applies.
                value.OwnedTaggedValue => blk: {
                    var owned = result;
                    allocator.free(owned.tags);
                    owned.tags = try value.mergeTags(merged, &.{}, allocator);
                    break :blk owned;
                },
                else => @compileError("preset kernel returns unsupported type " ++ @typeName(Result)),
            };
        }

        fn resultTags(args: []const TaggedValue, allocator: std.mem.Allocator) CallError![]const []const u8 {
            if (tags == .first) return value.mergeTags(args[0].tags, &.{}, allocator);
            var merged: []const []const u8 = try allocator.alloc([]const u8, 0);
            errdefer allocator.free(merged);
            for (args) |arg| {
                const next = try value.mergeTags(merged, arg.tags, allocator);
                allocator.free(merged);
                merged = next;
            }
            return merged;
        }
    };
}

/// Maps a kernel parameter type onto the payload it expects, rejecting anything
/// else as a type mismatch. This is the only argument type check in the runtime.
fn unpack(comptime Param: type, arg: TaggedValue) kernel.Error!Param {
    return switch (Param) {
        f64 => if (arg.value == .number) arg.value.number else error.TypeMismatch,
        bool => if (arg.value == .boolean) arg.value.boolean else error.TypeMismatch,
        []const u8 => if (arg.value == .string) arg.value.string else error.TypeMismatch,
        []const TaggedValue => if (arg.value == .array) arg.value.array.items else error.TypeMismatch,
        kernel.Record => if (arg.value == .record) arg.value.record else error.TypeMismatch,
        Value => arg.value,
        TaggedValue => arg,
        else => @compileError("preset kernel takes unsupported parameter " ++ @typeName(Param)),
    };
}

// ── the one preset that owns its result ─────────────────────────────────────

/// `set` builds a whole new record rather than viewing an existing one, so it
/// returns an owned value instead of a borrow for the caller to clone. The
/// invoker still applies the tag policy to it.
fn recordSet(
    allocator: std.mem.Allocator,
    record: kernel.Record,
    key: Value,
    item: TaggedValue,
) CallError!value.OwnedTaggedValue {
    var buffer: kernel.KeyBuffer = undefined;
    const resolved = try kernel.recordKey(key, &buffer);
    if (kernel.isReservedKey(resolved)) return error.TypeMismatch;

    var result = try value.build(.{ .record = record }, &.{}, allocator);
    errdefer result.deinit(allocator);
    var owned = try value.build(item.value, item.tags, allocator);
    const tagged: TaggedValue = .{ .value = owned.value, .tags = owned.tags };
    owned = undefined;
    if (result.value.record.getPtr(resolved)) |existing| {
        value.deinitTaggedValue(existing, allocator);
        existing.* = tagged;
        return result;
    }
    const owned_key = try allocator.dupe(u8, resolved);
    result.value.record.put(allocator, owned_key, tagged) catch |err| {
        allocator.free(owned_key);
        var cleanup = tagged;
        value.deinitTaggedValue(&cleanup, allocator);
        return err;
    };
    return result;
}
