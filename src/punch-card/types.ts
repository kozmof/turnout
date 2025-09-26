import { AnyValue } from '../state/value';

export type EchoFunc = {
  name: string;
  transform: {
    a: { name: string };
    b: { name: string };
  };
  args: {
    a: { name: string; type: AnyValue } | EchoFunc;
    b: { name: string; type: AnyValue } | EchoFunc;
  };
  return: { name: string | null; type: AnyValue };
};

export type SinkFunc = {
  name: string;
  steps: (SinkFunc | EchoFunc)[];
  args: { name: string; type: AnyValue }[];
  return: { name: string | null; type: AnyValue };
};
