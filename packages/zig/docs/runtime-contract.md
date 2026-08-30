# Runtime contract

This document records the first Zig runtime boundary. It uses converter JSON as the parity baseline.

## Transport

The Go converter's sanitized JSON output is the only accepted transport in the first milestone. Protobuf bytes are not accepted. Unknown JSON fields are ignored so a newer converter can add fields without breaking an older runtime.

JSON-first is the recorded transport decision. It avoids giving Zig compiler-only fields that exist in the in-memory protobuf message. A Zig protobuf generator is not selected or required for this milestone. Revisit generator support only with a proposal that covers proto3 optional fields, reserved fields, maps, recursive messages, and google.protobuf.Value.

## Runtime projection

The projection retains these model fields.

| Message | Retained fields |
| --- | --- |
| TurnModel | state, scenes, routes, version, minVersion, maxVersion, typeDecls |
| StateModel | namespaces |
| NamespaceModel | name, fields |
| FieldModel | name, type, value |
| SceneBlock | id, entryAction, actions, view |
| ViewBlock | name, flow, enforce |
| ActionModel | id, compute, prepare, merge, publish, next, text |
| ComputeModel | root, prog |
| ProgModel | name, bindings |
| BindingModel | name, type, value, expr |
| ExprModel and children | combine, pipe, cond, params, steps, args, refs, literals, transforms |
| PrepareEntry | binding, fromState, fromHook |
| MergeEntry | binding, toState |
| NextRuleModel | compute, prepare, action |
| NextComputeModel | condition, prog |
| NextPrepareEntry | binding, fromAction, fromState, fromLiteral |
| RouteModel | id, match, entrySceneId |
| MatchArm | patterns, target |
| Type declarations | names, type expressions, unions, templates, segments, captures |

Absent optional fields remain absent in the parsed JSON tree. Absent repeated fields are equivalent to empty lists when the typed model layer reads them. Unknown fields are retained in the parsed tree and ignored by execution. Reserved protobuf fields are not emitted. A matching unknown JSON key follows the unknown-field rule.

## Protobuf generator evaluation

Two active Zig implementations were considered.

| Candidate | Finding |
| --- | --- |
| [Arwalk zig-protobuf](https://github.com/Arwalk/zig-protobuf) | Provides protobuf 3 generation, materialized and streaming decode, and optional unknown-field preservation. Its JSON support is marked beta. The current evaluation does not prove Turnout's optional fields and google.protobuf.Value contract. |
| [gremlin.zig](https://github.com/norma-core/gremlin.zig) | Provides proto2 and proto3 generation with recursive-message support. Its documented tested compiler is Zig 0.15.2, while Turnout pins Zig 0.16.0. The current evaluation does not prove well-known Value support or Turnout's optional-field behavior. |

Neither candidate is selected. JSON decoding already covers the sanitized runtime projection and avoids a second wire contract. A later protobuf proposal must pin a generator commit and pass the representative fixture suite before adding generated Zig.

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

## WASM ABI

The WASM boundary uses ABI version 1. Lengths are unsigned 32-bit values. Byte fields and JSON payloads use UTF-8. Multi-byte integers use little-endian order.

### Input buffers

Call `turnout_alloc(length)` and copy exactly `length` bytes to the returned address. Zero reports allocation failure for a nonzero request. Release the buffer with `turnout_free(address, length)` using the same pair. `(0, 0)` is a no-op. ABI calls borrow input buffers, so the host retains ownership.

### Runtime handles

Runtime handles are unsigned 32-bit IDs, not pointers. Zero is invalid. Creation owns the decoded model, initial STATE, and execution state until destroy succeeds. A destroyed handle is invalid and cannot be reused.

### Response buffers

Responses are host-owned allocations with this 12-byte header.

| Offset | Width | Field | Meaning |
| --- | --- | --- | --- |
| 0 | 4 | magic | `0x4e525554` |
| 4 | 2 | ABI version | `1` |
| 6 | 2 | status | `0` ok, `1` invalid input, `2` invalid handle, `3` runtime error, `4` out of memory, `5` internal error |
| 8 | 4 | payload length | Bytes after the header |

The total allocation length is `12 + payload length`. Read or copy the payload, then release the response with `turnout_free(address, total_length)`. Later runtime calls do not invalidate it. A nonempty payload contains one JSON value.

Invalid model, STATE, and effect-result data returns a structured status. Defined limit failures do not trap.

Raw memory addresses are the exception. Bounds-check addresses and lengths against exported WASM memory before calling the ABI. An out-of-bounds memory read traps before Zig can return a status. A mismatched allocation address or length is also a host contract violation.
