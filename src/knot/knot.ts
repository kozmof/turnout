import { type OpsCollection, type OpsTreeRef } from "../condition/ops";
import { type SceneId } from "../scene/scene";
import { type Brand } from "../util/brand";
import { PropertyId, type PropertyState } from "./property";

export type KnotId = Brand<number, "knot">
export interface KnotPayload {
  ops: {
    nextState: {
      [key in PropertyId]: {
        treeRef: OpsTreeRef
        collection: OpsCollection
      }
    },
    nextKnotId: {
      treeRef: OpsTreeRef
      collection: OpsCollection
    },
  },
}

export type CandidateIdMap = Record<string, KnotId> & Record<"default", KnotId>
export interface Knot {
  id: KnotId
  sceneId: SceneId
  from: KnotId[]
  to: CandidateIdMap
  payload: KnotPayload
}
