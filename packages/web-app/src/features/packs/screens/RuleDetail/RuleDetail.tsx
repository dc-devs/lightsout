import { useSuspenseQuery } from '@tanstack/react-query';
import { Card, ContentHeader, Markdown } from '#src/appUI/index.ts';
import { FixtureDiff } from '#src/features/packs/components/FixtureDiff.tsx';
import { packQueryOptions } from '#src/features/packs/queries/packQueryOptions.ts';
import { packRuleQueryOptions } from '#src/features/packs/queries/packRuleQueryOptions.ts';
import { RuleHeader } from '#src/features/packs/screens/RuleDetail/components/RuleHeader.tsx';
import { RuleSettingsCard } from '#src/features/packs/screens/RuleDetail/components/RuleSettingsCard.tsx';
import { TurnItDownCard } from '#src/features/packs/screens/RuleDetail/components/TurnItDownCard.tsx';

interface Props {
	packName: string;
	ruleId: string;
}

/**
 * One rule whole: what it catches, the argument for it, the code that proves
 * it, and how to disagree.
 *
 * The check's own source is deliberately absent. What a reader needs in order
 * to agree or disagree is the argument and the proof; how the check is
 * implemented is neither.
 */
export const RuleDetail = ({ packName, ruleId }: Props) => {
	const { data: rule } = useSuspenseQuery(packRuleQueryOptions({ name: packName, rule: ruleId }));
	const { data: pack } = useSuspenseQuery(packQueryOptions({ name: packName }));

	return (
		<div className="flex flex-col gap-6 p-6">
			<ContentHeader
				crumbs={[
					{ label: 'Standards packs', link: { to: '/standards' } },
					{ label: pack.name, link: { to: '/standards/$pack', params: { pack: pack.name } } },
					{ label: rule.documentPath },
					{ label: rule.id },
				]}
			/>
			<RuleHeader rule={rule} />
			<Card title="The argument">
				{rule.prose === '' ? (
					<p className="text-muted-foreground text-sm">This rule states its summary and proves it with an example.</p>
				) : (
					<Markdown text={rule.prose} />
				)}
			</Card>
			<Card title="The proof">
				<FixtureDiff fixtures={rule.fixtures} />
			</Card>
			<RuleSettingsCard rule={rule} />
			<TurnItDownCard ruleId={rule.id} />
		</div>
	);
};
