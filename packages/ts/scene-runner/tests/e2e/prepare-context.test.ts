/**
 * E2E: what a prepare hook can read
 *
 * Pipeline: prepare-context.tu → prepare-context.json → runHarness → hooks.
 *
 * The context a prepare hook receives is built by the Zig runtime, which holds
 * the model and STATE: the action's `from_state` bindings, with the results of
 * hooks earlier in the same action layered over them. No part of it is derived
 * by the TypeScript host, so this is the test that proves the two halves agree
 * — unit tests on either side would both pass with the boundary broken.
 */
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { runZigServerHarness as runHarness } from "./zig-harness.js";
import { buildNumber, isPureNumber, type AnyValue } from "turnout-runtime";

const fixture = resolve(__dirname, "../fixtures/prepare-context.json");

function numberOf(value: unknown): number | undefined {
  return isAnyValue(value) && isPureNumber(value) ? value.value : undefined;
}

function isAnyValue(value: unknown): value is AnyValue {
  return typeof value === "object" && value !== null && "symbol" in value;
}

describe("prepare-hook context", () => {
  it("carries the action's from_state bindings", async () => {
    const seen: Record<string, number | undefined> = {};

    const result = await runHarness({
      jsonFile: fixture,
      entryId: "checkout",
      initialState: {
        "order.subtotal": buildNumber(100),
        "order.discount": buildNumber(10),
        "order.total": buildNumber(0),
        "order.settled": buildNumber(0),
      },
      hooks: {
        extend: {},
        publish: {},
        prepare: {
          quote_shipping: (context) => {
            seen.subtotal = numberOf(context.get("subtotal"));
            seen.discount = numberOf(context.get("discount"));
            return { shipping: buildNumber(5) };
          },
          quote_tax: () => ({ tax: buildNumber(7) }),
        },
      },
    });

    expect(seen).toEqual({ subtotal: 100, discount: 10 });
    expect(numberOf(result.finalState["order.total"])).toBe(102);
    expect(numberOf(result.finalState["order.settled"])).toBe(204);
  });

  it("layers an earlier hook's result over the state it read", async () => {
    let shippingSeenByTax: number | undefined;
    let subtotalSeenByTax: number | undefined;

    await runHarness({
      jsonFile: fixture,
      entryId: "checkout",
      initialState: {
        "order.subtotal": buildNumber(40),
        "order.discount": buildNumber(0),
        "order.total": buildNumber(0),
        "order.settled": buildNumber(0),
      },
      hooks: {
        extend: {},
        publish: {},
        prepare: {
          quote_shipping: () => ({ shipping: buildNumber(12) }),
          quote_tax: (context) => {
            // Declaration order puts quote_shipping first, so its result is in
            // the context by the time this one is asked.
            shippingSeenByTax = numberOf(context.get("shipping"));
            subtotalSeenByTax = numberOf(context.get("subtotal"));
            return { tax: buildNumber(1) };
          },
        },
      },
    });

    expect(shippingSeenByTax).toBe(12);
    // The STATE bindings are still there underneath it.
    expect(subtotalSeenByTax).toBe(40);
  });

  it("reads a field the caller did not supply from the model default", async () => {
    let discount: unknown;

    await runHarness({
      jsonFile: fixture,
      entryId: "checkout",
      initialState: { "order.subtotal": buildNumber(10) },
      hooks: {
        extend: {},
        publish: {},
        prepare: {
          quote_shipping: (context) => {
            discount = context.get("discount");
            return { shipping: buildNumber(0) };
          },
          quote_tax: () => ({ tax: buildNumber(0) }),
        },
      },
    });

    // The model declares a default, so the field is written and readable.
    expect(discount).toMatchObject({ symbol: "number", value: 0 });
  });
});
