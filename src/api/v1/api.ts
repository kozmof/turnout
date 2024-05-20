import { type OpsTreeRef, type OpsTree, type OpsCollection, calcAllOps } from "../../condition/ops";
import { type KnotId } from "../../knot/knot";
import { type PropertyState } from "../../knot/property";
import { type IFInteractionAPI, type SetUp } from "./api.interface";


async function calculate(tree: OpsTree, opsCollection: OpsCollection, setup: SetUp): Promise<KnotId> {
  const result = calcAllOps(tree, opsCollection);
  if (result.symbol === "boolean" || result.symbol === "random-boolean") {
    return setup.condition(result.value);
  } else {
    throw new Error();
  }
}

function initTree(treeRef: OpsTreeRef, state: PropertyState): OpsTree {
  const mapVal = (treeRef: OpsTreeRef | OpsTree): OpsTree => {
    if (treeRef.a.tag === "prop" && treeRef.b.tag === "prop") {
      return {
        a: {
          tag: "value",
          entity: state[treeRef.a.entity].value
        },
        b: {
          tag: "value",
          entity: state[treeRef.b.entity].value
        },
        opsId: treeRef.opsId
      };
    } else if (treeRef.a.tag === "prop" && treeRef.b.tag === "ops") {
      return {
        a: {
          tag: "value",
          entity: state[treeRef.a.entity].value
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
          entity: state[treeRef.b.entity].value
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
    next: async (treeRef, opsCollection, state, setup) => {
      const tree = initTree(treeRef, state);
      const nextKnotId = await calculate(tree, opsCollection, setup);
      const [ok, nextState] = await setup.action(nextKnotId, state);
      if (ok) {
        return [nextKnotId, nextState];
      } else {
        throw new Error();
      }
    }
  }
};
