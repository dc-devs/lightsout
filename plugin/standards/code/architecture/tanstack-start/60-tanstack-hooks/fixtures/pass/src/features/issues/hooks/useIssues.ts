import { useSuspenseQuery } from '@tanstack/react-query';
import { issuesQueryOptions } from '../queries/issuesQueryOptions';

interface Params {
	search: string;
}

// Feature-level `hooks/`, wrapping the query options rather than restating
// them, and inferring its return type — TanStack's generics are the contract.
export const useIssues = ({ search }: Params) => useSuspenseQuery(issuesQueryOptions({ search }));
