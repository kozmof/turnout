import { BaseTypeSymbol, BaseTypeSubSymbol } from './value';

// Define error data types separately for type safety
type InvalidValueErrorData = {
  readonly kind: 'invalidValue';
  readonly symbol: BaseTypeSymbol;
  readonly subSymbol: BaseTypeSubSymbol;
  readonly message: string;
};

// Combine Error with data types
export type InvalidValueError = Error & InvalidValueErrorData;

export type ValueBuilderError = InvalidValueError;

/**
 * Creates an error for when a value fails validation.
 *
 * @param symbol - The base type symbol
 * @param subSymbol - The sub-type symbol
 * @param message - Optional additional context
 * @returns An InvalidValueError instance
 */
export function createInvalidValueError(
  symbol: BaseTypeSymbol,
  subSymbol: BaseTypeSubSymbol,
  message?: string
): InvalidValueError {
  const fullMessage = message
    ? `Invalid value created: symbol=${symbol}, subSymbol=${String(subSymbol)} - ${message}`
    : `Invalid value created: symbol=${symbol}, subSymbol=${String(subSymbol)}`;

  const error = new Error(fullMessage);
  error.name = 'InvalidValueError';

  const errorData: InvalidValueErrorData = {
    kind: 'invalidValue',
    symbol,
    subSymbol,
    message: fullMessage,
  };

  return Object.assign(error, errorData);
}

/**
 * Type guard to check if an error is a ValueBuilderError.
 *
 * @param error - The error to check
 * @returns True if the error is a ValueBuilderError
 */
export function isValueBuilderError(
  error: unknown
): error is ValueBuilderError {
  return (
    error instanceof Error &&
    'kind' in error &&
    typeof (error as { kind: unknown }).kind === 'string'
  );
}
