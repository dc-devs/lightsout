import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { Card } from '#src/appUI/index.ts';
import { standardsQueryOptions } from '#src/features/standards/queries/standardsQueryOptions.ts';
import { FindingList } from '#src/features/standards/screens/StandardsPage/components/FindingList.tsx';
import { FolderBreakdown } from '#src/features/standards/screens/StandardsPage/components/FolderBreakdown.tsx';
import { StandardsHeader } from '#src/features/standards/screens/StandardsPage/components/StandardsHeader.tsx';
import { StandardsTrendChart } from '#src/features/standards/screens/StandardsPage/components/StandardsTrendChart.tsx';

/**
 * What this repo is breaking, and where.
 *
 * Everything on the page comes from one `StandardsView` the engine assembled, so
 * the page and `lightsout standards-check` cannot disagree about a number.
 *
 * Two facets narrow one table: which rule, and which folder. The rule filter
 * lives in the URL so a narrowed page is a link somebody can send — and so
 * `?rule=<id>` from the health page and the rule pages lands on the right rows.
 * The folder facet and its depth stay in component state: they describe how this
 * reader is looking rather than what they are looking at.
 *
 * What a rule SAYS is not here any more. That lives on `/standards/$pack/$rule`,
 * which renders the prose, the fixtures and this repo's own history of the rule,
 * and the severity ledger lives on `/repo/config`, whose rows carry the pack a
 * link to a rule page needs.
 */
export const StandardsPage = () => {
	const { data: view } = useSuspenseQuery(standardsQueryOptions());
	const search = useSearch({ from: '/repo/standards' });
	const navigate = useNavigate({ from: '/repo/standards' });
	// Opens at a folder inside one package's src, which is where a repo's debt usually gathers.
	const [depth, setDepth] = useState(4);
	const [folderFilter, setFolderFilter] = useState<string | undefined>(undefined);
	const ruleFilter = search.rule;
	const findings = ruleFilter === undefined ? view.findings : view.findings.filter((finding) => finding.rule === ruleFilter);

	return (
		<div className="flex flex-col gap-6 p-6">
			<StandardsHeader view={view} />
			<Card title="Trend">
				<StandardsTrendChart points={view.trend} path={view.path} />
			</Card>
			<div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[20rem_1fr]">
				<FolderBreakdown findings={findings} depth={depth} onDepthChange={setDepth} folderFilter={folderFilter} onFolderFilterChange={setFolderFilter} />
				<FindingList
					findings={findings}
					loadedRules={view.rules.map((rule) => rule.rule)}
					ruleFilter={ruleFilter}
					onRuleFilterChange={(rule) => void navigate({ search: { rule }, replace: true })}
					folderFilter={folderFilter}
					depth={depth}
				/>
			</div>
		</div>
	);
};
