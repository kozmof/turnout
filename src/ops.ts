import { nonDeterministicSymbols, type AllValues, type DeterministicSymbol, type NonDeterministicSymbol } from "./value";

export interface ValuePkg {
  tag: "value"
  entity: AllValues
}

export interface OpsPkg {
  tag: "ops"
  entity: OpsContainer
}

export interface OpsContainer {
  a: ValuePkg | OpsPkg
  b: ValuePkg | OpsPkg
  opsId: number
}

export type OpsCollection = {
  [opsId in number]: {
    preprocessA: (value: AllValues) => AllValues,
    preprocessB: (value: AllValues) => AllValues,
    process: (a: AllValues, b: AllValues) => AllValues
  }
}

export function isValuePkg(pkg: ValuePkg | OpsPkg): pkg is ValuePkg {
  return pkg.tag === "value";
}

export function isOpsPkg(pkg: ValuePkg | OpsPkg): pkg is OpsPkg {
  return pkg.tag === "ops";
}

export function calcValues<T extends AllValues, U extends AllValues, V extends AllValues>(
  container: OpsContainer,
  preprocessA: (value: AllValues) => T,
  preprocessB: (value: AllValues) => U,
  process: (a: T, b: U) => V
): V {
  const pkgA = container.a;
  const pkgB = container.b;
  if (isValuePkg(pkgA) && isValuePkg(pkgB)) {
    const valueA = preprocessA(pkgA.entity);
    const valueB = preprocessB(pkgB.entity);
    return process(valueA, valueB);
  } else {
    throw new Error();
  }
}

export function isRandomValue(a: AllValues, b: AllValues): boolean {
  const tags: Array<NonDeterministicSymbol | DeterministicSymbol> = nonDeterministicSymbols;
  return (tags.includes(a.symbol) || tags.includes(b.symbol));
}

export function calcAllOps(container: OpsContainer, opsCollection: OpsCollection) : AllValues {
  const dig = (container: OpsContainer): AllValues => {
    const coll = opsCollection[container.opsId];
    if (container.a.tag === "value" && container.b.tag === "value") {
      return coll.process(
        coll.preprocessA(container.a.entity),
        coll.preprocessB(container.b.entity)
      );

    } else if (container.a.tag === "value" && container.b.tag === "ops") {
      const valB = dig(container.b.entity);
      return coll.process(
        coll.preprocessA(container.a.entity),
        coll.preprocessB(valB)
      );

    } else if (container.a.tag === "ops" && container.b.tag === "value") {
      const valA = dig(container.a.entity);
      return coll.process(
        coll.preprocessA(valA),
        coll.preprocessB(container.b.entity)
      );

    } else if (container.a.tag === "ops" && container.b.tag === "ops") {
      const valA = dig(container.a.entity);
      const valB = dig(container.b.entity);
      return coll.process(
        coll.preprocessA(valA),
        coll.preprocessB(valB)
      );

    } else {
      throw new Error();
    }
  };
  const result = dig(container);
  return result;
}
