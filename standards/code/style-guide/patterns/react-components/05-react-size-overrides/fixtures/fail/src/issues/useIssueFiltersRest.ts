// The other half of a hook that was never too long — a second hook exists only
// because the wrong threshold was used to judge the first.
export const useIssueFiltersRest = ({ issues }: { issues: string[] }) => ({
	hidden: issues.filter((issue) => issue.length === 0),
	total: issues.length,
});
