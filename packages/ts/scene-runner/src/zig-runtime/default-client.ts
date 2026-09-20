/**
 * Re-exported from the `runtime` package.
 *
 * Everything in this package reaches the Zig runtime through `./client.js`,
 * `./default-client.js`, and `./value-codec.js` rather than importing the
 * `runtime` package directly, so the dependency is declared in these three
 * files and nowhere else. Swapping the client, or renaming the package it
 * comes from, is a change to this directory rather than to every call site.
 */
export {
  defaultZigRuntimeClient,
  setDefaultZigRuntimeClient,
  reloadDefaultZigRuntimeClient,
} from "runtime/zig-runtime";
