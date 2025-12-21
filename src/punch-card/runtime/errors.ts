import { FuncId, ValueId, PlugDefineId, TapDefineId } from '../types';
import { NodeId } from './tree-types';

// Define error data types separately for type safety
type MissingDependencyErrorData = {
  readonly kind: 'missingDependency';
  readonly missingId: NodeId;
  readonly dependentId: NodeId;
};

type MissingDefinitionErrorData = {
  readonly kind: 'missingDefinition';
  readonly missingDefId: PlugDefineId | TapDefineId;
  readonly funcId: FuncId;
};

type FunctionExecutionErrorData = {
  readonly kind: 'functionExecution';
  readonly funcId: FuncId;
  readonly message: string;
  readonly cause?: Error;
};

type EmptySequenceErrorData = {
  readonly kind: 'emptySequence';
  readonly funcId: FuncId;
};

type MissingValueErrorData = {
  readonly kind: 'missingValue';
  readonly valueId: ValueId;
};

// Combine Error with data types
export type MissingDependencyError = Error & MissingDependencyErrorData;
export type MissingDefinitionError = Error & MissingDefinitionErrorData;
export type FunctionExecutionError = Error & FunctionExecutionErrorData;
export type EmptySequenceError = Error & EmptySequenceErrorData;
export type MissingValueError = Error & MissingValueErrorData;

export type GraphExecutionError =
  | MissingDependencyError
  | MissingDefinitionError
  | FunctionExecutionError
  | EmptySequenceError
  | MissingValueError;

// Factory functions that create Error instances with additional properties
export function createMissingDependencyError(
  missingId: NodeId,
  dependentId: NodeId
): MissingDependencyError {
  const error = new Error(
    `Missing dependency ${missingId} required by ${dependentId}`
  );
  error.name = 'MissingDependencyError';

  const errorData: MissingDependencyErrorData = {
    kind: 'missingDependency',
    missingId,
    dependentId,
  };

  return Object.assign(error, errorData);
}

export function createMissingDefinitionError(
  missingDefId: PlugDefineId | TapDefineId,
  funcId: FuncId
): MissingDefinitionError {
  const error = new Error(
    `Missing definition ${missingDefId} for function ${funcId}`
  );
  error.name = 'MissingDefinitionError';

  const errorData: MissingDefinitionErrorData = {
    kind: 'missingDefinition',
    missingDefId,
    funcId,
  };

  return Object.assign(error, errorData);
}

export function createFunctionExecutionError(
  funcId: FuncId,
  message: string,
  cause?: Error
): FunctionExecutionError {
  const error = new Error(
    `Function ${funcId} execution failed: ${message}`
  );
  error.name = 'FunctionExecutionError';

  const errorData: FunctionExecutionErrorData = {
    kind: 'functionExecution',
    funcId,
    message,
    ...(cause !== undefined && { cause }),
  };

  return Object.assign(error, errorData);
}

export function createEmptySequenceError(funcId: FuncId): EmptySequenceError {
  const error = new Error(`TapFunc ${funcId} has empty sequence`);
  error.name = 'EmptySequenceError';

  const errorData: EmptySequenceErrorData = {
    kind: 'emptySequence',
    funcId,
  };

  return Object.assign(error, errorData);
}

export function createMissingValueError(
  valueId: ValueId
): MissingValueError {
  const error = new Error(`Missing value: ${valueId}`);
  error.name = 'MissingValueError';

  const errorData: MissingValueErrorData = {
    kind: 'missingValue',
    valueId,
  };

  return Object.assign(error, errorData);
}

// Type guard
export function isGraphExecutionError(
  error: unknown
): error is GraphExecutionError {
  return (
    error instanceof Error &&
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    typeof (error as GraphExecutionError).kind === 'string'
  );
}
