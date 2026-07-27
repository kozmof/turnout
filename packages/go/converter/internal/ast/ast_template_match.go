package ast

import (
	"strconv"
	"strings"
)

// ────────────────────────────────────────────────────────────
// Template matching and capture decoding (literal-template-types-spec.md §8, §19)
// ────────────────────────────────────────────────────────────
//
// TemplateMatch decodes an input string against a template literal type. It is
// the semantic reference for template membership and capture decoding and MUST
// stay behaviourally identical to the TypeScript runtime matcher (shared
// conformance fixtures, §28.8).
//
// Because template validation rejects adjacent captures and non-terminal `str`
// captures (§7), every capture is either the final segment or is followed by a
// static-text segment. Matching is therefore a deterministic left-to-right scan
// with no regex and no implicit greediness (§7.5): for a bounded capture the
// decoder tries each boundary position and accepts the unique one whose value is
// a valid member of the capture type and whose remainder matches.
//
// Decoded captures use their runtime types (§19.2, §29.6): integer and number
// decode to float64, bool to bool, and str / string literals to string.

// TemplateMatch attempts to decode input against tmpl. On success it returns the
// decoded captures keyed by name and true; on failure it returns nil and false.
func TemplateMatch(tmpl *TemplateType, input string) (map[string]any, bool) {
	caps := make(map[string]any)
	if matchSegments(tmpl.Segments, input, caps) {
		return caps, true
	}
	return nil, false
}

// TemplateContains reports whether input is a member of the template type.
func TemplateContains(tmpl *TemplateType, input string) bool {
	_, ok := TemplateMatch(tmpl, input)
	return ok
}

func matchSegments(segs []TemplateSegment, s string, caps map[string]any) bool {
	if len(segs) == 0 {
		return s == ""
	}
	switch seg := segs[0].(type) {
	case *TextSegment:
		if !strings.HasPrefix(s, seg.Value) {
			return false
		}
		return matchSegments(segs[1:], s[len(seg.Value):], caps)
	case *CaptureSegment:
		rest := segs[1:]
		// Terminal capture: it must consume the entire remaining string.
		if len(rest) == 0 {
			v, ok := decodeCapture(s, seg.CaptureType)
			if !ok {
				return false
			}
			caps[seg.Name] = v
			return true
		}
		// Bounded capture: the next segment is static text (adjacency is rejected
		// at validation time). Try each non-empty prefix as the capture value.
		for end := 1; end <= len(s); end++ {
			v, ok := decodeCapture(s[:end], seg.CaptureType)
			if !ok {
				continue
			}
			trial := make(map[string]any, len(caps)+1)
			for k, val := range caps {
				trial[k] = val
			}
			trial[seg.Name] = v
			if matchSegments(rest, s[end:], trial) {
				for k, val := range trial {
					caps[k] = val
				}
				return true
			}
		}
		return false
	}
	return false
}

// decodeCapture decodes value against the (resolved) capture type, returning the
// typed runtime value and whether value is a member of the type.
func decodeCapture(value string, t Type) (any, bool) {
	if value == "" {
		return nil, false // captures never match the empty string
	}
	switch v := Resolve(t).(type) {
	case *PrimitiveType:
		switch v.Kind {
		case PrimStr:
			return value, true
		case PrimInteger:
			if n, ok := parseCanonicalInteger(value); ok {
				return n, true
			}
		case PrimNumber:
			if n, ok := parseCanonicalNumber(value); ok {
				return n, true
			}
		case PrimBool:
			if value == "true" {
				return true, true
			}
			if value == "false" {
				return false, true
			}
		}
		return nil, false
	case *LiteralType:
		return decodeLiteral(value, v)
	case *UnionType:
		for _, m := range v.Members {
			if decoded, ok := decodeCapture(value, m); ok {
				return decoded, true
			}
		}
		return nil, false
	}
	return nil, false
}

// decodeLiteral matches value against a single scalar literal type.
func decodeLiteral(value string, lit *LiteralType) (any, bool) {
	switch lv := lit.Value.(type) {
	case *StringLiteral:
		if value == lv.Value {
			return value, true
		}
	case *NumberLiteral:
		if lit.BaseKind() == PrimInteger {
			if n, ok := parseCanonicalInteger(value); ok && n == lv.Value {
				return n, true
			}
		} else {
			if n, ok := parseCanonicalNumber(value); ok && n == lv.Value {
				return n, true
			}
		}
	case *BoolLiteral:
		if (value == "true") == lv.Value && (value == "true" || value == "false") {
			return lv.Value, true
		}
	}
	return nil, false
}

// parseCanonicalInteger accepts an optionally-negative decimal integer in
// canonical form: "0", or [1-9][0-9]*, optionally prefixed with '-' (but not
// "-0"). It rejects leading zeros, '+', decimals, and exponents (§7.4, §28.4).
func parseCanonicalInteger(s string) (float64, bool) {
	digits := s
	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		digits = s[1:]
	}
	if !isCanonicalDigits(digits) {
		return 0, false
	}
	if neg && digits == "0" {
		return 0, false // "-0" is not canonical
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// parseCanonicalNumber accepts a canonical decimal: a canonical integer part
// optionally followed by '.' and one or more digits. It rejects a trailing or
// leading '.', '+', leading zeros in the integer part, and exponents.
func parseCanonicalNumber(s string) (float64, bool) {
	intPart := s
	fracPart := ""
	if dot := strings.IndexByte(s, '.'); dot >= 0 {
		intPart = s[:dot]
		fracPart = s[dot+1:]
		if fracPart == "" || !isDigits(fracPart) {
			return 0, false
		}
	}
	digits := intPart
	neg := false
	if strings.HasPrefix(intPart, "-") {
		neg = true
		digits = intPart[1:]
	}
	if !isCanonicalDigits(digits) {
		return 0, false
	}
	if neg && digits == "0" && fracPart == "" {
		return 0, false
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// isCanonicalDigits reports whether s is "0" or a non-empty digit string with no
// leading zero.
func isCanonicalDigits(s string) bool {
	if s == "0" {
		return true
	}
	if s == "" || s[0] == '0' {
		return false
	}
	return isDigits(s)
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}
