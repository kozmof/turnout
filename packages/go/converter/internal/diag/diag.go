package diag

import "fmt"

// ErrorCode is a typed string for diagnostic error codes so that mis-spellings
// at call sites are caught at compile time rather than at runtime.
type ErrorCode string

// Severity classifies a diagnostic.
type Severity int

const (
	SeverityError Severity = iota
	SeverityWarning
)

// Diagnostic carries a single convert-time or parse-time message.
type Diagnostic struct {
	Severity Severity
	Code     ErrorCode
	Stage    string // overview_parse | overview_compile | overview_enforce (empty for others)
	Message  string
	File     string
	Line     int
	Col      int
	// DebugStack is populated for recovered InternalError panics and omitted by Format.
	DebugStack []byte
}

// Format returns the human-readable string for stderr output.
// Format: <file>:<line>:<col>: error|warning [<code>](<stage>): <message>
func (d Diagnostic) Format() string {
	codeStr := string(d.Code)
	if d.Stage != "" {
		codeStr = fmt.Sprintf("%s/%s", d.Code, d.Stage)
	}
	level := "error"
	if d.Severity == SeverityWarning {
		level = "warning"
	}
	if d.File == "" {
		return fmt.Sprintf("%s [%s]: %s", level, codeStr, d.Message)
	}
	return fmt.Sprintf("%s:%d:%d: %s [%s]: %s", d.File, d.Line, d.Col, level, codeStr, d.Message)
}

// Diagnostics is a slice of Diagnostic values.
type Diagnostics []Diagnostic

// DiagSink manages a diagnostic slice with a hard error cap.
// Use Append/AppendAll to add diagnostics; read via Peek/Len/HasErrors.
// Direct mutation of the internal slice is intentionally prevented so the cap
// and halt invariants cannot be bypassed.
type DiagSink struct {
	diags   Diagnostics
	halted  bool
	flushed bool
}

func (s *DiagSink) IsHalted() bool { return s.halted }
func (s *DiagSink) AtCap() bool    { return len(s.diags) >= MaxDiagnostics }

// Peek returns a read-only view of the collected diagnostics.
// The slice must not be mutated by the caller; use Append/AppendAll instead.
func (s *DiagSink) Peek() Diagnostics { return s.diags }

// Len returns the number of collected diagnostics.
func (s *DiagSink) Len() int { return len(s.diags) }

// HasErrors reports whether any collected diagnostic has SeverityError.
func (s *DiagSink) HasErrors() bool { return s.diags.HasErrors() }

// Flush returns the collected diagnostics and clears the sink's slice,
// preventing double-use of the same sink across pipeline stages.
// After Flush is called, any subsequent Append panics.
func (s *DiagSink) Flush() Diagnostics {
	diags := s.diags
	s.diags = nil
	s.flushed = true
	return diags
}

// Halt marks the sink as halted. If the last entry is not already a
// TooManyDiagnostics sentinel, one is appended so callers always know that
// truncation occurred when the sink is halted.
func (s *DiagSink) Halt() {
	if !s.halted {
		if len(s.diags) == 0 || s.diags[len(s.diags)-1].Code != CodeTooManyDiagnostics {
			s.diags = append(s.diags, Errorf(CodeTooManyDiagnostics,
				"too many diagnostics — further errors suppressed"))
		}
		s.halted = true
	}
}

// AppendAll adds each diagnostic in ds to the sink in order, respecting the
// halt/cap logic of Append. Equivalent to calling Append for each element.
func (s *DiagSink) AppendAll(ds Diagnostics) {
	for _, d := range ds {
		s.Append(d)
	}
}

// Append adds d to the sink. If the sink is already halted, the diagnostic is
// silently dropped. If this append would exceed MaxDiagnostics, the sink is
// halted (appending a TooManyDiagnostics sentinel) and d is discarded.
// Panics if called after Flush — each pipeline stage must use its own DiagSink.
func (s *DiagSink) Append(d Diagnostic) {
	if s.flushed {
		panic("DiagSink: Append called after Flush — this is a compiler bug; create a new DiagSink for each pipeline stage")
	}
	if s.halted {
		return
	}
	if s.AtCap() {
		s.Halt()
		return
	}
	s.diags = append(s.diags, d)
}

// IsEmpty reports whether ds contains no diagnostics (nil or empty slice).
func (ds Diagnostics) IsEmpty() bool { return len(ds) == 0 }

// HasErrors reports whether any diagnostic has SeverityError.
func (ds Diagnostics) HasErrors() bool {
	for _, d := range ds {
		if d.Severity == SeverityError {
			return true
		}
	}
	return false
}

// Errors returns a new slice containing only the error-severity diagnostics.
func (ds Diagnostics) Errors() Diagnostics {
	var out Diagnostics
	for _, d := range ds {
		if d.Severity == SeverityError {
			out = append(out, d)
		}
	}
	return out
}

// Warnings returns a new slice containing only the warning-severity diagnostics.
func (ds Diagnostics) Warnings() Diagnostics {
	var out Diagnostics
	for _, d := range ds {
		if d.Severity == SeverityWarning {
			out = append(out, d)
		}
	}
	return out
}

// Capped returns ds unchanged when len(ds) <= MaxDiagnostics. When the slice
// exceeds the cap it returns the first MaxDiagnostics entries followed by a
// single TooManyDiagnostics sentinel, so callers always receive a bounded slice.
func (ds Diagnostics) Capped() Diagnostics {
	if len(ds) <= MaxDiagnostics {
		return ds
	}
	capped := make(Diagnostics, MaxDiagnostics+1)
	copy(capped, ds[:MaxDiagnostics])
	capped[MaxDiagnostics] = Errorf(CodeTooManyDiagnostics, "too many diagnostics — further errors suppressed")
	return capped
}

// Errorf creates a new error Diagnostic with no position.
func Errorf(code ErrorCode, format string, args ...any) Diagnostic {
	return Diagnostic{
		Severity: SeverityError,
		Code:     code,
		Message:  fmt.Sprintf(format, args...),
	}
}

// ErrorAt creates a new error Diagnostic with file/line/col.
func ErrorAt(file string, line, col int, code ErrorCode, format string, args ...any) Diagnostic {
	return Diagnostic{
		Severity: SeverityError,
		Code:     code,
		Message:  fmt.Sprintf(format, args...),
		File:     file,
		Line:     line,
		Col:      col,
	}
}

// WarnAt creates a new warning Diagnostic with file/line/col.
func WarnAt(file string, line, col int, code ErrorCode, format string, args ...any) Diagnostic {
	return Diagnostic{
		Severity: SeverityWarning,
		Code:     code,
		Message:  fmt.Sprintf(format, args...),
		File:     file,
		Line:     line,
		Col:      col,
	}
}

// Warnf creates a new warning Diagnostic with no position.
func Warnf(code ErrorCode, format string, args ...any) Diagnostic {
	return Diagnostic{
		Severity: SeverityWarning,
		Code:     code,
		Message:  fmt.Sprintf(format, args...),
	}
}

// MaxDiagnostics is the hard cap on diagnostic count before halting.
const MaxDiagnostics = 100
