import { queryOptions } from '@tanstack/react-query';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { getDefaultPackRuleServerFn } from '#src/features/packs/internal/serverFns/getDefaultPackRuleServerFn.ts';

interface Params {
	/** The rule id, as its folder spells it minus the numeric prefix. */
	rule: string;
}

/** One default-pack rule's argument and fixture text. Never stale, for the same reason the pack is not. */
export const defaultPackRuleQueryOptions = ({ rule }: Params) =>
	queryOptions({
		queryKey: [QueryKey.DefaultPackRule, rule],
		queryFn: () => getDefaultPackRuleServerFn({ data: { rule } }),
		staleTime: Number.POSITIVE_INFINITY,
	});
