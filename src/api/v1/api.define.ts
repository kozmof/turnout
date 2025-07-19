import { type MetaTransformArray } from "../../state/preset/array/transform";
import { type ReturnMetaProcessArray } from "../../state/preset/array/process";
import { type ReturnMetaProcessGeneric } from "../../state/preset/generic/process";
import { type MetaTransformNumber } from "../../state/preset/number/transform";
import { type ReturnMetaProcessNumber } from "../../state/preset/number/process";
import { type MetaTransformString } from "../../state/preset/string/transform";
import { type ReturnMetaProcessString } from "../../state/preset/string/process";
import { type DeterministicSymbol, type NonDeterministicSymbol } from "../../state/value";
import { type Knot, type KnotId, type KnotPayload } from "../../knot/knot";
import { type Property, type PropertyId, type PropertyState } from "../../knot/property";
import { type Box, type BoxId } from "../../box/box";

export interface IFKnotAPI {
  createEmptyKnot: () => Knot

  addPayload: (val: { knot: Knot, payload: KnotPayload }) => Knot
  removePayload: (val: { knot: Knot, payload: KnotPayload }) => Knot

  addKnotFrom: (val: { knot: Knot, fromId: KnotId }) => Knot
  removeKnotFrom: (val: { knot: Knot, fromId: KnotId }) => Knot

  addKnotTo: (val: { knot: Knot, toId: KnotId }) => Knot
  removeKnotTo: (val: { knot: Knot, toId: KnotId }) => Knot

  addBoxId: (val: { knot: Knot, boxId: BoxId }) => Box
  removeBoxId: (val: { knot: Knot, boxId: BoxId }) => Box
}

export interface IFBoxAPI {
  createEmptyBox: () => Box

  addKnotId: (val: { box: Box, knotId: KnotId }) => Box
  removeKnotId: (val: { box: Box, knotId: KnotId }) => Box
}

export interface IFPropertyAPI {
  addProperty: (val: { property: Property }) => PropertyState
  removeProperty: (val: { propertyId: PropertyId }) => PropertyState
}

/**
 * Utility for interacting with an external system.
 */
export interface IFInteractionAPI {
  knot: {
    /**
     * Determine a next knot id and a new state
     * @param val 
     * @returns 
     */
    next: (val: {
      knot: Knot
      state: PropertyState,
    }) => Promise<[KnotId, PropertyState]>,
  },
  state: {
    getTransform: (val: { symbol: DeterministicSymbol | NonDeterministicSymbol }) =>
      MetaTransformNumber |
      MetaTransformString |
      MetaTransformArray,
    getProcess: (val: { symbol: DeterministicSymbol | NonDeterministicSymbol }) =>
      ReturnMetaProcessNumber |
      ReturnMetaProcessString |
      ReturnMetaProcessArray |
      ReturnMetaProcessGeneric
  }
}
