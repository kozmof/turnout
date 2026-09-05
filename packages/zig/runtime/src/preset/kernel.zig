//! Pure preset implementations.
//!
//! Every function here is a plain value transformation. Most take no allocator
//! at all; the ones that do allocate only because their result is genuinely new
//! bytes, and they say so in the return type:
//!
//!   - `[]const u8` / `[]const TaggedValue` / `Value` / `TaggedValue` are
//!     borrowed views. The caller clones them and must not free them.
//!   - `[]u8` / `[]TaggedValue` are owned buffers. The caller frees them after
//!     copying out. `[]TaggedValue` is a shallow buffer: free the slice, never
//!     its elements.
//!
//! `table.zig` derives arity, argument unpacking, and type checking from these
//! signatures, so a change here changes the dispatch layer with it.

const std = @import("std");
const value = @import("../value.zig");
const unicode_case = @import("../generated/unicode_case.zig");

const TaggedValue = value.TaggedValue;
const Value = value.Value;

pub const Error = error{
    DivisionByZero,
    ModuloByZero,
    InvalidUtf8,
    UnknownFunction,
    InvalidArity,
    TypeMismatch,
    IndexOutOfBounds,
    IncomparableValues,
    InvalidTemplateSpec,
    InvalidNumber,
};

// ── numbers ─────────────────────────────────────────────────────────────────

pub fn add(a: f64, b: f64) f64 {
    return a + b;
}

pub fn minus(a: f64, b: f64) f64 {
    return a - b;
}

pub fn multiply(a: f64, b: f64) f64 {
    return a * b;
}

pub fn divide(a: f64, b: f64) Error!f64 {
    if (b == 0) return error.DivisionByZero;
    return a / b;
}

pub fn modulo(a: f64, b: f64) Error!f64 {
    if (b == 0) return error.ModuloByZero;
    return @mod(a, b);
}

pub fn maximum(a: f64, b: f64) f64 {
    return @max(a, b);
}

pub fn minimum(a: f64, b: f64) f64 {
    return @min(a, b);
}

pub fn greaterThan(a: f64, b: f64) bool {
    return a > b;
}

pub fn greaterThanOrEqual(a: f64, b: f64) bool {
    return a >= b;
}

pub fn lessThan(a: f64, b: f64) bool {
    return a < b;
}

pub fn lessThanOrEqual(a: f64, b: f64) bool {
    return a <= b;
}

pub fn absolute(a: f64) f64 {
    return @abs(a);
}

pub fn floor(a: f64) f64 {
    return @floor(a);
}

pub fn ceil(a: f64) f64 {
    return @ceil(a);
}

/// ECMAScript `Math.round`: half rounds toward +Infinity, and the negative
/// half-open interval [-0.5, 0) rounds to -0.
pub fn round(a: f64) f64 {
    if (std.math.isNan(a) or std.math.isInf(a)) return a;
    if (a < 0 and a >= -0.5) return -0.0;
    return @floor(a + 0.5);
}

pub fn negate(a: f64) f64 {
    return -a;
}

// ── booleans ────────────────────────────────────────────────────────────────

pub fn boolAnd(a: bool, b: bool) bool {
    return a and b;
}

pub fn boolOr(a: bool, b: bool) bool {
    return a or b;
}

pub fn boolXor(a: bool, b: bool) bool {
    return a != b;
}

pub fn boolNot(a: bool) bool {
    return !a;
}

pub fn boolToStr(a: bool) []const u8 {
    return if (a) "true" else "false";
}

// ── generic ─────────────────────────────────────────────────────────────────

/// Records are never comparable, and mismatched kinds are an error rather than
/// a false result.
pub fn isEqual(a: Value, b: Value) Error!bool {
    const comparable = switch (a) {
        .number => b == .number,
        .string => b == .string,
        .boolean => b == .boolean,
        .null_value => b == .null_value,
        .array => b == .array,
        .record => false,
    };
    if (!comparable) return error.IncomparableValues;
    return a.eql(b);
}

