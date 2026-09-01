# TypeScript compatibility

The TypeScript packages keep their current public APIs during the migration. No public export is approved for removal or deprecation in the current phase.

## Runtime package

| Exports | Outcome |
| --- | --- |
| Value, BaseTypeSymbol, BaseTypeSubSymbol, NullReasonSubSymbol, TagSymbol | Retain types |
| NumberValue, StringValue, BooleanValue, NullValue, ArrayValue, RecordValue | Retain types |
| ArrayNumberValue, ArrayStringValue, ArrayBooleanValue, ArrayNullValue | Retain types |
| TypedArrayValue, AnyArrayValue, NonArrayValue, AnyValue | Retain types |
| PureNumberValue, PureStringValue, PureBooleanValue, PureNullValue, PureArrayValue, PureRecordValue | Retain types |
| baseTypeSymbols, nullReasonSubSymbols | Retain constants |
| isNumber, isString, isBoolean, isNull, isArray, isRecord, isTypedArray | Retain guards |
| isPure, hasTag, isPureNumber, isPureString, isPureBoolean, isPureNull | Retain guards |
| buildNumber, buildString, buildBoolean, buildNull, buildArray, buildRecord | Retain builders |
| buildArrayNumber, buildArrayString, buildArrayBoolean, buildArrayNull | Retain builders |
| recordGet, recordSet, convertValue | Retain helpers |
| combineNumberOp, combineStringOp, combineBooleanOp | Retain helpers |
| unaryNumberOp, unaryStringOp, unaryBooleanOp | Retain helpers |
| InvalidValueError, ValueBuilderError | Retain types |
| createInvalidValueError, isValueBuilderError | Retain helpers |
| executeGraph, executeGraphSafe, buildExecutionTree, executeTree | Keep until a separately reviewed deprecation after Zig compute parity |
| buildReturnIdToFuncIdMap, getCombineFnReturnType | Retain JavaScript utilities |
| ExecutionResult, UnvalidatedContext, ValidatedContext | Retain types |
| ValidationError, ValidationWarning, ValidationResult | Retain types |
| validateContext, assertValidContext, isValidContext | Retain JavaScript validators |
| ExecutionContext, ValueTable, FuncTable | Retain types |
| CombineFuncDefTable, PipeFuncDefTable, CondFuncDefTable | Retain types |
| ConditionId, FuncId, ValueId, ArgName | Retain types |
| CombineDefineId, PipeDefineId, CondDefineId | Retain types |
| PipeStepBinding, PipeArgBinding, CombineFnNames, TransformFnNames | Retain types |
| isValueCondition, isFuncCondition | Retain guards |
| GraphExecutionError, NodeId, ExecutionTree | Retain types |
| createMissingDependencyError, createMissingDefinitionError | Retain error helpers |
| createFunctionExecutionError, createEmptySequenceError, createMissingValueError | Retain error helpers |
| isGraphExecutionError, assertNever | Retain helpers |
| ctx, combine, pipe, cond, val, ref | Retain the JavaScript builder API |
| ContextBuilder, ContextSpec, BuildResult | Retain types |
| BuilderValidationError, UndefinedConditionError, UndefinedBranchError | Retain types |
| UndefinedValueReferenceError, UndefinedPipeArgumentError | Retain types |
| UndefinedPipeStepReferenceError, isBuilderValidationError | Retain type and guard |

## Runtime implementation status

All runtime outcomes above are implemented. `src/index.test.ts` locks the retained value exports to the package entry point. Type checking and the distribution build verify the retained type exports and signatures. The four compute execution helpers remain available under their recorded keep outcome. No runtime export is deprecated or approved for removal.

## Scene-runner package

| Exports | Outcome |
| --- | --- |
| createRunner, createSceneRunner, createRouteRunner | Retain signatures and behavior through the Zig adapter |
| Runner, RunnerOptions, RunnerStepResult | Retain types |
| runHarness, ExecutionOptions, HarnessOptions | Retain |
| HarnessResult, FullHarnessResult, FragmentHarnessResult | Retain result shapes |
| HookRegistry, PrepareHookImpl, PublishHookImpl, PublishHookOutcome | Retain hook contracts |
| PrepareHookContext, PublishHookContext | Retain hook context |
| ActionTrace, SceneTrace, RouteTrace, ExecutionTrace | Retain trace shapes |
| ExecutionWarning, SceneWarning | Retain warning shapes and order |
| TurnModel | Retain generated type export |
| stateManagerFromUnchecked, stateManagerFromStrict, stateManagerFromSchema | Retain JavaScript compatibility utilities |
| StateManager, StateReader | Retain types |
| executeSceneSafe, executeRouteSafe | Keep until a separately reviewed deprecation after Zig parity |
| SceneResult, SceneExecutionResult, SceneExecutionOptions | Retain types while executeSceneSafe remains |
| RouteResult, RouteExecutionResult | Retain types while executeRouteSafe remains |
| RunnerError, StateError, ModelValidationError, RouteRuntimeError | Retain classes and fields |
| isSceneRuntimeError, isPublishHookFailedError, isRunnerError | Retain guards |
| isStateError, isModelValidationError, isRouteRuntimeError | Retain guards |
| RunnerErrorCode, StateErrorCode, ModelValidationErrorCode, RouteErrorCode | Retain code unions |
| SceneRuntimeError, PublishHookFailedError | Retain error shapes |
| SceneErrorCode, SceneInternalErrorCode | Retain code unions |
| collectPublishFailures, PublishFailure | Retain helper and type |

## Server entry point

| Exports | Outcome |
| --- | --- |
| runServerHarness, ServerHarnessOptions | Retain |
| loadTurnFile, loadJsonModel | Retain |
| convertToHCL, runConverter | Retain |
| resetBinCache, DEFAULT_MAX_INPUT_BYTES | Retain |
| BridgeOptions | Retain type |
| LoadError, BridgeError, HarnessError | Retain classes and fields |
| isLoadError, isBridgeError, isHarnessError | Retain guards |
| LoadErrorCode, BridgeErrorCode, HarnessErrorCode | Retain code unions |

## Runner behavior

- Register mutable prepare and publish hooks only before execution starts.
- Count actions rather than scene-transition events in next.
- Return action and scene-transition events from next and runAsync.
- Reject concurrent execution and invalid step counts with RunnerError.
- Throw AbortError when the supplied signal is aborted.
- Keep result unavailable until execution completes.
- Return a current StateManager from partialState during execution.
- Preserve structured logs, warning order, execution limits, and strict publish behavior.
- Preserve committed STATE when strict publish fails.

Set a deprecation window in a separately reviewed release plan before changing any outcome to deprecate or remove.
