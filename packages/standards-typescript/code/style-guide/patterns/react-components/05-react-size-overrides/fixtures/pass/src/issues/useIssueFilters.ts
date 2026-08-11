// One hook, judged against the hook thresholds it earns by its name — well
// inside them, so there is nothing to split.
export const useIssueFilters = ({ issues }: { issues: string[] }) => ({
	visible: issues.filter((issue) => issue.length > 0),
	hidden: issues.filter((issue) => issue.length === 0),
	total: issues.length,
});
