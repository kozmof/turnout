/**
 * Namespace delimiter used to separate namespace from function name.
 * Format: `${namespace}${NAMESPACE_DELIMITER}${functionName}`
 * Examples: "binaryFnNumber::add", "transformFnString::pass"
 */
export const NAMESPACE_DELIMITER = '::' as const;

/**
 * Type-level representation of the namespace delimiter.
 * Used in template literal types for compile-time validation.
 */
export type NamespaceDelimiter = typeof NAMESPACE_DELIMITER;
