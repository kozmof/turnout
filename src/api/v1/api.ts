import { type OpsTreeRef, type OpsTree, type OpsCollection, calcAllOps } from "../../condition/ops";
import { metaPArray, metaPArrayRand, metaPNumber, metaPNumberRand, metaPPArray, metaPPArrayRand, metaPPNumber, metaPPNumberRand, metaPPString, metaPPStringRand, metaPString, metaPStringRand } from "../../condition/preset/util/getResultType";
import { type AllValues } from "../../condition/value";
import { type KnotId } from "../../knot/knot";
import { type PropertyId, type PropertyState } from "../../knot/property";
import { type IFInteractionAPI, type Setup } from "./api.interface";


async function calculate(tree: OpsTree, opsCollection: OpsCollection, setup: Setup, candidateIds: KnotId[]): Promise<KnotId> {
  const result = calcAllOps(tree, opsCollection);
  if (result.symbol === "boolean" || result.symbol === "random-boolean") {
    return setup.nextKnotId(result.value, candidateIds);
  } else {
    throw new Error();
  }
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
  const mapVal = (treeRef: OpsTreeRef | OpsTree): OpsTree => {
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
    next: async ({ knot, state, setup }) => {
      if (knot.payload.ops !== null) {
        const tree = initTree(knot.payload.ops.treeRef, state);
        const nextKnotId = await calculate(tree, knot.payload.ops.collection, setup, knot.to);
        const [ok, nextState] = await setup.action(nextKnotId, state);
        if (ok) {
          return [nextKnotId, nextState];
        } else {
          throw new Error();
        }
      } else {
        throw new Error();
      }
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
    getAvailableProcess: ({symbol}) => {
      switch(symbol) {
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
