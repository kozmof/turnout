import { type AnyValue } from '../state-control/value';
import { type Brand } from '../util/brand';

export type PropertyId = Brand<number, 'property'>

export interface Property {
  id: PropertyId
  name: string
  value: AnyValue
}

export type PropertyState = {
  [key in PropertyId] : Property
}
