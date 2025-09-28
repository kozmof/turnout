import { type OpsTreeRef, type OpsTree, calcAllOps } from '../../state-control/ops';
import { type AnyValue } from '../../state-control/value';
import { type Knot, type CandidateIdMap, type KnotId } from '../../knot/knot';
import { type PropertyId, type PropertyState } from '../../knot/property';
import { type IFInteractionAPI } from './api.define';
import { getBinaryFn } from '../../state-control/meta-chain/binary-fn/getBinaryFn';
import { getTransformFn } from '../../state-control/meta-chain/transform-fn/getTransformFn';

function nextKnotId(value: AnyValue, candidateIdMap: CandidateIdMap): KnotId {
  const rawValue = value.value;
  const knotId = candidateIdMap[rawValue.toString()];
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
): (keyof T)[] => {
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

function getValue(id: PropertyId, state: Partial<PropertyState>): AnyValue {
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
    next: ({ knot, state }) => {
      const nextState = getNextState(knot, state);
      const nextKnotId = getNextKnotId(knot, nextState);
      return [nextKnotId, nextState];
    },
  },
  state: {
    getTransformFn,
    getBinaryFn,
  },
};
