package diag

// Generic converter error codes.
const (
	CodeTooManyDiagnostics   ErrorCode = "TooManyDiagnostics"
	CodeNamedArgNotSupported ErrorCode = "NamedArgNotSupported"
	CodeEmitIOError          ErrorCode = "EmitIOError"
	CodeIOError              ErrorCode = "IOError"
	CodeParseSyntaxError     ErrorCode = "ParseSyntaxError"
	CodeLexError             ErrorCode = "LexError"
)

// Error codes from hcl-context-spec.md
const (
	CodeTypeMismatch          ErrorCode = "TypeMismatch"
	CodeNonIntegerValue       ErrorCode = "NonIntegerValue"
	CodeHeterogeneousArray    ErrorCode = "HeterogeneousArray"
	CodeNestedArrayNotAllowed ErrorCode = "NestedArrayNotAllowed"
	CodeDuplicateProg         ErrorCode = "DuplicateProg"
	CodeDuplicateBinding      ErrorCode = "DuplicateBinding"
	CodeReservedName          ErrorCode = "ReservedName"
	CodeUnknownFnAlias        ErrorCode = "UnknownFnAlias"
	CodeOperatorOnlyFn        ErrorCode = "OperatorOnlyFn"
	CodeUndefinedRef          ErrorCode = "UndefinedRef"
	CodeUndefinedFuncRef      ErrorCode = "UndefinedFuncRef"
	CodeInvalidBinaryArgShape ErrorCode = "InvalidBinaryArgShape"
	CodeInvalidInfixExpr      ErrorCode = "InvalidInfixExpr"
	CodeArgTypeMismatch       ErrorCode = "ArgTypeMismatch"
	CodeReturnTypeMismatch    ErrorCode = "ReturnTypeMismatch"
	CodeCondNotBool           ErrorCode = "CondNotBool"
	CodeBranchTypeMismatch    ErrorCode = "BranchTypeMismatch"
	CodeStepRefOutOfBounds    ErrorCode = "StepRefOutOfBounds"
	CodeCrossPipeStepRef      ErrorCode = "CrossPipeStepRef"
	CodePipeArgNotValue       ErrorCode = "PipeArgNotValue"
	CodeSingleRefTypeMismatch ErrorCode = "SingleRefTypeMismatch"
	// CodeUnusedBinding is a warning emitted when a binding in a compute prog is
	// declared but never reachable from the compute root, merge entries, or next
	// rule conditions. Such bindings are dead code and likely indicate a typo or
	// authoring mistake.
	CodeUnusedBinding ErrorCode = "UnusedBinding"
)

// Error codes from state-shape-spec.md
const (
	CodeDeclarationOrderLost          ErrorCode = "DeclarationOrderLost"
	CodeStaleDeclarationOrder         ErrorCode = "StaleDeclarationOrder"
	CodeMissingStateSource            ErrorCode = "MissingStateSource"
	CodeConflictingStateSource        ErrorCode = "ConflictingStateSource"
	CodeStateFileMissing              ErrorCode = "StateFileMissing"
	CodeStateFileParseError           ErrorCode = "StateFileParseError"
	CodeMissingStateBlock             ErrorCode = "MissingStateBlock"
	CodeDuplicateStateBlock           ErrorCode = "DuplicateStateBlock"
	CodeDuplicateStateNamespace       ErrorCode = "DuplicateStateNamespace"
	CodeDuplicateStateField           ErrorCode = "DuplicateStateField"
	CodeMissingStateFieldAttr         ErrorCode = "MissingStateFieldAttr"
	CodeInvalidStateFieldType         ErrorCode = "InvalidStateFieldType"
	CodeStateFieldDefaultTypeMismatch ErrorCode = "StateFieldDefaultTypeMismatch"
	CodeUnresolvedStatePath           ErrorCode = "UnresolvedStatePath"
	CodeStateTypeMismatch             ErrorCode = "StateTypeMismatch"
	CodeInvalidStatePath              ErrorCode = "InvalidStatePath"
	CodeMissingStatePath              ErrorCode = "MissingStatePath"
)

// Error codes from effect-dsl-spec.md + convert-runtime-spec.md
const (
	CodeUnknownMethod            ErrorCode = "UnknownMethod"
	CodeMissingPrepareEntry      ErrorCode = "MissingPrepareEntry"
	CodeMissingMergeEntry        ErrorCode = "MissingMergeEntry"
	CodeSpuriousPrepareEntry     ErrorCode = "SpuriousPrepareEntry"
	CodeSpuriousMergeEntry       ErrorCode = "SpuriousMergeEntry"
	CodeDuplicatePrepareEntry    ErrorCode = "DuplicatePrepareEntry"
	CodeDuplicateMergeEntry      ErrorCode = "DuplicateMergeEntry"
	CodeBidirMissingPrepareEntry ErrorCode = "BidirMissingPrepareEntry"
	CodeBidirMissingMergeEntry   ErrorCode = "BidirMissingMergeEntry"
	CodeTransitionMerge          ErrorCode = "TransitionMerge"
	CodeTransitionHook           ErrorCode = "TransitionHook"
	CodeTransitionOutputSigil    ErrorCode = "TransitionOutputSigil"
	// CodeSigilPositionLoss is a warning emitted when Validate is called with a nil
	// sidecar but the model contains sigil bindings. Sigil-related diagnostics will
	// be emitted without source-file positions in this case.
	CodeSigilPositionLoss        ErrorCode = "SigilPositionLoss"
	CodeInvalidTransitionIngress ErrorCode = "InvalidTransitionIngress"
	CodeInvalidPrepareSource     ErrorCode = "InvalidPrepareSource"
	CodeUnresolvedPrepareBinding ErrorCode = "UnresolvedPrepareBinding"
	CodeUnresolvedMergeBinding   ErrorCode = "UnresolvedMergeBinding"
	CodeDuplicateActionLabel     ErrorCode = "DuplicateActionLabel"
	// CodeUnsupportedConstruct is emitted when a user-authored construct exists
	// in the DSL but is not yet supported or is invalid in the current context
	// (e.g. #it outside a #pipe step, state_file schema not pre-loaded).
	CodeUnsupportedConstruct ErrorCode = "UnsupportedConstruct"
	// CodeInternalError is emitted when the compiler detects an internal
	// invariant violation that indicates a compiler bug rather than a user
	// error. These diagnostics should be reported as bugs; they should never
	// appear for valid input processed by a correct compiler.
	CodeInternalError ErrorCode = "InternalError"
	CodeCyclicBinding ErrorCode = "CyclicBinding"
	CodeEmptyArrayLitArg ErrorCode = "EmptyArrayLitArg"
	// CodeDuplicateCasePattern is emitted when two arms of a #case expression
	// match the same literal value. The second arm is unreachable dead code.
	CodeDuplicateCasePattern ErrorCode = "DuplicateCasePattern"
)

