import { createFileRoute, notFound } from '@tanstack/react-router';
import { AddressNotFound } from '#src/common/components/boundaries/AddressNotFound.tsx';
import { defaultPackQueryOptions, defaultPackRuleQueryOptions, RuleDetail, toRuleSetChannel } from '#src/features/packs/index.ts';

/**
 * Either half of the address was wrong — a set the pack does not hold, or a
 * rule that set does not carry.
 */
const RuleNotFound = () => {
	const { ruleSet, rule } = Route.useParams();

	return (
		<AddressNotFound title="No rule at that address.">
			The <span className="font-mono">{ruleSet}</span> rules hold no rule named <span className="font-mono">{rule}</span>. It may have been renamed.
		</AddressNotFound>
	);
};

const RuleDetailPage = () => {
	const { rule } = Route.useParams();

	return <RuleDetail ruleId={rule} />;
};

export const Route = createFileRoute('/_site/standards-packs/$ruleSet/$rule')({
	// The rule must sit in the set the address names — a real rule under the
	// wrong set is a wrong address, not a page — and then it is warmed for the page.
	loader: async ({ context, params }) => {
		const channel = toRuleSetChannel({ ruleSet: params.ruleSet });
		const pack = await context.queryClient.ensureQueryData(defaultPackQueryOptions());

		if (!pack.rules.some((rule) => rule.id === params.rule && rule.channel === channel)) {
			throw notFound();
		}

		await context.queryClient.ensureQueryData(defaultPackRuleQueryOptions({ rule: params.rule }));
	},
	head: ({ params }) => ({ meta: [{ title: `${params.rule} — ${params.ruleSet} rules` }] }),
	component: RuleDetailPage,
	notFoundComponent: RuleNotFound,
});
