import { type KnotId } from "../knot/knot";
import { type Brand } from "../util/brand";

export type SceneId = Brand<number, "scene">

export interface Scene {
  id: SceneId
  knotIds: KnotId[]
}