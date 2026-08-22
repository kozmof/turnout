package diag

// Generic converter error codes.
const (
	CodeTooManyDiagnostics   ErrorCode = "TooManyDiagnostics"
	CodeNamedArgNotSupported ErrorCode = "NamedArgNotSupported"
	CodeEmitIOError          ErrorCode = "EmitIOError"
	CodeIOError              ErrorCode = "IOError"
	CodeInvalidOption        ErrorCode = "InvalidOption"
	CodeInputTooLarge        ErrorCode = "InputTooLarge"
	CodeParseSyntaxError     ErrorCode = "ParseSyntaxError"
	CodeLexError             ErrorCode = "LexError"
)

// Contextual compute-result error codes. Names are retained for API compatibility.
const (
	CodeMissingRootMarker      ErrorCode = "MissingRootMarker"
	CodeMissingConditionMarker ErrorCode = "MissingConditionMarker"
	CodeDuplicateMarker        ErrorCode = "DuplicateMarker"
	CodeMarkerNotLast          ErrorCode = "MarkerNotLast"
	CodeMarkerContext          ErrorCode = "MarkerContext"
)

// Error codes from hcl-context-spec.md
const (
	CodeTypeMismatch       ErrorCode = "TypeMismatch"
	CodeNonIntegerValue    ErrorCode = "NonIntegerValue"
	CodeHeterogeneousArray ErrorCode = "HeterogeneousArray"
	// CodeDuplicateProg applies to the canonical ContextSpec layer, where a
	// file may hold at most one prog block. The Turn DSL surface cannot express
	// it: prog is not a surface block, it is the compute label.
	CodeDuplicateProg          ErrorCode = "DuplicateProg"
	CodeDuplicateBinding       ErrorCode = "DuplicateBinding"
	CodeReservedName           ErrorCode = "ReservedName"
	CodeUnknownFnAlias         ErrorCode = "UnknownFnAlias"
	CodeOperatorOnlyFn         ErrorCode = "OperatorOnlyFn"
	CodeUndefinedRef           ErrorCode = "UndefinedRef"
	CodeUndefinedFuncRef       ErrorCode = "UndefinedFuncRef"
	CodeInvalidCombineArgShape ErrorCode = "InvalidCombineArgShape"
	CodeInvalidInfixExpr       ErrorCode = "InvalidInfixExpr"
	CodeArgTypeMismatch        ErrorCode = "ArgTypeMismatch"
	CodeReturnTypeMismatch     ErrorCode = "ReturnTypeMismatch"
	CodeCondNotBool            ErrorCode = "CondNotBool"
	CodeBranchTypeMismatch     ErrorCode = "BranchTypeMismatch"
	CodeStepRefOutOfBounds     ErrorCode = "StepRefOutOfBounds"
	CodeCrossPipeStepRef       ErrorCode = "CrossPipeStepRef"
	CodePipeArgNotValue        ErrorCode = "PipeArgNotValue"
	CodeSingleRefTypeMismatch  ErrorCode = "SingleRefTypeMismatch"
	// CodeUnusedBinding is a warning emitted when a binding in a compute block is
	// declared but never reachable from the compute root, its merge entries, or
	// the `from_action` sources of its next rules. Such bindings are dead code
	// and likely indicate a typo or authoring mistake.
	//
	// The transition sources are what make a `next <flag> -> <action>` guard, or
	// a `next on (...) to { }` subject, count as used: nothing inside the prog
	// references them, and they leave it through a transition prepare entry.
	CodeUnusedBinding ErrorCode = "UnusedBinding"
)

