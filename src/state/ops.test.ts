import { expect, test, describe } from 'vitest';
import { type OpsTree, type OpsCollection, calcAllOps } from './ops';
import { tfNumber } from './preset/number/transformFn';
import { bfNumber } from './preset/number/binaryFn';

// Note: [NML]️ is a normal test. [NEG]️ is a negative test

describe('[core function] calcAnyValue', () => {
  describe('::basic test', () => {
    test('Simple calculations [NML]️', () => {
      const opsCollection: OpsCollection = {
        1: {
          transformA: tfNumber.pass,
          transformB: tfNumber.pass,
          process: bfNumber.add
        },
        2: {
          transformA: tfNumber.pass,
          transformB: tfNumber.pass,
          process: bfNumber.multiply
        },
        3: {
          transformA: tfNumber.pass,
          transformB: tfNumber.pass,
          process: bfNumber.multiply
        },
        4: {
          transformA: tfNumber.pass,
          transformB: tfNumber.pass,
          process: bfNumber.add
        },
        5: {
          transformA: tfNumber.pass,
          transformB: tfNumber.pass,
          process: bfNumber.add
        },
        6: {
          transformA: tfNumber.pass,
          transformB: tfNumber.pass,
          process: bfNumber.minus
        },
        7: {
          transformA: tfNumber.pass,
          transformB: tfNumber.pass,
          process: bfNumber.minus
        },
        8: {
          transformA: tfNumber.pass,
          transformB: tfNumber.pass,
          process: bfNumber.minus
        },
        9: {
          transformA: tfNumber.pass,
          transformB: tfNumber.pass,
          process: bfNumber.add
        },
        10: {
          transformA: tfNumber.pass,
          transformB: tfNumber.pass,
          process: bfNumber.add
        },
        11: {
          transformA: tfNumber.pass,
          transformB: tfNumber.pass,
          process: bfNumber.divide
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
