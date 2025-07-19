import { type KnotId } from '../knot/knot';
import { type Brand } from '../util/brand';

export type BoxId = Brand<number, 'box'>

export interface Box {
  id: BoxId
  knotIds: KnotId[]
}