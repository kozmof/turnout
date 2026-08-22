import { cfArray, cfRecord } from "../../state-control/preset-funcs/array/combineFn.js";
import { cfBoolean } from "../../state-control/preset-funcs/boolean/combineFn.js";
import { cfGeneric } from "../../state-control/preset-funcs/generic/combineFn.js";
import { cfNumber } from "../../state-control/preset-funcs/number/combineFn.js";
import { cfString } from "../../state-control/preset-funcs/string/combineFn.js";
import { AnyValue } from "../../state-control/value.js";
import { splitPairCombineFnNames } from "../../util/splitPair.js";
import { CombineFnNames } from "../types.js";

// Runtime execution resolves combine functions dynamically, so we expose a single
// AnyValue-based contract that works across all namespaced preset implementations.
type AnyToAny = (...values: AnyValue[]) => AnyValue;

export const getCombineFn = (joinedName: CombineFnNames): AnyToAny => {
  const mayPair = splitPairCombineFnNames(joinedName);
  if (mayPair === null) {
    throw new Error("Invalid combine function name: " + joinedName);
  }
  const [namespace, fnName] = mayPair;

  switch (namespace) {
    case "combineFnArray":
      // String-keyed lookup widens the function type; namespace/function parsing
      // above ensures this cast matches the selected preset implementation.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return cfArray[fnName] as AnyToAny;
    case "combineFnRecord":
      return cfRecord[fnName] as unknown as AnyToAny;
    case "combineFnBoolean":
      // String-keyed lookup widens the function type; namespace/function parsing
      // above ensures this cast matches the selected preset implementation.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return cfBoolean[fnName] as AnyToAny;
    case "combineFnGeneric":
      // String-keyed lookup widens the function type; namespace/function parsing
      // above ensures this cast matches the selected preset implementation.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return cfGeneric[fnName] as AnyToAny;
    case "combineFnNumber":
      // String-keyed lookup widens the function type; namespace/function parsing
      // above ensures this cast matches the selected preset implementation.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return cfNumber[fnName] as AnyToAny;
    case "combineFnString":
      // String-keyed lookup widens the function type; namespace/function parsing
      // above ensures this cast matches the selected preset implementation.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return cfString[fnName] as AnyToAny;
  }
};
