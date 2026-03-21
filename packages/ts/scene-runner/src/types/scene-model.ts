// Types that mirror the JSON schema emitted by the Go converter's -format json flag.
// The canonical schema is defined in schema/turnout-model.json (repo root).
// Both this file and packages/go/converter/internal/emit/json.go must stay in
// sync with that schema.

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

export type FieldTypeStr =
  | 'number'
  | 'str'
  | 'bool'
  | 'arr<number>'
  | 'arr<str>'
  | 'arr<bool>';

export type Literal =
  | number
  | string
  | boolean
  | number[]
  | string[]
  | boolean[];

// ─────────────────────────────────────────────────────────────────────────────
// Top-level model
// ─────────────────────────────────────────────────────────────────────────────

export type TurnModel = {
  state?: StateModel;
  scenes: SceneBlock[];
  routes?: RouteModel[];
};

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

export type StateModel = {
  namespaces: NamespaceModel[];
};

export type NamespaceModel = {
  name: string;
  fields: FieldModel[];
};

export type FieldModel = {
  name: string;
  type: FieldTypeStr;
  value: Literal;
};

// ─────────────────────────────────────────────────────────────────────────────
// Scene / Action
// ─────────────────────────────────────────────────────────────────────────────

export type NextPolicy = 'first-match' | 'all-match';

export type SceneBlock = {
  id: string;
  entry_actions: string[];
  next_policy?: NextPolicy;
  actions: ActionModel[];
};

export type ActionModel = {
  id: string;
  compute?: ComputeModel;
  prepare?: PrepareEntry[];
  merge?: MergeEntry[];
  publish?: string[];
  next?: NextRuleModel[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Compute / Prog / Binding
// ─────────────────────────────────────────────────────────────────────────────

export type ComputeModel = {
  root: string;
  prog: ProgModel;
};

export type ProgModel = {
  name: string;
  bindings: BindingModel[];
};

export type BindingModel = {
  name: string;
  type: FieldTypeStr;
  value?: Literal;   // present for value bindings
  expr?: ExprModel;  // present for function bindings
};

export type ExprModel =
  | { combine: CombineExpr; pipe?: never; cond?: never }
  | { pipe: PipeExpr; combine?: never; cond?: never }
  | { cond: CondExpr; combine?: never; pipe?: never };

export type CombineExpr = {
  fn: string;
  args: ArgModel[];
};

export type PipeExpr = {
  params: PipeParam[];
  steps: PipeStep[];
};

export type PipeParam = {
  param_name: string;
  source_ident: string;
};

export type PipeStep = {
  fn: string;
  args: ArgModel[];
};

export type CondExpr = {
  condition?: ArgModel;
  then?: ArgModel;
  else?: ArgModel;
};

// ArgModel is a discriminated union; exactly one field is non-null.
export type ArgModel =
  | { ref: string; lit?: never; func_ref?: never; step_ref?: never; transform?: never }
  | { lit: Literal; ref?: never; func_ref?: never; step_ref?: never; transform?: never }
  | { func_ref: string; ref?: never; lit?: never; step_ref?: never; transform?: never }
  | { step_ref: number; ref?: never; lit?: never; func_ref?: never; transform?: never }
  | { transform: TransformArg; ref?: never; lit?: never; func_ref?: never; step_ref?: never };

export type TransformArg = {
  ref: string;
  fn: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Prepare / Merge
// ─────────────────────────────────────────────────────────────────────────────

// Action-level prepare: from_state or from_hook (from_literal not supported at action level).
export type PrepareEntry =
  | { binding: string; from_state: string; from_hook?: never }
  | { binding: string; from_hook: string; from_state?: never };

export type MergeEntry = {
  binding: string;
  to_state: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Next rules
// ─────────────────────────────────────────────────────────────────────────────

export type NextRuleModel = {
  compute?: NextComputeModel;
  prepare?: NextPrepareEntry[];
  action: string;
};

export type NextComputeModel = {
  condition: string;
  prog: ProgModel;
};

// Transition prepare: from_action, from_state, or from_literal.
export type NextPrepareEntry =
  | { binding: string; from_action: string; from_state?: never; from_literal?: never }
  | { binding: string; from_state: string; from_action?: never; from_literal?: never }
  | { binding: string; from_literal: Literal; from_action?: never; from_state?: never };

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

export type RouteModel = {
  id: string;
  match: MatchArm[];
};

export type MatchArm = {
  // Raw pattern strings from the converter.
  // "_" is fallback (no match); "scene_id.action" or "scene_id.*.action[.action...]" are path forms.
  // Multiple entries in the array are OR-joined.
  patterns: string[];
  target: string;
};