// Error codes from scene-graph.md
const (
	CodeMissingScene                ErrorCode = "MissingScene"
	CodeDuplicateSceneID            ErrorCode = "DuplicateSceneID"
	CodeSCNInvalidActionGraph       ErrorCode = "SCN_INVALID_ACTION_GRAPH"
	CodeSCNActionRootNotFound       ErrorCode = "SCN_ACTION_ROOT_NOT_FOUND"
	CodeSCNIngressTargetNotValue    ErrorCode = "SCN_INGRESS_TARGET_NOT_VALUE"
	CodeSCNIngressSourceMissing     ErrorCode = "SCN_INGRESS_SOURCE_MISSING"
	CodeSCNEgressSourceInvalid      ErrorCode = "SCN_EGRESS_SOURCE_INVALID"
	CodeSCNEgressSourceUnavailable  ErrorCode = "SCN_EGRESS_SOURCE_UNAVAILABLE"
	CodeSCNNextComputeInvalid       ErrorCode = "SCN_NEXT_COMPUTE_INVALID"
	CodeSCNNextComputeNotBool       ErrorCode = "SCN_NEXT_COMPUTE_NOT_BOOL"
	CodeSCNNextIngressSourceInvalid ErrorCode = "SCN_NEXT_INGRESS_SOURCE_INVALID"
	CodeSCNActionTextDuplicate      ErrorCode = "SCN_ACTION_TEXT_DUPLICATE"
)

// Error codes from scene-to-scene.md
const (
	CodeDuplicateFallback    ErrorCode = "DuplicateFallback"
	CodeBareWildcardPath     ErrorCode = "BareWildcardPath"
	CodeMultipleWildcards    ErrorCode = "MultipleWildcards"
	CodeInvalidPathItem      ErrorCode = "InvalidPathItem"
	CodeUnresolvedScene      ErrorCode = "UnresolvedScene"
	CodeUnresolvedAction     ErrorCode = "UnresolvedAction"
	CodeMissingEntryScene    ErrorCode = "MissingEntryScene"
	CodeUnresolvedEntryScene ErrorCode = "UnresolvedEntryScene"
	// CodeWildcardTerminalUnresolvable is a warning emitted when a wildcard
	// route pattern's terminal action name does not match any known action ID
	// across all scenes, suggesting a likely typo.
	CodeWildcardTerminalUnresolvable ErrorCode = "WildcardTerminalUnresolvable"
)

// Error codes for cross-action validation.
const (
	// CodeNextPrepareFromActionUnknown is emitted when a from_action source
	// references a binding name that does not exist in the source action's
	// compute prog output.
	CodeNextPrepareFromActionUnknown ErrorCode = "NextPrepareFromActionUnknown"
	// CodeNextPrepareFromActionTypeMismatch is emitted when the type of the
	// from_action source binding does not match the target binding's declared type.
	CodeNextPrepareFromActionTypeMismatch ErrorCode = "NextPrepareFromActionTypeMismatch"
)

// Error codes from overview-dsl-spec.md §9 (Overview DSL)
const (
	// parse stage (§9.1)
	CodeOverviewFlowEmpty         ErrorCode = "SCN_OVERVIEW_FLOW_EMPTY"
	CodeOverviewEdgeWithoutSource ErrorCode = "SCN_OVERVIEW_EDGE_WITHOUT_SOURCE"
	CodeOverviewEdgeNoTarget      ErrorCode = "SCN_OVERVIEW_EDGE_NO_TARGET"
	CodeOverviewChainNoTarget     ErrorCode = "SCN_OVERVIEW_CHAIN_NO_TARGET"
	CodeOverviewInvalidIdent      ErrorCode = "SCN_OVERVIEW_INVALID_IDENT"
	// compile stage (§9.2)
	CodeOverviewInvalidMode ErrorCode = "SCN_OVERVIEW_INVALID_MODE"
	CodeOverviewDuplicate   ErrorCode = "SCN_OVERVIEW_DUPLICATE"
	CodeOverviewUnknownView ErrorCode = "SCN_OVERVIEW_UNKNOWN_VIEW"
	// enforce stage (§9.3)
	CodeOverviewUnknownNode ErrorCode = "SCN_OVERVIEW_UNKNOWN_NODE"
	CodeOverviewMissingEdge ErrorCode = "SCN_OVERVIEW_MISSING_EDGE"
	CodeOverviewExtraNode   ErrorCode = "SCN_OVERVIEW_EXTRA_NODE"
	CodeOverviewExtraEdge   ErrorCode = "SCN_OVERVIEW_EXTRA_EDGE"
)
