import { useSuspenseQuery } from '@tanstack/react-query';
import { CheckKind } from '#src/common/constants/CheckKind.ts';
import { toCheckKind } from '#src/common/utils/toCheckKind.ts';
import type { PackRuleFilters } from '#src/features/packs/common/types/PackRuleFilters.ts';
import { filterPackRules } from '#src/features/packs/common/utils/filterPackRules.ts';
import { groupRulesByDocument } from '#src/features/packs/common/utils/groupRulesByDocument.ts';
import { readDocumentTitle } from '#src/features/packs/common/utils/readDocumentTitle.ts';
import { toRuleSetChannel } from '#src/features/packs/common/utils/toRuleSetChannel.ts';
import { defaultPackQueryOptions } from '#src/features/packs/queries/defaultPackQueryOptions.ts';
import { CodeSpans } from '#src/features/packs/screens/RuleSetPage/components/CodeSpans.tsx';
import { RuleFilters } from '#src/features/packs/screens/RuleSetPage/components/RuleFilters.tsx';
import { RuleGroupNav } from '#src/features/packs/screens/RuleSetPage/components/RuleGroupNav.tsx';
import { RuleRow } from '#src/features/packs/screens/RuleSetPage/components/RuleRow.tsx';
import { RuleSetHeader } from '#src/features/packs/screens/RuleSetPage/components/RuleSetHeader.tsx';

interface Props {
	/** The address word — `typescript`, `react` or `tanstack`. */
	ruleSet: string;
	filters: PackRuleFilters;
	onFiltersChange: (filters: PackRuleFilters) => void;
}

/**
 * One set of the default pack's rules whole — every TypeScript rule, say —
 * grouped under the document that states each one, with a list of those
 * documents beside them.
 *
 * The counts in the header are the whole set's; the search and the kind-of-check
 * switch narrow only the list under them.
 */
export const RuleSetPage = ({ ruleSet, filters, onFiltersChange }: Props) => {
	const channel = toRuleSetChannel({ ruleSet });
	const { data: pack } = useSuspenseQuery(defaultPackQueryOptions());
	const rules = pack.rules.filter((rule) => rule.channel === channel);
	const shown = filterPackRules({ rules, filters });
	const groups = groupRulesByDocument({ documents: pack.documents.filter((document) => document.channel === channel), rules: shown }).map((group) => ({
		...group,
		id: group.document.path.replaceAll('/', '-'),
	}));
	const deterministic = rules.filter((rule) => toCheckKind({ checked: rule.checked }) === CheckKind.Deterministic).length;

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-16">
			<RuleSetHeader
				channel={channel}
				totals={{ rules: rules.length, [CheckKind.Deterministic]: deterministic, [CheckKind.Agent]: rules.length - deterministic }}
			/>
			<div className="grid grid-cols-1 gap-10 lg:grid-cols-[14rem_1fr]">
				<aside className="hidden lg:block">
					<div className="sticky top-24">
						<RuleGroupNav groups={groups.map((group) => ({ id: group.id, document: group.document, count: group.rules.length }))} />
					</div>
				</aside>
				<div className="flex min-w-0 flex-col gap-8">
					<RuleFilters filters={filters} onFiltersChange={onFiltersChange} />
					{groups.length === 0 ? (
						<p className="rounded-2xl border border-border border-dashed px-6 py-12 text-center text-muted-foreground text-sm">No rule matches that.</p>
					) : (
						groups.map((group) => (
							<section key={group.id} id={group.id} aria-labelledby={`${group.id}-title`} className="flex scroll-mt-24 flex-col gap-3">
								<h2 id={`${group.id}-title`} className="flex items-baseline gap-2 font-bold text-drop-navy text-lg">
									<span>
										<CodeSpans text={readDocumentTitle({ intro: group.document.intro, path: group.document.path })} />
									</span>
									<span className="font-medium text-subtle-foreground text-sm">{group.rules.length}</span>
								</h2>
								<ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
									{group.rules.map((rule) => (
										<RuleRow key={rule.id} rule={rule} ruleSet={ruleSet} />
									))}
								</ul>
							</section>
						))
					)}
				</div>
			</div>
		</div>
	);
};
