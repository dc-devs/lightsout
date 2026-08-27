import { useSuspenseQuery } from '@tanstack/react-query';
import { Button, ContentHeader } from '#src/appUI/index.ts';
import type { PackRuleFilters } from '#src/features/packs/common/types/PackRuleFilters.ts';
import { filterPackRules } from '#src/features/packs/common/utils/filterPackRules.ts';
import { packQueryOptions } from '#src/features/packs/queries/packQueryOptions.ts';
import { CapsStrip } from '#src/features/packs/screens/PackDetail/components/CapsStrip.tsx';
import { PackFilterBar } from '#src/features/packs/screens/PackDetail/components/PackFilterBar.tsx';
import { PackHeader } from '#src/features/packs/screens/PackDetail/components/PackHeader.tsx';
import { RulesByDocument } from '#src/features/packs/screens/PackDetail/components/RulesByDocument.tsx';
import { ShowcaseStrip } from '#src/features/packs/screens/PackDetail/components/ShowcaseStrip.tsx';

interface Props {
	/** The pack's own `name`, which is what the URL carries. */
	name: string;
	filters: PackRuleFilters;
	onFiltersChange: (filters: PackRuleFilters) => void;
}

/**
 * One standards pack, whole: what it is, the code it argues about, the numbers
 * it enforces, and every rule it holds.
 *
 * The filters live in the URL and arrive as props, so this screen names no
 * route and a link can say "show me only what code enforces". Only the rule
 * list and the bar's live count see the filtered rules — the showcase and the
 * caps introduce the pack rather than the current selection, and options
 * computed from a filtered list would delete the toggle just pressed.
 */
export const PackDetail = ({ name, filters, onFiltersChange }: Props) => {
	const { data: pack } = useSuspenseQuery(packQueryOptions({ name }));
	const matches = filterPackRules({ rules: pack.rules, filters });

	return (
		<div className="flex flex-col gap-6 p-6">
			<ContentHeader crumbs={[{ label: 'Standards packs', link: { to: '/standards' } }, { label: pack.name }]} />
			<PackHeader pack={pack} />
			<ShowcaseStrip packName={pack.name} rules={pack.rules} />
			<CapsStrip rules={pack.rules} packName={pack.name} />
			<PackFilterBar rules={pack.rules} filters={filters} onChange={onFiltersChange} matchCount={matches.length} />
			{matches.length === 0 ? (
				<div className="flex flex-col items-start gap-2">
					<p className="text-muted-foreground text-sm">No rules match these filters.</p>
					<Button type="button" variant="outline" size="sm" onClick={() => onFiltersChange({})}>
						Clear filters
					</Button>
				</div>
			) : (
				<RulesByDocument documents={pack.documents} rules={matches} packName={pack.name} />
			)}
		</div>
	);
};
