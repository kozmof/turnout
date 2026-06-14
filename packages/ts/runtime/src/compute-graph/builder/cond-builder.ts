import { IdGenerator } from "../../util/idGenerator.js";
import { lookupReturnId, type Scope } from "./id-factory.js";
import type { FunctionPhaseState } from "./phase-types.js";
import type { CondBuilder } from "./types.js";

export function processCondFunc(
  funcId: string,
  builder: CondBuilder,
  state: FunctionPhaseState,
  scope: Scope,
  functionKeys: Set<string>,
): void {
  const defId = IdGenerator.generateCondDefineId();
  const returnId = lookupReturnId(funcId, state);

  state.funcTable[scope.funcId(funcId)] = {
    kind: "cond",
    defId,
    returnId,
  };

  // Use functionKeys (built in Pass 1) to discriminate condition source type.
  // Checking state.funcTable here would silently misclassify conditions that
  // reference a combine/pipe declared later in the spec (forward reference).
  const conditionId = functionKeys.has(builder.condition)
    ? { kind: "func" as const, id: scope.funcId(builder.condition) }
    : { kind: "value" as const, id: scope.valueId(builder.condition) };

  state.condFuncDefTable[defId] = {
    conditionId,
    trueBranchId: scope.funcId(builder.then),
    falseBranchId: scope.funcId(builder.else),
  };
}
