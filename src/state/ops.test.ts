import { expect, test, describe } from 'vitest';
import { type ControlledBooleanValue, type ControlledNumberValue } from './value';
import { type OpsTree, calcValues, type OpsCollection, calcAllOps } from './ops';
import { pGeneric } from './preset/generic/process';
import { tNumber } from './preset/number/transform';
import { pNumber } from './preset/number/process';

// Note: [NML]️ is a normal test. [NEG]️ is a negative test

describe('[core function] calcValues', () => {
  describe('::basic test', () => {
    describe('::string operations', () => {
      test('Convert two number values to string values, then compare both ️[NML]️', () => {
        const val1: ControlledNumberValue = {
          symbol: 'number',
          value: 100,
          subSymbol: undefined
        };
        const val2: ControlledNumberValue = {
          symbol: 'number',
          value: 100,
          subSymbol: undefined
        };

        const tree: OpsTree = {
          a: { tag: 'value', entity: val1 },
          b: { tag: 'value', entity: val2 },
          opsId: 111,
        };

        const expected: ControlledBooleanValue = {
          symbol: 'boolean',
          value: true,
          subSymbol: undefined
        };
        expect(calcValues(tree, tNumber.toStr, tNumber.toStr, pGeneric.isEqual)).toEqual(expected);
      });
    });
  });
});

describe('[core function] calcAllValue', () => {
  describe('::basic test', () => {
    test('Simple calculations [NML]️', () => {
      const opsCollection: OpsCollection = {
        1: {
          transformA: tNumber.pass,
          transformB: tNumber.pass,
          process: pNumber.add
        },
        2: {
          transformA: tNumber.pass,
          transformB: tNumber.pass,
          process: pNumber.multiply
        },
        3: {
          transformA: tNumber.pass,
          transformB: tNumber.pass,
          process: pNumber.multiply
        },
        4: {
          transformA: tNumber.pass,
          transformB: tNumber.pass,
          process: pNumber.add
        },
        5: {
          transformA: tNumber.pass,
          transformB: tNumber.pass,
          process: pNumber.add
        },
        6: {
          transformA: tNumber.pass,
          transformB: tNumber.pass,
          process: pNumber.minus
        },
        7: {
          transformA: tNumber.pass,
          transformB: tNumber.pass,
          process: pNumber.minus
        },
        8: {
          transformA: tNumber.pass,
          transformB: tNumber.pass,
          process: pNumber.minus
        },
        9: {
          transformA: tNumber.pass,
          transformB: tNumber.pass,
          process: pNumber.add
        },
        10: {
          transformA: tNumber.pass,
          transformB: tNumber.pass,
          process: pNumber.add
        },
        11: {
          transformA: tNumber.pass,
          transformB: tNumber.pass,
          process: pNumber.divide
        }
      };
      const tree: OpsTree = {
        a: {
          tag: 'ops',
          entity: {
            a: {
              tag: 'ops',
              entity: {
                a: {
                  tag: 'ops',
                  entity: {
                    a: {
                      tag: 'value',
                      entity: {
                        symbol: 'number',
                        value: 100,
                        subSymbol: undefined
                      }
                    },
                    b: {
                      tag: 'value',
                      entity: {
                        symbol: 'number',
                        value: 200,
                        subSymbol: undefined
                      },
                    },
                    opsId: 1
                  }
                },
                b: {
                  tag: 'value',
                  entity: {
                    symbol: 'number',
                    value: 300,
                    subSymbol: undefined
                  },
                },
                opsId: 2
              },
            },
            b: {
              tag: 'ops',
              entity: {
                a: {
                  tag: 'ops',
                  entity: {
                    a: {
                      tag: 'value',
                      entity: {
                        symbol: 'number',
                        value: 400,
                        subSymbol: undefined
                      }
                    },
                    b: {
                      tag: 'value',
                      entity: {
                        symbol: 'number',
                        value: 500,
                        subSymbol: undefined
                      }
                    },
                    opsId: 3
                  },
                },
                b: {
                  tag: 'ops',
                  entity: {
                    a: {
                      tag: 'ops',
                      entity: {
                        a: {
                          tag: 'ops',
                          entity: {
                            a: {
                              tag: 'value',
                              entity: {
                                symbol: 'number',
                                value: 400,
                                subSymbol: undefined
                              }
                            },
                            b: {
                              tag: 'value',
                              entity: {
                                symbol: 'number',
                                value: 500,
                                subSymbol: undefined
                              }
                            },
                            opsId: 4
                          }
                        },
                        b: {
                          tag: 'ops',
                          entity: {
                            a: {
                              tag: 'value',
                              entity: {
                                symbol: 'number',
                                value: 500,
                                subSymbol: undefined
                              }
                            },
                            b: {
                              tag: 'value',
                              entity: {
                                symbol: 'number',
                                value: 600,
                                subSymbol: undefined
                              }
                            },
                            opsId: 5
                          }
                        },
                        opsId: 6
                      }
                    },
                    b: {
                      tag: 'ops',
                      entity: {
                        a: {
                          tag: 'value',
                          entity: {
                            symbol: 'number',
                            value: 700,
                            subSymbol: undefined
                          }
                        },
                        b: {
                          tag: 'value',
                          entity: {
                            symbol: 'number',
                            value: 800,
                            subSymbol: undefined
                          }
                        },
                        opsId: 7
                      }
                    },
                    opsId: 8
                  },
                },
                opsId: 9
              },
            },
            opsId: 10
          },
        },
        b: {
          tag: 'value',
          entity: {
            symbol: 'number',
            value: 100,
            subSymbol: undefined
          }
        },
        opsId: 11
      };
      expect(calcAllOps(tree, opsCollection).value).toEqual(
        (((100 + 200) * 300) + ((400 * 500) + (((400 + 500) - (500 + 600)) - (700 - 800)))) / 100
      );
    });
  });
});