pub fn isNotEqual(a: Value, b: Value) Error!bool {
    return !try isEqual(a, b);
}

pub fn pass(a: Value) Value {
    return a;
}

// ── strings ─────────────────────────────────────────────────────────────────

pub fn strIncludes(haystack: []const u8, needle: []const u8) bool {
    return std.mem.indexOf(u8, haystack, needle) != null;
}

pub fn strStartsWith(haystack: []const u8, needle: []const u8) bool {
    return std.mem.startsWith(u8, haystack, needle);
}

pub fn strEndsWith(haystack: []const u8, needle: []const u8) bool {
    return std.mem.endsWith(u8, haystack, needle);
}

pub fn strConcat(allocator: std.mem.Allocator, a: []const u8, b: []const u8) ![]u8 {
    return std.mem.concat(allocator, u8, &.{ a, b });
}

/// Borrows a subslice of `bytes`.
pub fn strTrim(bytes: []const u8) Error![]const u8 {
    if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidUtf8;
    var start: usize = 0;
    while (start < bytes.len) {
        const sequence_len = std.unicode.utf8ByteSequenceLength(bytes[start]) catch return error.InvalidUtf8;
        const scalar = std.unicode.utf8Decode(bytes[start..][0..sequence_len]) catch return error.InvalidUtf8;
        if (!isEcmaWhitespace(scalar)) break;
        start += sequence_len;
    }

    var end = bytes.len;
    while (end > start) {
        var scalar_start = end - 1;
        while (scalar_start > start and (bytes[scalar_start] & 0b1100_0000) == 0b1000_0000) scalar_start -= 1;
        const scalar = std.unicode.utf8Decode(bytes[scalar_start..end]) catch return error.InvalidUtf8;
        if (!isEcmaWhitespace(scalar)) break;
        end = scalar_start;
    }
    return bytes[start..end];
}

pub fn strToNumber(bytes: []const u8) Error!f64 {
    const trimmed = try strTrim(bytes);
    if (trimmed.len == 0) return error.InvalidNumber;
    const number = std.fmt.parseFloat(f64, trimmed) catch return error.InvalidNumber;
    if (!std.math.isFinite(number)) return error.InvalidNumber;
    return number;
}

/// JavaScript-visible length, so astral scalars count as two UTF-16 units.
pub fn strLength(bytes: []const u8) Error!f64 {
    if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidUtf8;
    var length: usize = 0;
    var index: usize = 0;
    while (index < bytes.len) {
        const sequence_len = std.unicode.utf8ByteSequenceLength(bytes[index]) catch return error.InvalidUtf8;
        const scalar = std.unicode.utf8Decode(bytes[index..][0..sequence_len]) catch return error.InvalidUtf8;
        length += if (scalar > 0xFFFF) 2 else 1;
        index += sequence_len;
    }
    return @floatFromInt(length);
}

pub fn strLower(allocator: std.mem.Allocator, bytes: []const u8) ![]u8 {
    return changeCase(allocator, bytes, .lower);
}

pub fn strUpper(allocator: std.mem.Allocator, bytes: []const u8) ![]u8 {
    return changeCase(allocator, bytes, .upper);
}

/// A number rendered with JavaScript's `Number.prototype.toString` boundaries,
/// returned by value so the conversion needs no allocator.
pub const Rendered = struct {
    bytes: [std.fmt.float.bufferSize(.decimal, f64) + 1]u8 = undefined,
    len: usize = 0,

    pub fn slice(self: *const Rendered) []const u8 {
        return self.bytes[0..self.len];
    }

    fn from(source: []const u8) Rendered {
        var rendered: Rendered = .{ .len = source.len };
        @memcpy(rendered.bytes[0..source.len], source);
        return rendered;
    }
};

