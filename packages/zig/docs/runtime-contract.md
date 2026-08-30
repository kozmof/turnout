# Runtime contract

This document records the first Zig runtime boundary. It uses converter JSON as the parity baseline.

## Transport

The Go converter's sanitized JSON output is the only accepted transport in the first milestone. Protobuf bytes are not accepted. Unknown JSON fields are ignored so a newer converter can add fields without breaking an older runtime.

JSON-first is the recorded transport decision. It avoids giving Zig compiler-only fields that exist in the in-memory protobuf message. A Zig protobuf generator is not selected or required for this milestone. Revisit generator support only with a proposal that covers proto3 optional fields, reserved fields, maps, recursive messages, and google.protobuf.Value.

The runtime version is 2, matching the Go converter's emitted version. The runtime rejects malformed JSON, a non-object root, unsupported model versions, and incompatible minVersion or maxVersion values. It rejects compiler metadata anywhere in the model.

Compiler-only fields include annotations, sourcePos, sigils, extExpr, declaredType, overview nodes, and overview edges. The Go emitter strips these fields before transport. Projection tests in the converter protect that rule.

google.protobuf.Value follows protobuf JSON mapping. JSON null maps to a Turnout null with reason unknown. Arrays and records convert recursively. Record insertion order follows JSON member order. Numbers use IEEE-754 binary64. The transport rejects non-finite numbers because JSON cannot represent them.

## Values

Strings are UTF-8 storage for JavaScript strings. JavaScript-visible length and case conversion need UTF-16 and ECMAScript-compatible behavior before the corresponding preset functions can reach parity.

Equality is structural and ignores tags. Scalars require matching kinds and matching payloads. Arrays compare their items in order and ignore the typed-array annotation. Records compare keys and values without using insertion order. Serialization preserves record insertion order.

Tag propagation uses set union. It preserves the first occurrence of each tag.

## Effects

Zig does not call hooks. It emits prepare and publish requests with a stable ID, hook name, scene ID, and action ID.

resume records one result and does not advance execution. Call step after resume. A runtime rejects stale IDs, duplicate results, and results of the wrong effect kind.

Cancellation clears the pending request and makes the runtime terminal.

## Ownership

RuntimeModel owns its parsed JSON tree and releases it through deinit. Strings converted from JSON borrow from that tree. Converted arrays and record indexes own allocator-backed storage and release it recursively through value.deinit.