// Error codes from state-shape-spec.md
const (
	CodeDeclarationOrderLost          ErrorCode = "DeclarationOrderLost"
	CodeStaleDeclarationOrder         ErrorCode = "StaleDeclarationOrder"
	CodeStaleSchema                   ErrorCode = "StaleSchema"
	CodeMissingStateSource            ErrorCode = "MissingStateSource"
	CodeConflictingStateSource        ErrorCode = "ConflictingStateSource"
	CodeStateFileMissing              ErrorCode = "StateFileMissing"
	CodeStateFileTooLarge             ErrorCode = "StateFileTooLarge"
	CodeStateFileOutsideBase          ErrorCode = "StateFileOutsideBase"
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
	CodeUnknownMethod ErrorCode = "UnknownMethod"
	// CodeMissingBindingSource is emitted for a bare `name:type` binding. Inline
	// IO is the only spelling for ingress, so a binding with neither a `<~`
	// source nor a computed RHS has no value; lowering would hand it the type's
	// zero value instead of failing.
	CodeMissingBindingSource  ErrorCode = "MissingBindingSource"
	CodeTransitionPublish     ErrorCode = "TransitionPublish"
	CodeTransitionHook        ErrorCode = "TransitionHook"
	CodeTransitionOutputSigil ErrorCode = "TransitionOutputSigil"
	// CodeSigilPositionLoss is a warning emitted when Validate is called with a nil
	// sidecar but the model contains sigil bindings. Sigil-related diagnostics will
	// be emitted without source-file positions in this case.
	CodeSigilPositionLoss ErrorCode = "SigilPositionLoss"
	// CodeInvalidTransitionIngress guards the wire shape of a transition ingress
	// entry: exactly one source. Hoisting always produces one, so this fires only
	// for a model that did not come from this converter.
	CodeInvalidTransitionIngress ErrorCode = "InvalidTransitionIngress"
	CodeDuplicateActionLabel     ErrorCode = "DuplicateActionLabel"
	// CodeUnsupportedConstruct is emitted when a user-authored construct exists
	// in the DSL but is not yet supported or is invalid in the current context
	// (e.g. #it outside a pipe step, state_file schema not pre-loaded).
	CodeUnsupportedConstruct ErrorCode = "UnsupportedConstruct"
	// CodeInternalError is emitted when the compiler detects an internal
	// invariant violation that indicates a compiler bug rather than a user
	// error. These diagnostics should be reported as bugs; they should never
	// appear for valid input processed by a correct compiler.
	CodeInternalError    ErrorCode = "InternalError"
	CodeCyclicBinding    ErrorCode = "CyclicBinding"
	CodeEmptyArrayLitArg ErrorCode = "EmptyArrayLitArg"
	// CodeDuplicateCasePattern is emitted when two arms of a case expression
	// match the same literal value. The second arm is unreachable dead code.
	CodeDuplicateCasePattern ErrorCode = "DuplicateCasePattern"
)

// Error codes from scene-graph.md
const (
	CodeMissingScene             ErrorCode = "MissingScene"
	CodeDuplicateSceneID         ErrorCode = "DuplicateSceneID"
	CodeInvalidActionGraph       ErrorCode = "InvalidActionGraph"
	CodeActionRootNotFound       ErrorCode = "ActionRootNotFound"
	CodeIngressTargetNotValue    ErrorCode = "IngressTargetNotValue"
	CodeIngressSourceMissing     ErrorCode = "IngressSourceMissing"
	CodeEgressSourceInvalid      ErrorCode = "EgressSourceInvalid"
	CodeEgressSourceUnavailable  ErrorCode = "EgressSourceUnavailable"
	CodeNextComputeInvalid       ErrorCode = "NextComputeInvalid"
	CodeNextComputeNotBool       ErrorCode = "NextComputeNotBool"
	CodeNextIngressSourceInvalid ErrorCode = "NextIngressSourceInvalid"
	CodeActionTextDuplicate      ErrorCode = "ActionTextDuplicate"
	// CodeNextMatchArity is emitted when an arm of `next on (...) to { }`
	// carries a different number of pattern elements than the subject list.
	CodeNextMatchArity ErrorCode = "NextMatchArity"
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
	// compute block output.
	CodeNextPrepareFromActionUnknown ErrorCode = "NextPrepareFromActionUnknown"
	// CodeNextPrepareFromActionTypeMismatch is emitted when the type of the
	// from_action source binding does not match the target binding's declared type.
	CodeNextPrepareFromActionTypeMismatch ErrorCode = "NextPrepareFromActionTypeMismatch"
)

