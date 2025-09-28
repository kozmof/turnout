import { type OpsCollection, type OpsTreeRef } from '../state-control/ops';
import { type HankId } from '../hank/hank';
import { type Brand } from '../util/brand';
import { type PropertyId } from './property';

export type KnotId = Brand<number, 'knot'>
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

export type CandidateIdMap = Record<string, KnotId> & Record<'default', KnotId>
export interface Knot {
  id: KnotId
  hankId: HankId
  from: KnotId[]
  to: CandidateIdMap
  payload: KnotPayload
}