pub fn numToStr(number: f64) Rendered {
    if (std.math.isNan(number)) return Rendered.from("NaN");
    if (std.math.isPositiveInf(number)) return Rendered.from("Infinity");
    if (std.math.isNegativeInf(number)) return Rendered.from("-Infinity");
    if (number == 0) return Rendered.from("0");

    var rendered: Rendered = .{};
    const magnitude = @abs(number);
    if (magnitude >= 1e-6 and magnitude < 1e21) {
        const decimal = std.fmt.float.render(&rendered.bytes, number, .{ .mode = .decimal }) catch unreachable;
        rendered.len = decimal.len;
        return rendered;
    }
    const scientific = std.fmt.float.render(&rendered.bytes, number, .{ .mode = .scientific }) catch unreachable;
    const exponent = std.mem.indexOfScalar(u8, scientific, 'e').?;
    if (scientific[exponent + 1] == '-') {
        rendered.len = scientific.len;
        return rendered;
    }
    // JavaScript writes a positive exponent as `e+21`; Zig omits the sign.
    std.mem.copyBackwards(
        u8,
        rendered.bytes[exponent + 2 .. scientific.len + 1],
        rendered.bytes[exponent + 1 .. scientific.len],
    );
    rendered.bytes[exponent + 1] = '+';
    rendered.len = scientific.len + 1;
    return rendered;
}

// ── arrays ──────────────────────────────────────────────────────────────────

pub fn arrLength(items: []const TaggedValue) f64 {
    return @floatFromInt(items.len);
}

pub fn arrIsEmpty(items: []const TaggedValue) bool {
    return items.len == 0;
}

pub fn arrIncludes(items: []const TaggedValue, needle: Value) Error!bool {
    if (needle == .array or needle == .record) return error.TypeMismatch;
    for (items) |item| if (item.value.eql(needle)) return true;
    return false;
}

/// Borrows the element. The caller merges its tags and clones it.
pub fn arrGet(items: []const TaggedValue, raw_index: f64) Error!TaggedValue {
    if (!std.math.isFinite(raw_index) or @floor(raw_index) != raw_index or raw_index < 0)
        return error.IndexOutOfBounds;
    const index: usize = @intFromFloat(raw_index);
    if (index >= items.len) return error.IndexOutOfBounds;
    return items[index];
}

/// Shallow: the returned slice is owned, its elements are not.
pub fn arrConcat(
    allocator: std.mem.Allocator,
    a: []const TaggedValue,
    b: []const TaggedValue,
) ![]TaggedValue {
    const joined = try allocator.alloc(TaggedValue, a.len + b.len);
    @memcpy(joined[0..a.len], a);
    @memcpy(joined[a.len..], b);
    return joined;
}

// ── records ─────────────────────────────────────────────────────────────────

pub const Record = std.StringArrayHashMapUnmanaged(TaggedValue);

/// Scratch space for rendering a number used as a record key.
pub const KeyBuffer = [64]u8;

/// Borrows either the key string itself or a rendering of it into `buffer`.
/// Number keys use `{d}`, matching what the record was built with.
pub fn recordKey(key: Value, buffer: *KeyBuffer) Error![]const u8 {
    return switch (key) {
        .string => |string| string,
        .number => |number| std.fmt.bufPrint(buffer, "{d}", .{number}) catch return error.TypeMismatch,
        else => error.TypeMismatch,
    };
}

/// Borrows the entry. The caller merges its tags and clones it.
pub fn recordGet(record: Record, key: Value) Error!TaggedValue {
    var buffer: KeyBuffer = undefined;
    const resolved = try recordKey(key, &buffer);
    return record.get(resolved) orelse error.IndexOutOfBounds;
}

/// Property names JavaScript treats specially never become record keys.
pub fn isReservedKey(key: []const u8) bool {
    return std.mem.eql(u8, key, "__proto__") or
        std.mem.eql(u8, key, "constructor") or
        std.mem.eql(u8, key, "prototype");
}

// ── template extraction ─────────────────────────────────────────────────────

