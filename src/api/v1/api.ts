import { type OpsTreeRef, type OpsTree, calcAllOps } from '../../state/ops';
import { type AnyValue } from '../../state/value';
import { type Knot, type CandidateIdMap, type KnotId } from '../../knot/knot';
import { type PropertyId, type PropertyState } from '../../knot/property';
import { type IFInteractionAPI } from './api.define';
import {
  metaBfArray,
  metaBfNumber,
  metaBfString,
  metaTfArray,
  metaTfNumber,
  metaTfString,
} from '../../state/preset/util/getResultType';

function nextKnotId(value: AnyValue, candidateIdMap: CandidateIdMap): KnotId {
  const knotId = candidateIdMap[value.value.toString()];
  if (knotId !== undefined) {
    return knotId;
  } else {
    return candidateIdMap.default;
  }
}

function getNextKnotId(knot: Knot, state: PropertyState): KnotId {
  const tree = initTree(knot.payload.ops.nextKnotId.treeRef, state);
  const result = calcAllOps(tree, knot.payload.ops.nextKnotId.collection);
  return nextKnotId(result, knot.to);
}

const getObjectKeys = <T extends Record<string, unknown>>(
  obj: T
): Array<keyof T> => {
  return Object.keys(obj);
};

function getNextState(knot: Knot, state: PropertyState): PropertyState {
  const propertyIds = getObjectKeys(knot.payload.ops.nextState);
  const updateState: PropertyState = {};

  for (const propertyId of propertyIds) {
    const tree = initTree(
      knot.payload.ops.nextState[propertyId].treeRef,
      state
    );
    const newValue = calcAllOps(
      tree,
      knot.payload.ops.nextState[propertyId].collection
    );
    updateState[propertyId] = {
      id: state[propertyId].id,
      name: state[propertyId].name,
      value: newValue,
    };
  }

  const nextState = { ...state, ...updateState };
  return nextState;
}

function getValue(id: PropertyId, state: PropertyState): AnyValue {
  const prop = state[id];
  if (prop === undefined) {
    throw new Error();
  } else {
    return prop.value;
  }
}

function initTree(treeRef: OpsTreeRef, state: PropertyState): OpsTree {
  const mapVal = (treeRef: OpsTreeRef): OpsTree => {
    if (treeRef.a.tag === 'prop' && treeRef.b.tag === 'prop') {
      return {
        a: {
          tag: 'value',
          entity: getValue(treeRef.a.entity, state),
        },
        b: {
          tag: 'value',
          entity: getValue(treeRef.b.entity, state),
        },
        opsId: treeRef.opsId,
      };
    } else if (treeRef.a.tag === 'prop' && treeRef.b.tag === 'ops') {
      return {
        a: {
          tag: 'value',
          entity: getValue(treeRef.a.entity, state),
        },
        b: {
          tag: 'ops',
          entity: mapVal(treeRef.b.entity),
        },
        opsId: treeRef.opsId,
      };
    } else if (treeRef.a.tag === 'ops' && treeRef.b.tag === 'prop') {
      return {
        a: {
          tag: 'ops',
          entity: mapVal(treeRef.a.entity),
        },
        b: {
          tag: 'value',
          entity: getValue(treeRef.b.entity, state),
        },
        opsId: treeRef.opsId,
      };
    } else if (treeRef.a.tag === 'ops' && treeRef.b.tag === 'ops') {
      return {
        a: {
          tag: 'ops',
          entity: mapVal(treeRef.a.entity),
        },
        b: {
          tag: 'ops',
          entity: mapVal(treeRef.b.entity),
        },
        opsId: treeRef.opsId,
      };
    } else {
      throw new Error();
    }
  };
  return mapVal(treeRef);
}

export const InteractionAPI: IFInteractionAPI = {
  knot: {
    next: async ({ knot, state }) => {
      const nextState = getNextState(knot, state);
      const nextKnotId = getNextKnotId(knot, nextState);
      return [nextKnotId, nextState];
    },
  },
  state: {
    getTransformFn: ({ symbol }) => {
      switch (symbol) {
        case 'string':
          return metaTfString(false);
        case 'number':
          return metaTfNumber(false);
        case 'boolean': // TODO
          break;
        case 'array':
          return metaTfArray(false);
        case 'random-number':
          return metaTfNumber(true);
        case 'random-string':
          return metaTfString(true);
        case 'random-boolean': // TODO
          break;
        case 'random-array':
          return metaTfArray(true);
      }
    },
    getBinaryFn: ({ symbol, elemType }) => {
      switch (symbol) {
        case 'string':
          return metaBfString(false);
        case 'number':
          return metaBfNumber(false);
        case 'boolean': // TODO
          break;
        case 'array': {
          if(elemType === null) {
            throw new Error();
          }
          return metaBfArray(false, elemType);
        }
        case 'random-number':
          return metaBfNumber(true);
        case 'random-string':
          return metaBfString(true);
        case 'random-boolean': // TODO
          break;
        case 'random-array': {
          if(elemType === null) {
            throw new Error();
          }
          return metaBfArray(true, elemType);
        }
      }
    },
  },
};
