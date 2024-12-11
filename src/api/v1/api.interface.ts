import { type MetaPreprocessArray } from "../../condition/preset/array/preprocess";
import { type MetaProcessArray } from "../../condition/preset/array/process";
import { type MetaProcessGeneric } from "../../condition/preset/generic/process";
import { type MetaPreprocessNumber } from "../../condition/preset/number/preprocess";
import { type MetaProcessNumber } from "../../condition/preset/number/process";
import { type MetaPreprocessString } from "../../condition/preset/string/preprocess";
import { type MetaProcessString } from "../../condition/preset/string/process";
import { type AllValues, type DeterministicSymbol, type NonDeterministicSymbol } from "../../condition/value";
import { type CandidateIdMap, type Knot, type KnotId, type KnotPayload } from "../../knot/knot";
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
    getAvailablePreprocess: (val: { symbol: DeterministicSymbol | NonDeterministicSymbol }) =>
      MetaPreprocessNumber |
      MetaPreprocessString |
      MetaPreprocessArray,
    getAvailableProcess: (val: { symbol: DeterministicSymbol | NonDeterministicSymbol }) =>
      MetaProcessNumber |
      MetaProcessString |
      MetaProcessArray |
      MetaProcessGeneric
  }
}
