import { type OpsTreeRef, type OpsTree, type OpsCollection, calcAllOps } from "../../condition/ops";
import { metaPArray, metaPArrayRand, metaPNumber, metaPNumberRand, metaPPArray, metaPPArrayRand, metaPPNumber, metaPPNumberRand, metaPPString, metaPPStringRand, metaPString, metaPStringRand } from "../../condition/preset/util/getResultType";
import { type AllValues } from "../../condition/value";
import { Knot, type CandidateIdMap, type KnotId } from "../../knot/knot";
import { type PropertyId, type PropertyState } from "../../knot/property";
import { type IFInteractionAPI, } from "./api.interface";

function nextKnotId(value: AllValues, candidateIdMap: CandidateIdMap): KnotId {
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

const getObjectKeys = <T extends { [key: string]: unknown }>(obj: T): (keyof T)[] => {
  return Object.keys(obj)
}

function getNextState(knot: Knot, state: PropertyState) {
  const keys = getObjectKeys(knot.payload.ops.nextState);
  const updateState: PropertyState = {}

  for (const key of keys) {
    const tree = initTree(knot.payload.ops.nextState[key].treeRef, state);
    const newValue = calcAllOps(tree, knot.payload.ops.nextState[key].collection)
    updateState[key] = {
      id: state[key].id,
      name: state[key].name,
      value: newValue
    }
  }

  const nextState = { ...state, ...updateState }
  return nextState;
}

function getValue(id: PropertyId, state: PropertyState): AllValues {
  const prop = state[id];
  if (prop === undefined) {
    throw new Error();
  } else {
    return prop.value;
  }
}

function initTree(treeRef: OpsTreeRef, state: PropertyState): OpsTree {
  const mapVal = (treeRef: OpsTreeRef): OpsTree => {
    if (treeRef.a.tag === "prop" && treeRef.b.tag === "prop") {
      return {
        a: {
          tag: "value",
          entity: getValue(treeRef.a.entity, state)
        },
        b: {
          tag: "value",
          entity: getValue(treeRef.b.entity, state)
        },
        opsId: treeRef.opsId
      };
    } else if (treeRef.a.tag === "prop" && treeRef.b.tag === "ops") {
      return {
        a: {
          tag: "value",
          entity: getValue(treeRef.a.entity, state)
        },
        b: {
          tag: "ops",
          entity: mapVal(treeRef.b.entity)
        },
        opsId: treeRef.opsId
      };
    } else if (treeRef.a.tag === "ops" && treeRef.b.tag === "prop") {
      return {
        a: {
          tag: "ops",
          entity: mapVal(treeRef.a.entity)
        },
        b: {
          tag: "value",
          entity: getValue(treeRef.b.entity, state)
        },
        opsId: treeRef.opsId
      };
    } else if (treeRef.a.tag === "ops" && treeRef.b.tag === "ops") {
      return {
        a: {
          tag: "ops",
          entity: mapVal(treeRef.a.entity)
        },
        b: {
          tag: "ops",
          entity: mapVal(treeRef.b.entity)
        },
        opsId: treeRef.opsId
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
    }
  },
  condition: {
    getAvailablePreprocess: ({ symbol }) => {
      switch (symbol) {
        case "string":
          return metaPPString;
        case "number":
          return metaPPNumber;
        case "boolean": // TODO
          return metaPPNumber;
        case "array":
          return metaPPArray;
        case "random-number":
          return metaPPNumberRand;
        case "random-string":
          return metaPPStringRand;
        case "random-boolean": // TODO
          return metaPPNumberRand;
        case "random-array":
          return metaPPArrayRand;
      }
    },
    getAvailableProcess: ({ symbol }) => {
      switch (symbol) {
        case "string":
          return metaPString;
        case "number":
          return metaPNumber;
        case "boolean": // TODO
          return metaPNumber;
        case "array":
          return metaPArray;
        case "random-number":
          return metaPNumberRand;
        case "random-string":
          return metaPStringRand;
        case "random-boolean": // TODO
          return metaPNumberRand;
        case "random-array":
          return metaPArrayRand;
      }
    },
  }
};
