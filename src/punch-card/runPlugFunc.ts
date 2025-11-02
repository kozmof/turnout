import { AnyValue } from '../state-control/value';
import { getBinaryFn } from './getBinaryFn';
import { getTransformFn } from './getTranformFn';
import { PlugFunc } from './types';

export const runPlugFunc = (plugFunc: PlugFunc): AnyValue => {
  const transformFnNameA = plugFunc.transformFn.a.name;
  const transformFnA = getTransformFn(transformFnNameA);

  const transformFnNameB = plugFunc.transformFn.b.name;
  const transformFnB = getTransformFn(transformFnNameB);

  const binaryFnName = plugFunc.name;
  const binaryFn = getBinaryFn(binaryFnName);

  if (plugFunc.args.a.type === 'plug' && plugFunc.args.b.type === 'plug') {
    const valA = transformFnA(runPlugFunc(plugFunc.args.a));
    const valB = transformFnB(runPlugFunc(plugFunc.args.b));
    return binaryFn(valA, valB);
  } else if (
    plugFunc.args.a.type === 'plug' &&
    plugFunc.args.b.type !== 'plug'
  ) {
    const valA = transformFnA(runPlugFunc(plugFunc.args.a));
    const valB = transformFnB(plugFunc.args.b.value);
    return binaryFn(valA, valB);
  } else if (
    plugFunc.args.a.type !== 'plug' &&
    plugFunc.args.b.type === 'plug'
  ) {
    const valA = transformFnA(plugFunc.args.a.value);
    const valB = transformFnB(runPlugFunc(plugFunc.args.b));
    return binaryFn(valA, valB);
  } else if (
    plugFunc.args.a.type !== 'plug' &&
    plugFunc.args.b.type !== 'plug'
  ) {
    const valA = transformFnA(plugFunc.args.a.value);
    const valB = transformFnB(plugFunc.args.b.value);
    return binaryFn(valA, valB);
  }

  throw new Error();
};
