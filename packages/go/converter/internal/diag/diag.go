package diag

import "fmt"

// Severity classifies a diagnostic.
type Severity int

const (
	SeverityError Severity = iota
	SeverityWarning
)

// Diagnostic carries a single convert-time or parse-time message.
type Diagnostic struct {
	Severity Severity
	Code     string
	Stage    string // overview_parse | overview_compile | overview_enforce (empty for others)
	Message  string
	File     string
	Line     int
	Col      int
}

// Format returns the human-readable string for stderr output.
// Format: <file>:<line>:<col>: error [<code>](<stage>): <message>
func (d Diagnostic) Format() string {
	code := d.Code
	if d.Stage != "" {
		code = fmt.Sprintf("%s/%s", d.Code, d.Stage)
	}
	if d.File == "" {
		return fmt.Sprintf("error [%s]: %s", code, d.Message)
	}
	return fmt.Sprintf("%s:%d:%d: error [%s]: %s", d.File, d.Line, d.Col, code, d.Message)
}

// Diagnostics is a slice of Diagnostic values.
type Diagnostics []Diagnostic

// HasErrors reports whether any diagnostic has SeverityError.
func (ds Diagnostics) HasErrors() bool {
	for _, d := range ds {
		if d.Severity == SeverityError {
			return true
		}
	}
	return false
}

// Errorf creates a new error Diagnostic with no position.
func Errorf(code, format string, args ...any) Diagnostic {
	return Diagnostic{
		Severity: SeverityError,
		Code:     code,
		Message:  fmt.Sprintf(format, args...),
	}
}

// ErrorAt creates a new error Diagnostic with file/line/col.
func ErrorAt(file string, line, col int, code, format string, args ...any) Diagnostic {
	return Diagnostic{
		Severity: SeverityError,
		Code:     code,
		Message:  fmt.Sprintf(format, args...),
		File:     file,
		Line:     line,
		Col:      col,
	}
}

// Generic converter error codes.
const (
	CodeTooManyDiagnostics = "TooManyDiagnostics"
)

// Error codes from hcl-context-spec.md
const (
	CodeTypeMismatch          = "TypeMismatch"
	CodeNonIntegerValue       = "NonIntegerValue"
	CodeHeterogeneousArray    = "HeterogeneousArray"
	CodeNestedArrayNotAllowed = "NestedArrayNotAllowed"
	CodeDuplicateProg         = "DuplicateProg"
	CodeDuplicateBinding      = "DuplicateBinding"
	CodeReservedName          = "ReservedName"
	CodeUnknownFnAlias        = "UnknownFnAlias"
	CodeOperatorOnlyFn        = "OperatorOnlyFn"
	CodeUndefinedRef          = "UndefinedRef"
	CodeUndefinedFuncRef      = "UndefinedFuncRef"
	CodeInvalidBinaryArgShape = "InvalidBinaryArgShape"
	CodeInvalidInfixExpr      = "InvalidInfixExpr"
	CodeArgTypeMismatch       = "ArgTypeMismatch"
	CodeReturnTypeMismatch    = "ReturnTypeMismatch"
	CodeCondNotBool           = "CondNotBool"
	CodeBranchTypeMismatch    = "BranchTypeMismatch"
	CodeStepRefOutOfBounds    = "StepRefOutOfBounds"
	CodeCrossPipeStepRef      = "CrossPipeStepRef"
	CodePipeArgNotValue       = "PipeArgNotValue"
	CodeSingleRefTypeMismatch = "SingleRefTypeMismatch"
)

// Error codes from state-shape-spec.md
const (
	CodeMissingStateSource            = "MissingStateSource"
	CodeConflictingStateSource        = "ConflictingStateSource"
	CodeStateFileMissing              = "StateFileMissing"
	CodeStateFileParseError           = "StateFileParseError"
	CodeMissingStateBlock             = "MissingStateBlock"
	CodeDuplicateStateBlock           = "DuplicateStateBlock"
	CodeDuplicateStateNamespace       = "DuplicateStateNamespace"
	CodeDuplicateStateField           = "DuplicateStateField"
	CodeMissingStateFieldAttr         = "MissingStateFieldAttr"
	CodeInvalidStateFieldType         = "InvalidStateFieldType"
	CodeStateFieldDefaultTypeMismatch = "StateFieldDefaultTypeMismatch"
	CodeUnresolvedStatePath           = "UnresolvedStatePath"
	CodeStateTypeMismatch             = "StateTypeMismatch"
	CodeInvalidStatePath              = "InvalidStatePath"
	CodeMissingStatePath              = "MissingStatePath"
)

