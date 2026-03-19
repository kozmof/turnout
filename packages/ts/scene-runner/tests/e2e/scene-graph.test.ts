/**
 * E2E: loan_flow scene
 *
 * Pipeline: scene-graph-full.turn → scene-graph.json → runHarness → STATE assertions.
 *
 * Scene: loan_flow
 *   score → approve  (income >= 50000 AND debt <= 20000)
 *   score → reject   (fallthrough)
 */
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { runHarness } from '../../src/index.js';
import { buildNumber, isPureBoolean, isPureString } from 'turnout';

const fixture = resolve(__dirname, '../fixtures/scene-graph.json');

function state(income: number, debt: number) {
  return {
    'applicant.income': buildNumber(income),
    'applicant.debt': buildNumber(debt),
  };
}

describe('loan_flow — approve path', () => {
  it('approves when income ≥ 50000 AND debt ≤ 20000', () => {
    const { finalState } = runHarness({
      jsonFile: fixture,
      entryId: 'loan_flow',
      initialState: state(60_000, 10_000),
    });

    const approved = finalState['decision.approved'];
    expect(isPureBoolean(approved!) && approved.value).toBe(true);
  });

  it('writes merged income to decision.input_income', () => {
    const { finalState } = runHarness({
      jsonFile: fixture,
      entryId: 'loan_flow',
      initialState: state(60_000, 10_000),
    });

    const inputIncome = finalState['decision.input_income'];
    expect(inputIncome && 'value' in inputIncome && inputIncome.value).toBe(60_000);
  });

  it('sets status = "approved" and code = "APR-0001"', () => {
    const { finalState } = runHarness({
      jsonFile: fixture,
      entryId: 'loan_flow',
      initialState: state(75_000, 5_000),
    });

    const status = finalState['decision.status'];
    const code = finalState['decision.code'];
    expect(isPureString(status!) && status.value).toBe('approved');
    expect(isPureString(code!) && code.value).toBe('APR-0001');
  });
});

describe('loan_flow — reject path (low income)', () => {
  it('rejects when income < 50000', () => {
    const { finalState } = runHarness({
      jsonFile: fixture,
      entryId: 'loan_flow',
      initialState: state(30_000, 10_000),
    });

    const approved = finalState['decision.approved'];
    expect(isPureBoolean(approved!) && approved.value).toBe(false);
  });

  it('sets status = "rejected" and reason = "risk_threshold_not_met"', () => {
    const { finalState } = runHarness({
      jsonFile: fixture,
      entryId: 'loan_flow',
      initialState: state(30_000, 10_000),
    });

    const status = finalState['decision.status'];
    const reason = finalState['decision.reason'];
    expect(isPureString(status!) && status.value).toBe('rejected');
    expect(isPureString(reason!) && reason.value).toBe('risk_threshold_not_met');
  });
});

describe('loan_flow — reject path (high debt)', () => {
  it('rejects when debt > 20000', () => {
    const { finalState } = runHarness({
      jsonFile: fixture,
      entryId: 'loan_flow',
      initialState: state(60_000, 30_000),
    });

    const approved = finalState['decision.approved'];
    expect(isPureBoolean(approved!) && approved.value).toBe(false);
  });
});

describe('loan_flow — trace', () => {
  it('returns a scene trace with kind = "scene"', () => {
    const result = runHarness({
      jsonFile: fixture,
      entryId: 'loan_flow',
      initialState: state(60_000, 10_000),
    });

    expect(result.trace.kind).toBe('scene');
  });

  it('approve path trace contains score and approve actions', () => {
    const result = runHarness({
      jsonFile: fixture,
      entryId: 'loan_flow',
      initialState: state(60_000, 10_000),
    });

    if (result.trace.kind !== 'scene') throw new Error('expected scene trace');
    const ids = result.trace.scene.actions.map((a) => a.actionId);
    expect(ids).toContain('score');
    expect(ids).toContain('approve');
    expect(ids).not.toContain('reject');
  });
});
