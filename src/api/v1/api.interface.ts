import { type OpsCollection, type OpsTreeRef } from "../../condition/ops";
import { type Knot, type KnotId, type KnotPayload } from "../../knot/knot";
import { type PropertyState } from "../../knot/property";
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

export interface SetUp {
  condition: (val: boolean) => KnotId,
  action: (knotId: KnotId, state: PropertyState) => Promise<[boolean, PropertyState]>
}

export interface IFInteractionAPI {
  knot: {
    next: (
      treeRef: OpsTreeRef,
      opsCollection: OpsCollection,
      state: PropertyState,
      setup: SetUp
    ) => Promise<[KnotId, PropertyState]>
  }
}
