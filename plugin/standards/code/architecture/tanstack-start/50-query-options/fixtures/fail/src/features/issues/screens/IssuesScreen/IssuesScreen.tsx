import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { findAllIssuesServerFn } from '../../serverFns/findAllIssues';

// The query is declared inline in the screen, so the next caller that needs the
// same data writes its own key and the cache quietly splits in two.
export const IssuesScreen = ({ search }: { search: string }) => {
	const { data } = useSuspenseQuery(
		queryOptions({ queryKey: ['issues', search], queryFn: () => findAllIssuesServerFn({ data: { search } }) }),
	);

	return <ul>{data.map((issue: string) => <li key={issue}>{issue}</li>)}</ul>;
};
