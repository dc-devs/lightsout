import { createServerFn } from '@tanstack/react-start';

// A server function loose in the feature root: nothing marks the server
// boundary, and its GraphQL document has nowhere to sit beside it.
export const countIssues = createServerFn().handler(async () => 0);
