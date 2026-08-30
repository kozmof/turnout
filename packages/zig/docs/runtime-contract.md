# Runtime contract

This document records the first Zig runtime boundary. It uses converter JSON as the parity baseline.

## Transport

The Go converter's sanitized JSON output is the only accepted transport in the first milestone. Protobuf bytes are not accepted. Unknown JSON fields are ignored so a newer converter can add fields without breaking an older runtime.

The runtime rejects malformed JSON, a non-object root, unsupported model versions, and incompatible minVersion or maxVersion values. The runtime also rejects compiler metadata when it appears at the model root.

Compiler-only fields include annotations, sourcePos, sigils, extExpr, and declaredType. The Go emitter remains responsible for stripping nested occurrences before transport. Projection tests in the converter must protect that rule.

google.protobuf.Value follows protobuf JSON mapping. JSON null maps to a Turnout null with reason unknown. Numbers use IEEE-754 binary64. The transport rejects non-finite numbers because JSON cannot represent them.

## Values

Strings are UTF-8 storage for JavaScript strings. JavaScript-visible length and case conversion need UTF-16 and ECMAScript-compatible behavior before the corresponding preset functions can reach parity.

Equality is structural and ignores tags. Scalars require matching kinds and matching payloads. Arrays compare their items in order and ignore the typed-array annotation. Records compare keys and values without using insertion order. Serialization preserves record insertion order.

Tag propagation uses set union. It preserves the first occurrence of each tag.

## Effects

Zig does not call hooks. It emits prepare and publish requests with a stable ID, hook name, scene ID, and action ID.

resume records one result and does not advance execution. Call step after resume. A runtime rejects stale IDs, duplicate results, and results of the wrong effect kind.

Cancellation clears the pending request and makes the runtime terminal.
