import { type OpsCollection, type OpsTreeRef } from "../state/ops";
import { type BoxId } from "../box/box";
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
  boxId: BoxId
  from: KnotId[]
  to: CandidateIdMap
  payload: KnotPayload
}
