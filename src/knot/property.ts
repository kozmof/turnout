import { type AllValues } from "../condition/value";
import { type Brand } from "../util/brand";
import { type KnotId } from "./knot";

export type PropertyId = Brand<number, "property">

export interface Property {
  id: PropertyId
  name: string
  value: AllValues
  initPosition: KnotId
}