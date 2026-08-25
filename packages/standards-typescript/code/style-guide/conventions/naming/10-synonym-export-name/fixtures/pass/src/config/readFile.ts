// A lone name may use any verb: nothing else in the repo names this concept,
// so there is no pair and nothing to report.
export const readFile = ({ path }: { path: string }): string => `contents of ${path}`;
