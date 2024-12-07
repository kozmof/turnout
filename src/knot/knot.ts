import { type OpsCollection, type OpsTreeRef } from "../condition/ops";
import { type SceneId } from "../scene/scene";
import { type Brand } from "../util/brand";

export type KnotId = Brand<number, "knot">
export interface KnotPayload {
  ops: {
    treeRef: OpsTreeRef
    collection: OpsCollection
  } | null
}

export interface Knot {
  id: KnotId
  sceneId: SceneId
  from: KnotId[]
  to: [KnotId, KnotId]
  payload: KnotPayload
}
