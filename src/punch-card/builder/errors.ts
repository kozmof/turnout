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

type UndefinedTapArgumentErrorData = {
  readonly kind: 'undefinedTapArgument';
  readonly funcId: string;
  readonly argName: string;
  readonly binding: string;
};

type UndefinedTapStepReferenceErrorData = {
  readonly kind: 'undefinedTapStepReference';
  readonly funcId: string;
  readonly stepIndex: number;
  readonly argName: string;
  readonly reference: string;
};

// Combine Error with data types
export type UndefinedConditionError = Error & UndefinedConditionErrorData;
export type UndefinedBranchError = Error & UndefinedBranchErrorData;
export type UndefinedValueReferenceError = Error & UndefinedValueReferenceErrorData;
export type UndefinedTapArgumentError = Error & UndefinedTapArgumentErrorData;
export type UndefinedTapStepReferenceError = Error & UndefinedTapStepReferenceErrorData;

export type BuilderValidationError =
  | UndefinedConditionError
  | UndefinedBranchError
  | UndefinedValueReferenceError
  | UndefinedTapArgumentError
  | UndefinedTapStepReferenceError;

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
    `Plug function '${funcId}' argument '${argName}' references undefined value: '${valueRef}'`
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

export function createUndefinedTapArgumentError(
  funcId: string,
  argName: string,
  binding: string
): UndefinedTapArgumentError {
  const error = new Error(
    `Tap function '${funcId}' argument '${argName}' references undefined or non-value: '${binding}'`
  );
  error.name = 'UndefinedTapArgumentError';

  const errorData: UndefinedTapArgumentErrorData = {
    kind: 'undefinedTapArgument',
    funcId,
    argName,
    binding,
  };

  return Object.assign(error, errorData);
}

export function createUndefinedTapStepReferenceError(
  funcId: string,
  stepIndex: number,
  argName: string,
  reference: string
): UndefinedTapStepReferenceError {
  const error = new Error(
    `Tap function '${funcId}' step ${String(stepIndex)} argument '${argName}' references undefined: '${reference}'`
  );
  error.name = 'UndefinedTapStepReferenceError';

  const errorData: UndefinedTapStepReferenceErrorData = {
    kind: 'undefinedTapStepReference',
    funcId,
    stepIndex,
    argName,
    reference,
  };

  return Object.assign(error, errorData);
}

// Type guard
export function isBuilderValidationError(
  error: unknown
): error is BuilderValidationError {
  return (
    error instanceof Error &&
    'kind' in error &&
    typeof (error as { kind: unknown }).kind === 'string'
  );
}
