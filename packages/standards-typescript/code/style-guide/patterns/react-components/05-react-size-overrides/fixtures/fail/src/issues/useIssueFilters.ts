import { useIssueFiltersRest } from './useIssueFiltersRest';

// Cut in two because the base 50-line utility threshold was applied to a hook.
// The overrides exist precisely so a hook of this length stays one hook.
export const useIssueFilters = ({ issues }: { issues: string[] }) => ({
	visible: issues.filter((issue) => issue.length > 0),
	...useIssueFiltersRest({ issues }),
});
