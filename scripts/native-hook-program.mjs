// Serves one conformance vector's hooks to the native host.
//
// The host spawns this with `--hook-program`, then speaks the same envelopes it
// would put on the WASM boundary: one `needEffect` request per line in, one
// answer per line out. So this program is also the worked example of the hook
// protocol — a hook implementation in a language the engine knows nothing
// about, which is the point of the native host existing.
//
// Usage: node native-hook-program.mjs <vector-json> <mismatch-file>
//
// Context expectations are checked here rather than by the caller, because here
// is the only place that sees them. Failures are appended to the mismatch file,
// which the caller reads after the run: a hook cannot fail the run just for
// seeing the wrong thing without also changing what the run does.
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const vector = JSON.parse(process.argv[2]);
const mismatchFile = process.argv[3];
const root = fileURLToPath(new URL("../", import.meta.url));

function report(message) {
  appendFileSync(mismatchFile, message + "\n");
}

function checkContext(label, seen, expected) {
  for (const [key, want] of Object.entries(expected ?? {})) {
    const got = seen[key];
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      report(`${label} saw ${key}=${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
  }
}

function prepareAnswer(request, script) {
  checkContext(
    `prepare hook "${request.hook}"`,
    JSON.parse(request.contextJson),
    script.expectContext,
  );
  if (script.fails !== undefined) {
    return { status: "failed", message: script.fails };
  }
  const returns = script.returns ?? {};
  // `binding` is set when the hook supplies exactly one, and the payload is
  // that value alone; otherwise it is the record of all of them.
  const value = request.binding === null ? returns : returns[request.binding];
  return { status: "ok", value: value ?? null };
}

function publishAnswer(request, script) {
  checkContext(
    `publish hook "${request.hook}"`,
    JSON.parse(request.contextJson),
    script.expectState,
  );
  return script.status === "error"
    ? { status: "failed", source: "returned", message: script.message ?? "" }
    : { status: "ok" };
}

/** An extend hook answers with a model, named by path so vectors stay data. */
function extendAnswer(script) {
  return {
    status: "ok",
    value: JSON.parse(readFileSync(resolve(root, script.returnsModel), "utf8")),
  };
}

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line);
  // On the wire an extend request is a prepare request with role "extend": it
  // fires in the same phase and answers through the same path, and only what
  // happens to the payload differs.
  const kind = request.role === "extend" ? "extend" : request.kind;
  const script = (vector.hooks?.[kind] ?? {})[request.hook];
  const answer =
    script === undefined
      ? { status: "missing" }
      : kind === "extend"
        ? extendAnswer(script)
        : kind === "prepare"
          ? prepareAnswer(request, script)
          : publishAnswer(request, script);
  process.stdout.write(JSON.stringify({ id: request.id, kind: request.kind, ...answer }) + "\n");
}