/// Borrows a subslice of `subject`; the spec is only read.
pub fn extractCapture(
    allocator: std.mem.Allocator,
    subject: []const u8,
    spec_json: []const u8,
) ![]const u8 {
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, spec_json, .{}) catch
        return error.InvalidTemplateSpec;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidTemplateSpec;
    const want_value = parsed.value.object.get("want") orelse return error.InvalidTemplateSpec;
    const segs_value = parsed.value.object.get("segs") orelse return error.InvalidTemplateSpec;
    if (want_value != .string or segs_value != .array) return error.InvalidTemplateSpec;
    return matchSegments(segs_value.array.items, 0, subject, want_value.string) orelse "";
}

fn matchSegments(segs: []const std.json.Value, index: usize, remaining: []const u8, wanted: []const u8) ?[]const u8 {
    if (index >= segs.len) return if (remaining.len == 0) "" else null;
    if (segs[index] != .object) return null;
    const segment = segs[index].object;
    if (segment.get("text")) |text| {
        if (text != .string or !std.mem.startsWith(u8, remaining, text.string)) return null;
        return matchSegments(segs, index + 1, remaining[text.string.len..], wanted);
    }
    const capture = segment.get("cap") orelse return null;
    if (capture != .string) return null;
    if (index == segs.len - 1) {
        if (!captureAccepts(remaining, segment)) return null;
        return if (std.mem.eql(u8, capture.string, wanted)) remaining else "";
    }
    var end: usize = 1;
    while (end <= remaining.len) : (end += 1) {
        const raw = remaining[0..end];
        if (!captureAccepts(raw, segment)) continue;
        if (matchSegments(segs, index + 1, remaining[end..], wanted)) |later| {
            if (std.mem.eql(u8, capture.string, wanted)) return raw;
            return later;
        }
    }
    return null;
}

fn captureAccepts(raw: []const u8, segment: std.json.ObjectMap) bool {
    if (raw.len == 0) return false;
    const type_value = segment.get("t") orelse return false;
    if (type_value != .string) return false;
    const kind = type_value.string;
    if (std.mem.eql(u8, kind, "str")) return true;
    if (std.mem.eql(u8, kind, "bool"))
        return std.mem.eql(u8, raw, "true") or std.mem.eql(u8, raw, "false");
    if (std.mem.eql(u8, kind, "integer"))
        return isCanonicalInteger(raw) and isFiniteFloat(raw);
    if (std.mem.eql(u8, kind, "number"))
        return isCanonicalNumber(raw) and isFiniteFloat(raw);
    if (std.mem.eql(u8, kind, "enum")) {
        const values = segment.get("vals") orelse return false;
        if (values != .array) return false;
        for (values.array.items) |candidate| {
            if (candidate == .string and std.mem.eql(u8, raw, candidate.string)) return true;
        }
    }
    return false;
}

fn isCanonicalInteger(raw: []const u8) bool {
    const negative = raw[0] == '-';
    const digits = if (negative) raw[1..] else raw;
    return isCanonicalDigits(digits) and !(negative and std.mem.eql(u8, digits, "0"));
}

fn isCanonicalNumber(raw: []const u8) bool {
    const dot = std.mem.indexOfScalar(u8, raw, '.');
    const integer = if (dot) |position| raw[0..position] else raw;
    const fraction = if (dot) |position| raw[position + 1 ..] else "";
    if (dot != null and !isDigits(fraction)) return false;
    const negative = integer.len > 0 and integer[0] == '-';
    const digits = if (negative) integer[1..] else integer;
    return isCanonicalDigits(digits) and
        !(negative and std.mem.eql(u8, digits, "0") and fraction.len == 0);
}

fn isCanonicalDigits(raw: []const u8) bool {
    if (std.mem.eql(u8, raw, "0")) return true;
    return raw.len > 0 and raw[0] != '0' and isDigits(raw);
}

fn isDigits(raw: []const u8) bool {
    if (raw.len == 0) return false;
    for (raw) |character| if (character < '0' or character > '9') return false;
    return true;
}

