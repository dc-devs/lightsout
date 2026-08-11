import { useSuspenseQuery } from '@tanstack/react-query';
import { issuesQueryOptions } from '../../queries/issuesQueryOptions';

// A feature-level hook parked inside one screen's folder: the next screen that
// needs it either deep-imports across the boundary or writes a second copy.
export const useIssues = ({ search }: { search: string }) => useSuspenseQuery(issuesQueryOptions({ search }));
