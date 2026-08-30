const std = @import("std");

pub const PresetError = error{ DivisionByZero, ModuloByZero, InvalidUtf8 };

pub fn divide(a: f64, b: f64) PresetError!f64 {
    if (b == 0) return error.DivisionByZero;
    return a / b;
}

pub fn modulo(a: f64, b: f64) PresetError!f64 {
    if (b == 0) return error.ModuloByZero;
    return @mod(a, b);
}

/// Match Math.round, including ties toward positive infinity and negative zero.
pub fn jsRound(value: f64) f64 {
    if (std.math.isNan(value) or std.math.isInf(value)) return value;
    if (value < 0 and value >= -0.5) return -0.0;
    return @floor(value + 0.5);
}

/// Return JavaScript String.length for a valid UTF-8 transport string.
/// JavaScript counts UTF-16 code units rather than Unicode scalar values.
pub fn jsStringLength(bytes: []const u8) PresetError!usize {
    if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidUtf8;
    var length: usize = 0;
    var index: usize = 0;
    while (index < bytes.len) {
        const sequence_len = std.unicode.utf8ByteSequenceLength(bytes[index]) catch
            return error.InvalidUtf8;
        const scalar = std.unicode.utf8Decode(bytes[index..][0..sequence_len]) catch
            return error.InvalidUtf8;
        length += if (scalar > 0xFFFF) 2 else 1;
        index += sequence_len;
    }
    return length;
}

test "division and modulo reject positive and negative zero" {
    try std.testing.expectError(error.DivisionByZero, divide(1, 0.0));
    try std.testing.expectError(error.DivisionByZero, divide(1, -0.0));
    try std.testing.expectError(error.ModuloByZero, modulo(1, 0.0));
}

test "JavaScript rounding uses ties toward positive infinity" {
    try std.testing.expectEqual(@as(f64, -2), jsRound(-2.5));
    try std.testing.expectEqual(@as(f64, 3), jsRound(2.5));
    try std.testing.expect(std.math.signbit(jsRound(-0.1)));
    try std.testing.expect(jsRound(-0.1) == 0);
}

test "JavaScript string length counts UTF-16 code units" {
    try std.testing.expectEqual(@as(usize, 2), try jsStringLength("😀"));
    try std.testing.expectEqual(@as(usize, 2), try jsStringLength("e\u{301}"));
    try std.testing.expectEqual(@as(usize, 3), try jsStringLength("a😀"));
}
