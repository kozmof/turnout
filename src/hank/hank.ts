import { type KnotId } from '../knot/knot';
import { type Brand } from '../util/brand';

export type HankId = Brand<string, 'hank'>

export interface Hank {
  id: HankId
  knotIds: KnotId[]
}
