import { AnyValue } from '../state-control/value';
import { runPlugFunc } from './runPlugFunc';
import { TapFunc } from './types';

// TODO: Add a result effects func
export const runTapFunc = (tapFunc: TapFunc): AnyValue => {
  const steps = tapFunc.steps;
  const results: AnyValue[] = [];
  for (const step of steps) {
    const funcType = step.type;
    if (funcType === 'plug') {
      results.push(runPlugFunc(step));
    } else {
      results.push(runTapFunc(step));
    }
  }
  return results[results.length - 1];
};
