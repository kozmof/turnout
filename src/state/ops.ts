import { type PropertyId } from '../knot/property';
import { nonDeterministicSymbols, type AnyValue, type DeterministicSymbol, type NonDeterministicSymbol } from './value';

export interface ValuePkg {
  tag: 'value'
  entity: AnyValue
}

export interface OpsPkg {
  tag: 'ops'
  entity: OpsTree
}

export interface OpsPkgRef {
  tag: 'ops'
  entity: OpsTreeRef
}

export interface PropertyPkg {
  tag: 'prop'
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
  [opsId in string]: {
    transformA: (value: AnyValue) => AnyValue,
    transformB: (value: AnyValue) => AnyValue,
    process: (a: AnyValue, b: AnyValue) => AnyValue
  }
}

export function isValuePkg(pkg: ValuePkg | OpsPkg): pkg is ValuePkg {
  return pkg.tag === 'value';
}

export function isOpsPkg(pkg: ValuePkg | OpsPkg): pkg is OpsPkg {
  return pkg.tag === 'ops';
}

export function calcValues<T extends AnyValue, U extends AnyValue, V extends AnyValue>(
  tree: OpsTree,
  transformA: (value: AnyValue) => T,
  transformB: (value: AnyValue) => U,
  process: (a: T, b: U) => V
): V {
  const pkgA = tree.a;
  const pkgB = tree.b;
  if (isValuePkg(pkgA) && isValuePkg(pkgB)) {
    const valueA = transformA(pkgA.entity);
    const valueB = transformB(pkgB.entity);
    return process(valueA, valueB);
  } else {
    throw new Error();
  }
}

export function isRandomValue(a: AnyValue, b: AnyValue): boolean {
  const symbols: Array<NonDeterministicSymbol | DeterministicSymbol> = nonDeterministicSymbols;
  return (symbols.includes(a.symbol) || symbols.includes(b.symbol));
}

export function calcAllOps(tree: OpsTree, opsCollection: OpsCollection) : AnyValue {
  const dig = (tree: OpsTree): AnyValue => {
    const coll = opsCollection[tree.opsId];
    if (isValuePkg(tree.a) && isValuePkg(tree.b)) {
      return coll.process(
        coll.transformA(tree.a.entity),
        coll.transformB(tree.b.entity)
      );

    } else if (isValuePkg(tree.a) && isOpsPkg(tree.b)) {
      const valB = dig(tree.b.entity);
      return coll.process(
        coll.transformA(tree.a.entity),
        coll.transformB(valB)
      );

    } else if (isOpsPkg(tree.a) && isValuePkg(tree.b)) {
      const valA = dig(tree.a.entity);
      return coll.process(
        coll.transformA(valA),
        coll.transformB(tree.b.entity)
      );

    } else if (isOpsPkg(tree.a) && isOpsPkg(tree.b)) {
      const valA = dig(tree.a.entity);
      const valB = dig(tree.b.entity);
      return coll.process(
        coll.transformA(valA),
        coll.transformB(valB)
      );

    } else {
      throw new Error();
    }
  };
  const result = dig(tree);
  return result;
}
