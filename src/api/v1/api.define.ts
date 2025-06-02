import { type MetaTransformArray } from "../../state/preset/array/transform";
import { type MetaProcessArray } from "../../state/preset/array/process";
import { type MetaProcessGeneric } from "../../state/preset/generic/process";
import { type MetaTransformNumber } from "../../state/preset/number/transform";
import { type MetaProcessNumber } from "../../state/preset/number/process";
import { type MetaTransformString } from "../../state/preset/string/transform";
import { type MetaProcessString } from "../../state/preset/string/process";
import { type DeterministicSymbol, type NonDeterministicSymbol } from "../../state/value";
import { type Knot, type KnotId, type KnotPayload } from "../../knot/knot";
import { type Property, type PropertyId, type PropertyState } from "../../knot/property";
import { type Scene, type SceneId } from "../../scene/scene";

export interface IFKnotAPI {
  createEmptyKnot: () => Knot

  addPayload: (val: { knot: Knot, payload: KnotPayload }) => Knot
  removePayload: (val: { knot: Knot, payload: KnotPayload }) => Knot

  addKnotFrom: (val: { knot: Knot, fromId: KnotId }) => Knot
  removeKnotFrom: (val: { knot: Knot, fromId: KnotId }) => Knot

  addKnotTo: (val: { knot: Knot, toId: KnotId }) => Knot
  removeKnotTo: (val: { knot: Knot, toId: KnotId }) => Knot

  addSceneId: (val: { knot: Knot, sceneId: SceneId }) => Scene
  removeSceneId: (val: { knot: Knot, sceneId: SceneId }) => Scene
}

export interface IFSceneAPI {
  createEmptyScene: () => Scene

  addKnotId: (val: { scene: Scene, knotId: KnotId }) => Scene
  removeKnotId: (val: { scene: Scene, knotId: KnotId }) => Scene
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
  condition: {
    getTransform: (val: { symbol: DeterministicSymbol | NonDeterministicSymbol }) =>
      MetaTransformNumber |
      MetaTransformString |
      MetaTransformArray,
    getProcess: (val: { symbol: DeterministicSymbol | NonDeterministicSymbol }) =>
      MetaProcessNumber |
      MetaProcessString |
      MetaProcessArray |
      MetaProcessGeneric
  }
}