// Error codes from effect-dsl-spec.md + convert-runtime-spec.md
const (
	CodeMissingPrepareEntry      = "MissingPrepareEntry"
	CodeMissingMergeEntry        = "MissingMergeEntry"
	CodeSpuriousPrepareEntry     = "SpuriousPrepareEntry"
	CodeSpuriousMergeEntry       = "SpuriousMergeEntry"
	CodeDuplicatePrepareEntry    = "DuplicatePrepareEntry"
	CodeDuplicateMergeEntry      = "DuplicateMergeEntry"
	CodeBidirMissingPrepareEntry = "BidirMissingPrepareEntry"
	CodeBidirMissingMergeEntry   = "BidirMissingMergeEntry"
	CodeTransitionMerge          = "TransitionMerge"
	CodeTransitionHook           = "TransitionHook"
	CodeTransitionOutputSigil    = "TransitionOutputSigil"
	CodeInvalidTransitionIngress = "InvalidTransitionIngress"
	CodeInvalidPrepareSource     = "InvalidPrepareSource"
	CodeUnresolvedPrepareBinding = "UnresolvedPrepareBinding"
	CodeUnresolvedMergeBinding   = "UnresolvedMergeBinding"
	CodeDuplicateActionLabel     = "DuplicateActionLabel"
	CodeUnsupportedConstruct     = "UnsupportedConstruct"
)

// Error codes from scene-graph.md
const (
	CodeSCNInvalidActionGraph       = "SCN_INVALID_ACTION_GRAPH"
	CodeSCNActionRootNotFound       = "SCN_ACTION_ROOT_NOT_FOUND"
	CodeSCNIngressTargetNotValue    = "SCN_INGRESS_TARGET_NOT_VALUE"
	CodeSCNIngressSourceMissing     = "SCN_INGRESS_SOURCE_MISSING"
	CodeSCNEgressSourceInvalid      = "SCN_EGRESS_SOURCE_INVALID"
	CodeSCNEgressSourceUnavailable  = "SCN_EGRESS_SOURCE_UNAVAILABLE"
	CodeSCNNextComputeInvalid       = "SCN_NEXT_COMPUTE_INVALID"
	CodeSCNNextComputeNotBool       = "SCN_NEXT_COMPUTE_NOT_BOOL"
	CodeSCNNextIngressSourceInvalid = "SCN_NEXT_INGRESS_SOURCE_INVALID"
	CodeSCNActionTextDuplicate      = "SCN_ACTION_TEXT_DUPLICATE"
)

// Error codes from scene-to-scene.md
const (
	CodeDuplicateFallback = "DuplicateFallback"
	CodeBareWildcardPath  = "BareWildcardPath"
	CodeMultipleWildcards = "MultipleWildcards"
	CodeInvalidPathItem   = "InvalidPathItem"
	CodeUnresolvedScene   = "UnresolvedScene"
)

// Error codes from overview-dsl-spec.md §9 (Overview DSL)
const (
	// parse stage (§9.1)
	CodeOverviewFlowEmpty          = "SCN_OVERVIEW_FLOW_EMPTY"
	CodeOverviewEdgeWithoutSource  = "SCN_OVERVIEW_EDGE_WITHOUT_SOURCE"
	CodeOverviewEdgeNoTarget       = "SCN_OVERVIEW_EDGE_NO_TARGET"
	CodeOverviewChainNoTarget      = "SCN_OVERVIEW_CHAIN_NO_TARGET"
	CodeOverviewInvalidIdent       = "SCN_OVERVIEW_INVALID_IDENT"
	// compile stage (§9.2)
	CodeOverviewInvalidMode = "SCN_OVERVIEW_INVALID_MODE"
	CodeOverviewDuplicate   = "SCN_OVERVIEW_DUPLICATE"
	CodeOverviewUnknownView = "SCN_OVERVIEW_UNKNOWN_VIEW"
	// enforce stage (§9.3)
	CodeOverviewUnknownNode = "SCN_OVERVIEW_UNKNOWN_NODE"
	CodeOverviewMissingEdge = "SCN_OVERVIEW_MISSING_EDGE"
	CodeOverviewExtraNode   = "SCN_OVERVIEW_EXTRA_NODE"
	CodeOverviewExtraEdge   = "SCN_OVERVIEW_EXTRA_EDGE"
)
