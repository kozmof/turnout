import { type AllValues } from "../condition/value";
import { type Brand } from "../util/brand";

export type PropertyId = Brand<number, "property">

export interface Property {
  id: PropertyId
  name: string
  value: AllValues
}

export type PropertyState = {
  [key in PropertyId] : Property
}
