import { type PropertyId } from "../knot/property";
import { nonDeterministicSymbols, type AllValues, type DeterministicSymbol, type NonDeterministicSymbol } from "./value";

export interface ValuePkg {
  tag: "value"
  entity: AllValues
}

export interface OpsPkg {
  tag: "ops"
  entity: OpsTree
}

export interface OpsPkgRef {
  tag: "ops"
  entity: OpsTreeRef
}

export interface PropertyPkg {
  tag: "prop"
  entity: PropertyId
}

export interface OpsTree {
  a: ValuePkg | OpsPkg
  b: ValuePkg | OpsPkg
  opsId: number
}

export interface OpsTreeRef {
  a: PropertyPkg | OpsPkgRef
  b: PropertyPkg | OpsPkgRef
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
  tree: OpsTree,
  preprocessA: (value: AllValues) => T,
  preprocessB: (value: AllValues) => U,
  process: (a: T, b: U) => V
): V {
  const pkgA = tree.a;
  const pkgB = tree.b;
  if (isValuePkg(pkgA) && isValuePkg(pkgB)) {
    const valueA = preprocessA(pkgA.entity);
    const valueB = preprocessB(pkgB.entity);
    return process(valueA, valueB);
  } else {
    throw new Error();
  }
}

export function isRandomValue(a: AllValues, b: AllValues): boolean {
  const symbols: Array<NonDeterministicSymbol | DeterministicSymbol> = nonDeterministicSymbols;
  return (symbols.includes(a.symbol) || symbols.includes(b.symbol));
}

export function calcAllOps(tree: OpsTree, opsCollection: OpsCollection) : AllValues {
  const dig = (tree: OpsTree): AllValues => {
    const coll = opsCollection[tree.opsId];
    if (tree.a.tag === "value" && tree.b.tag === "value") {
      return coll.process(
        coll.preprocessA(tree.a.entity),
        coll.preprocessB(tree.b.entity)
      );

    } else if (tree.a.tag === "value" && tree.b.tag === "ops") {
      const valB = dig(tree.b.entity);
      return coll.process(
        coll.preprocessA(tree.a.entity),
        coll.preprocessB(valB)
      );

    } else if (tree.a.tag === "ops" && tree.b.tag === "value") {
      const valA = dig(tree.a.entity);
      return coll.process(
        coll.preprocessA(valA),
        coll.preprocessB(tree.b.entity)
      );

    } else if (tree.a.tag === "ops" && tree.b.tag === "ops") {
      const valA = dig(tree.a.entity);
      const valB = dig(tree.b.entity);
      return coll.process(
        coll.preprocessA(valA),
        coll.preprocessB(valB)
      );

    } else {
      throw new Error();
    }
  };
  const result = dig(tree);
  return result;
}
