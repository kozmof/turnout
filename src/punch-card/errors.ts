import { FuncId, ValueId, PlugDefineId, TapDefineId } from './types';
import { NodeId } from './graph-types';

export type GraphExecutionError =
  | {
      kind: 'cyclicDependency';
      cycle: NodeId[];
    }
  | {
      kind: 'missingDependency';
      missingId: NodeId;
      dependentId: NodeId;
    }
  | {
      kind: 'missingDefinition';
      missingDefId: PlugDefineId | TapDefineId;
      funcId: FuncId;
    }
  | {
      kind: 'functionExecution';
      funcId: FuncId;
      message: string;
      cause?: Error;
    }
  | {
      kind: 'emptySequence';
      funcId: FuncId;
    }
  | {
      kind: 'missingValue';
      valueId: ValueId;
    };
