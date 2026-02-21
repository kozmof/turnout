import { ValueRef, FuncRef } from './types';

// Define error data types separately for type safety
type UndefinedConditionErrorData = {
  readonly kind: 'undefinedCondition';
  readonly funcId: string;
  readonly conditionRef: ValueRef;
};

type UndefinedBranchErrorData = {
  readonly kind: 'undefinedBranch';
  readonly funcId: string;
  readonly branchType: 'then' | 'else';
  readonly branchRef: FuncRef;
};

type UndefinedValueReferenceErrorData = {
  readonly kind: 'undefinedValueReference';
  readonly funcId: string;
  readonly argName: string;
  readonly valueRef: ValueRef;
};

type UndefinedPipeArgumentErrorData = {
  readonly kind: 'undefinedPipeArgument';
  readonly funcId: string;
  readonly argName: string;
  readonly binding: string;
};

type UndefinedPipeStepReferenceErrorData = {
  readonly kind: 'undefinedPipeStepReference';
  readonly funcId: string;
  readonly stepIndex: number;
  readonly argName: string;
  readonly reference: string;
};

// Combine Error with data types
export type UndefinedConditionError = Error & UndefinedConditionErrorData;
export type UndefinedBranchError = Error & UndefinedBranchErrorData;
export type UndefinedValueReferenceError = Error & UndefinedValueReferenceErrorData;
export type UndefinedPipeArgumentError = Error & UndefinedPipeArgumentErrorData;
export type UndefinedPipeStepReferenceError = Error & UndefinedPipeStepReferenceErrorData;

export type BuilderValidationError =
  | UndefinedConditionError
  | UndefinedBranchError
  | UndefinedValueReferenceError
  | UndefinedPipeArgumentError
  | UndefinedPipeStepReferenceError;

// Factory functions that create Error instances with additional properties
export function createUndefinedConditionError(
  funcId: string,
  conditionRef: ValueRef
): UndefinedConditionError {
  const error = new Error(
    `Cond function '${funcId}' references undefined condition: '${conditionRef}'`
  );
  error.name = 'UndefinedConditionError';

  const errorData: UndefinedConditionErrorData = {
    kind: 'undefinedCondition',
    funcId,
    conditionRef,
  };

  return Object.assign(error, errorData);
}

export function createUndefinedBranchError(
  funcId: string,
  branchType: 'then' | 'else',
  branchRef: FuncRef
): UndefinedBranchError {
  const error = new Error(
    `Cond function '${funcId}' references undefined '${branchType}' branch: '${branchRef}'`
  );
  error.name = 'UndefinedBranchError';

  const errorData: UndefinedBranchErrorData = {
    kind: 'undefinedBranch',
    funcId,
    branchType,
    branchRef,
  };

  return Object.assign(error, errorData);
}

export function createUndefinedValueReferenceError(
  funcId: string,
  argName: string,
  valueRef: ValueRef
): UndefinedValueReferenceError {
  const error = new Error(
    `Combine function '${funcId}' argument '${argName}' references undefined value: '${valueRef}'`
  );
  error.name = 'UndefinedValueReferenceError';

  const errorData: UndefinedValueReferenceErrorData = {
    kind: 'undefinedValueReference',
    funcId,
    argName,
    valueRef,
  };

  return Object.assign(error, errorData);
}

export function createUndefinedPipeArgumentError(
  funcId: string,
  argName: string,
  binding: string
): UndefinedPipeArgumentError {
  const error = new Error(
    `Pipe function '${funcId}' argument '${argName}' references undefined or non-value: '${binding}'`
  );
  error.name = 'UndefinedPipeArgumentError';

  const errorData: UndefinedPipeArgumentErrorData = {
    kind: 'undefinedPipeArgument',
    funcId,
    argName,
    binding,
  };

  return Object.assign(error, errorData);
}

export function createUndefinedPipeStepReferenceError(
  funcId: string,
  stepIndex: number,
  argName: string,
  reference: string
): UndefinedPipeStepReferenceError {
  const error = new Error(
    `Pipe function '${funcId}' step ${String(stepIndex)} argument '${argName}' references undefined: '${reference}'`
  );
  error.name = 'UndefinedPipeStepReferenceError';

  const errorData: UndefinedPipeStepReferenceErrorData = {
    kind: 'undefinedPipeStepReference',
    funcId,
    stepIndex,
    argName,
    reference,
  };

  return Object.assign(error, errorData);
}

const BUILDER_VALIDATION_ERROR_KINDS = new Set<string>([
  'undefinedCondition',
  'undefinedBranch',
  'undefinedValueReference',
  'undefinedPipeArgument',
  'undefinedPipeStepReference',
]);

// Type guard
export function isBuilderValidationError(
  error: unknown
): error is BuilderValidationError {
  return (
    error instanceof Error &&
    'kind' in error &&
    BUILDER_VALIDATION_ERROR_KINDS.has((error as { kind: unknown }).kind as string)
  );
}
