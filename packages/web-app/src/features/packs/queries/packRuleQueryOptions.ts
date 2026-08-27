import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { getPackRuleServerFn } from '#src/features/packs/serverFns/getPackRuleServerFn.ts';

interface Params {
	/** The pack's own `name`, which is what the URL carries. */
	name: string;
	/** The rule id, as its folder spells it minus the numeric prefix. */
	rule: string;
}

/**
 * One rule's argument and fixture text.
 *
 * Never stale, because a rule's text changes only when someone edits the pack on
 * disk — and a row a reader opens, closes and opens again must not go back to
 * the server for a document it already has.
 */
export const packRuleQueryOptions = ({ name, rule }: Params) =>
	queryOptions({
		queryKey: [QueryKey.PackRule, name, rule],
		queryFn: () => getPackRuleServerFn({ data: { name, rule } }),
		staleTime: Number.POSITIVE_INFINITY,
	});
