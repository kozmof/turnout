import { type PropertyId } from '../knot/property';
import {
  nonDeterministicSymbols,
  type AnyValue,
  type DeterministicSymbol,
  type NonDeterministicSymbol,
} from './value';

export interface ValuePkg {
  tag: 'value';
  entity: AnyValue;
}

export interface OpsPkg {
  tag: 'ops';
  entity: OpsTree;
}

export interface OpsPkgRef {
  tag: 'ops';
  entity: OpsTreeRef;
}

export interface PropertyPkg {
  tag: 'prop';
  entity: PropertyId;
}

export interface OpsTree {
  a: ValuePkg | OpsPkg;
  b: ValuePkg | OpsPkg;
  opsId: number;
}

export interface OpsTreeRef {
  a: PropertyPkg | OpsPkgRef;
  b: PropertyPkg | OpsPkgRef;
  opsId: number;
}

export type OpsCollection = {
  [opsId in string]: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transformA: (value: any) => unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transformB: (value: any) => unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process: (a: any, b: any) => unknown;
  };
};

export function isValuePkg(pkg: ValuePkg | OpsPkg): pkg is ValuePkg {
  return pkg.tag === 'value';
}

export function isOpsPkg(pkg: ValuePkg | OpsPkg): pkg is OpsPkg {
  return pkg.tag === 'ops';
}

export function isRandomValue(a: AnyValue, b: AnyValue | null): boolean {
  const symbols: Array<NonDeterministicSymbol | DeterministicSymbol> =
    nonDeterministicSymbols;
  if (b !== null) {
    return symbols.includes(a.symbol) || symbols.includes(b.symbol);
  } else {
    return symbols.includes(a.symbol);
  }
}

export function calcAllOps(
  tree: OpsTree,
  opsCollection: OpsCollection
): AnyValue {
  const dig = (tree: OpsTree): unknown => {
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
      return coll.process(coll.transformA(valA), coll.transformB(valB));
    } else {
      throw new Error();
    }
  };
  const result = dig(tree);
  return result as AnyValue;
}