// Error codes from overview-dsl-spec.md §9 (Overview DSL)
const (
	// parse stage (§9.1)
	CodeOverviewFlowEmpty         ErrorCode = "OverviewFlowEmpty"
	CodeOverviewEdgeWithoutSource ErrorCode = "OverviewEdgeWithoutSource"
	CodeOverviewEdgeNoTarget      ErrorCode = "OverviewEdgeNoTarget"
	CodeOverviewChainNoTarget     ErrorCode = "OverviewChainNoTarget"
	CodeOverviewInvalidIdent      ErrorCode = "OverviewInvalidIdent"
	// compile stage (§9.2)
	CodeOverviewInvalidMode ErrorCode = "OverviewInvalidMode"
	CodeOverviewDuplicate   ErrorCode = "OverviewDuplicate"
	// SCN_OVERVIEW_UNKNOWN_VIEW was retired in v2 (NEW_SYNTAX.md 2.2): the
	// overview block is unlabelled, so there is no view name left to get wrong.
	// enforce stage (§9.3)
	CodeOverviewUnknownNode ErrorCode = "OverviewUnknownNode"
	CodeOverviewMissingEdge ErrorCode = "OverviewMissingEdge"
	CodeOverviewExtraNode   ErrorCode = "OverviewExtraNode"
	CodeOverviewExtraEdge   ErrorCode = "OverviewExtraEdge"
)

// Error codes for literal & template types and pattern matching (literal-template-types-spec.md §23).
const (
	// CodeDuplicateUnionMember: a literal union repeats a member value (§5.2).
	CodeDuplicateUnionMember ErrorCode = "DuplicateUnionMember"
	// CodeMixedUnionBase: literal union members do not share a compatible base
	// type (§5.3).
	CodeMixedUnionBase ErrorCode = "MixedUnionBase"
	// CodeCyclicTypeAlias: a named type alias chain forms a cycle (§5.4).
	CodeCyclicTypeAlias ErrorCode = "CyclicTypeAlias"
	// CodeUnknownType: a type reference names an undeclared type.
	CodeUnknownType ErrorCode = "UnknownType"
	// CodeDuplicateTypeDecl: two top-level type declarations share a name.
	CodeDuplicateTypeDecl ErrorCode = "DuplicateTypeDecl"
	// CodeDuplicateCaptureName: a template declares the same capture name twice
	// (§6.4).
	CodeDuplicateCaptureName ErrorCode = "DuplicateCaptureName"
	// CodeAmbiguousTemplate: a template literal type has no unique decoding
	// (§7.1-§7.3).
	CodeAmbiguousTemplate ErrorCode = "AmbiguousTemplate"
	// CodeInvalidCaptureType: a capture declares a type not permitted in
	// templates (§6.3).
	CodeInvalidCaptureType ErrorCode = "InvalidCaptureType"
	// CodeNonExhaustiveMatch: a case does not cover all values of a finite or
	// analyzable input type (§14).
	CodeNonExhaustiveMatch ErrorCode = "NonExhaustiveMatch"
	// CodeUnreachableArm: a case arm is fully shadowed by earlier arms (§17).
	CodeUnreachableArm ErrorCode = "UnreachableArm"
	// CodeOverlappingPatterns is a warning for arms that partially overlap an
	// earlier arm; ordered matching keeps behaviour deterministic (§17.6).
	CodeOverlappingPatterns ErrorCode = "OverlappingPatterns"
	// CodeInvalidTemplateValue: a literal value is not a member of the template
	// literal type it is assigned to (§11.1, §23.2).
	CodeInvalidTemplateValue ErrorCode = "InvalidTemplateValue"
	// CodeMissingCapture: a template construction omits a required capture
	// (§11.5).
	CodeMissingCapture ErrorCode = "MissingCapture"
	// CodeUnknownCapture: a template construction provides an unknown capture
	// (§11.6).
	CodeUnknownCapture ErrorCode = "UnknownCapture"
	// CodeNotAssignable: a value's type is not assignable to the destination
	// literal/template type (§10, §23.1).
	CodeNotAssignable ErrorCode = "NotAssignable"
)
