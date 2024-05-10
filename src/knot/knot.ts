import { type OpsCollection, type OpsTree } from "../condition/ops";
import { type SceneId } from "../scene/scene";
import { type Brand } from "../util/brand";
import { type PropertyId } from "./property";

export type KnotId = Brand<number, "knot">

export interface Knot {
  id: KnotId
  sceneId: SceneId
  from: KnotId[]
  to: KnotId[]
  payload: {
    ops: {
      tree: OpsTree
      collection: OpsCollection
    } | null
    propertyIds: PropertyId[]
  }
}
