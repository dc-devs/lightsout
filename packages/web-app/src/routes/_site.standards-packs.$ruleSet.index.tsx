import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { AddressNotFound } from '#src/common/components/boundaries/AddressNotFound.tsx';
import { CheckKind } from '#src/common/constants/CheckKind.ts';
import { defaultPackQueryOptions, RuleSetPage, toRuleSetChannel } from '#src/features/packs/index.ts';

/** What the query string may say. Every key optional, because an absent key is how the URL spells "do not narrow on this". */
interface RuleSetSearch {
	check?: CheckKind;
	text?: string;
}

/** Keeps a query value the vocabulary knows and drops the rest, so a stray value narrows nothing rather than everything. */
const validateSearch = (search: Record<string, unknown>): RuleSetSearch => ({
	check: Object.values(CheckKind).find((kind) => kind === search.check),
	text: typeof search.text === 'string' && search.text !== '' ? search.text : undefined,
});

/** The default pack holds no rule in the set the path names. */
const RuleSetNotFound = () => {
	const { ruleSet } = Route.useParams();

	return (
		<AddressNotFound title="No rules by that name.">
			The default pack holds no <span className="font-mono">{ruleSet}</span> rules. Pick a set from the Standards Packs page.
		</AddressNotFound>
	);
};

/**
 * The route's half of the filter contract: it owns the URL, the page owns the
 * filtering, and both speak the same two words for a kind of check. Every change navigates with `replace: true`, so the back button
 * leaves the page rather than unwinding one keystroke at a time.
 */
const RuleSetRoutePage = () => {
	const { ruleSet } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	return (
		<RuleSetPage
			ruleSet={ruleSet}
			filters={{ check: search.check, text: search.text }}
			onFiltersChange={(filters) => {
				void navigate({ search: { check: filters.check, text: filters.text }, replace: true });
			}}
		/>
	);
};

export const Route = createFileRoute('/_site/standards-packs/$ruleSet/')({
	validateSearch,
	// The pack, warmed before the first render so the page is server-rendered
	// whole. A set the pack holds no rules in is a missing address, not an empty
	// page.
	loader: async ({ context, params }) => {
		const channel = toRuleSetChannel({ ruleSet: params.ruleSet });
		const pack = await context.queryClient.ensureQueryData(defaultPackQueryOptions());

		if (!pack.channelTotals.some((total) => total.channel === channel)) {
			throw notFound();
		}
	},
	head: ({ params }) => ({ meta: [{ title: `${params.ruleSet} rules — Standards Packs` }] }),
	component: RuleSetRoutePage,
	notFoundComponent: RuleSetNotFound,
});
