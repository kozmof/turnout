import { type ReturnMetaTransformFnArray } from '../../state/preset/array/transformFn';
import { type ReturnMetaBinaryFnArray } from '../../state/preset/array/binaryFn';
import { type ReturnMetaBinaryFnGeneric } from '../../state/preset/generic/binaryFn';
import { type ReturnMetaTransformFnNumber } from '../../state/preset/number/transformFn';
import { type ReturnMetaBinaryFnNumber } from '../../state/preset/number/binaryFn';
import { type ReturnMetaTransformFnString } from '../../state/preset/string/transformFn';
import { type ReturnMetaBinaryFnString } from '../../state/preset/string/binaryFn';
import {
  type DeterministicSymbol,
  type NonDeterministicSymbol,
} from '../../state/value';
import { type Knot, type KnotId, type KnotPayload } from '../../knot/knot';
import {
  type Property,
  type PropertyId,
  type PropertyState,
} from '../../knot/property';
import { type Hank, type HankId } from '../../hank/hank';
import { type ElemType } from '../../state/preset/util/getResultType';

export interface IFKnotAPI {
  createEmptyKnot: () => Knot;

  addPayload: (val: { knot: Knot; payload: KnotPayload }) => Knot;
  removePayload: (val: { knot: Knot; payload: KnotPayload }) => Knot;

  addKnotFrom: (val: { knot: Knot; fromId: KnotId }) => Knot;
  removeKnotFrom: (val: { knot: Knot; fromId: KnotId }) => Knot;

  addKnotTo: (val: { knot: Knot; toId: KnotId }) => Knot;
  removeKnotTo: (val: { knot: Knot; toId: KnotId }) => Knot;

  addHankId: (val: { knot: Knot; hankId: HankId }) => Hank;
  removeHankId: (val: { knot: Knot; hankId: HankId }) => Hank;
}

export interface IFBoxAPI {
  createEmptyHank: () => Hank;

  addKnotId: (val: { hank: Hank; knotId: KnotId }) => Hank;
  removeKnotId: (val: { hank: Hank; knotId: KnotId }) => Hank;
}

export interface IFPropertyAPI {
  addProperty: (val: { property: Property }) => PropertyState;
  removeProperty: (val: { propertyId: PropertyId }) => PropertyState;
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
      knot: Knot;
      state: PropertyState;
    }) => Promise<[KnotId, PropertyState]>;
  };
  state: {
    getTransformFn: (val: {
      symbol: DeterministicSymbol | NonDeterministicSymbol;
    }) =>
      | ReturnMetaTransformFnNumber
      | ReturnMetaTransformFnString
      | ReturnMetaTransformFnArray;
    getBinaryFn: (val: {
      symbol: DeterministicSymbol | NonDeterministicSymbol;
      elemType: ElemType | null;
    }) =>
      | ReturnMetaBinaryFnNumber
      | ReturnMetaBinaryFnString
      | ReturnMetaBinaryFnArray
      | ReturnMetaBinaryFnGeneric;
  };
}
