// A hook in a `.tsx` file that returns no JSX: classified as a component by its
// extension, so it is measured against component thresholds it never earned.
export const useIssueCount = ({ issues }: { issues: string[] }) => issues.length;
