import type { Action } from '../common/constants/Action';

// The query string is not the union yet, and the cast says it is — an unknown
// value now travels as a checked one.
export const readAction = ({ query }: { query: Record<string, string> }): Action => query.action as Action;
