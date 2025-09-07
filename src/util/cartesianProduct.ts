export const cartesianProduct = <T, U, V>(
  ...arrays: [T[], U[], V[]]
): [T, U, V][] => {
  return arrays[0].flatMap((t) =>
    arrays[1].flatMap((u) => arrays[2].map((v) => [t, u, v] as [T, U, V]))
  );
};