fn isFiniteFloat(raw: []const u8) bool {
    const number = std.fmt.parseFloat(f64, raw) catch return false;
    return std.math.isFinite(number);
}

pub fn strExtract(
    allocator: std.mem.Allocator,
    subject: []const u8,
    spec_json: []const u8,
) ![]const u8 {
    return extractCapture(allocator, subject, spec_json) catch "";
}

pub fn strExtractNum(
    allocator: std.mem.Allocator,
    subject: []const u8,
    spec_json: []const u8,
) !f64 {
    const captured = extractCapture(allocator, subject, spec_json) catch "";
    if (captured.len == 0) return 0;
    return std.fmt.parseFloat(f64, captured) catch 0;
}

// ── Unicode case ────────────────────────────────────────────────────────────

const Scalar = struct { value: u21, bytes: []const u8 };
const Case = enum { lower, upper };

fn changeCase(allocator: std.mem.Allocator, input: []const u8, mode: Case) ![]u8 {
    if (!std.unicode.utf8ValidateSlice(input)) return error.InvalidUtf8;
    var scalars = std.ArrayList(Scalar).empty;
    defer scalars.deinit(allocator);
    var offset: usize = 0;
    while (offset < input.len) {
        const length = std.unicode.utf8ByteSequenceLength(input[offset]) catch return error.InvalidUtf8;
        try scalars.append(allocator, .{
            .value = std.unicode.utf8Decode(input[offset..][0..length]) catch return error.InvalidUtf8,
            .bytes = input[offset..][0..length],
        });
        offset += length;
    }
    var output = std.ArrayList(u8).empty;
    errdefer output.deinit(allocator);
    for (scalars.items, 0..) |scalar, index| {
        if (mode == .lower and scalar.value == 0x03A3 and isFinalSigma(scalars.items, index)) {
            try output.appendSlice(allocator, "\xCF\x82");
            continue;
        }
        const mappings = if (mode == .lower) &unicode_case.lower else &unicode_case.upper;
        if (findMapping(mappings, scalar.value)) |replacement|
            try output.appendSlice(allocator, replacement)
        else
            try output.appendSlice(allocator, scalar.bytes);
    }
    return output.toOwnedSlice(allocator);
}

fn findMapping(mappings: []const unicode_case.Mapping, scalar: u21) ?[]const u8 {
    var low: usize = 0;
    var high = mappings.len;
    while (low < high) {
        const middle = low + (high - low) / 2;
        if (mappings[middle].source < scalar) low = middle + 1 else high = middle;
    }
    return if (low < mappings.len and mappings[low].source == scalar) mappings[low].replacement else null;
}

fn inRanges(ranges: []const unicode_case.Range, scalar: u21) bool {
    var low: usize = 0;
    var high = ranges.len;
    while (low < high) {
        const middle = low + (high - low) / 2;
        if (ranges[middle].last < scalar) low = middle + 1 else high = middle;
    }
    return low < ranges.len and ranges[low].first <= scalar;
}

fn isFinalSigma(scalars: []const Scalar, index: usize) bool {
    var before = index;
    var has_cased_before = false;
    while (before > 0) {
        before -= 1;
        const scalar = scalars[before].value;
        if (inRanges(&unicode_case.case_ignorable, scalar)) continue;
        has_cased_before = inRanges(&unicode_case.cased, scalar);
        break;
    }
    if (!has_cased_before) return false;
    var after = index + 1;
    while (after < scalars.len) : (after += 1) {
        const scalar = scalars[after].value;
        if (inRanges(&unicode_case.case_ignorable, scalar)) continue;
        return !inRanges(&unicode_case.cased, scalar);
    }
    return true;
}

fn isEcmaWhitespace(scalar: u21) bool {
    return switch (scalar) {
        0x0009...0x000D, 0x0020, 0x00A0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF => true,
        else => false,
    };
}
