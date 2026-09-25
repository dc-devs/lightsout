import { createFileRoute } from '@tanstack/react-router';
import { AddressNotFound } from '#src/common/components/boundaries/AddressNotFound.tsx';
import { packQueryOptions } from '#src/features/packs/queries/packQueryOptions.ts';
import { packRuleQueryOptions } from '#src/features/packs/queries/packRuleQueryOptions.ts';
import { RuleDetail } from '#src/features/packs/screens/RuleDetail/RuleDetail.tsx';

/**
 * Either half of the address was wrong — a pack nothing answers to, or a rule
 * the pack does not carry.
 *
 * Both arrive here because `getPackRuleServerFn` turns each of the engine's two
 * typed errors into the router's own not-found signal on the server, where they
 * are still instances.
 */
const RuleNotFound = () => {
	const { pack, rule } = Route.useParams();

	return (
		<AddressNotFound title="No rule at that address.">
			<span className="font-mono">{pack}</span> holds no rule named <span className="font-mono">{rule}</span>. It may have been renamed.
		</AddressNotFound>
	);
};

const RuleDetailPage = () => {
	const { pack, rule } = Route.useParams();

	return <RuleDetail packName={pack} ruleId={rule} />;
};

export const Route = createFileRoute('/_site/standards/$pack/$rule')({
	// Both queries the page suspends on, warmed before the first render: the rule
	// for its argument and its proof, the pack for the trail above it.
	loader: async ({ context, params }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(packRuleQueryOptions({ name: params.pack, rule: params.rule })),
			context.queryClient.ensureQueryData(packQueryOptions({ name: params.pack })),
		]);
	},
	// From the path alone, so the tab is named before the query resolves.
	head: ({ params }) => ({ meta: [{ title: `${params.rule} — ${params.pack}` }] }),
	component: RuleDetailPage,
	notFoundComponent: RuleNotFound,
});
