import type { LinearClient } from '@linear/sdk';

/**
 * One clause of an issue-label filter's `or` array, derived from the client
 * method that consumes it.
 *
 * `@linear/sdk` v92 declares `IssueLabelFilter` internally but does not export
 * it from its entry point — importing that name by hand fails to compile with
 * TS2305. Deriving the type from `issueLabels`' own parameter keeps this file
 * honest against whatever the installed SDK actually accepts, and needs no
 * hand-written shadow interface that could drift from it.
 */
type LabelFilterClause = NonNullable<NonNullable<NonNullable<Parameters<LinearClient['issueLabels']>[0]>['filter']>['or']>[number];

interface Params {
	/** The team key, e.g. 'LO'. */
	team: string;
}

/**
 * The `or` clause naming every label the named team may put on an issue.
 *
 * A workspace-level label has no team, so a filter that asks only for
 * `team.key = 'LO'` never sees it — and a caller checking whether a configured
 * label exists would report a working label as missing. The SDK's nullable team
 * filter carries a `null` comparator for exactly this case.
 */
export const buildLabelScopeFilter = ({ team }: Params): LabelFilterClause[] => [{ team: { key: { eq: team } } }, { team: { null: true } }];
