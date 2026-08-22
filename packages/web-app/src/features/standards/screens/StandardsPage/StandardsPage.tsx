import { useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card } from '#src/appUI/index.ts';
import { standardsQueryOptions } from '#src/features/standards/queries/standardsQueryOptions.ts';
import { FindingList } from '#src/features/standards/screens/StandardsPage/components/FindingList.tsx';
import { FolderBreakdown } from '#src/features/standards/screens/StandardsPage/components/FolderBreakdown.tsx';
import { RefactorHistoryPanel } from '#src/features/standards/screens/StandardsPage/components/RefactorHistoryPanel.tsx';
import { RuleDrawer } from '#src/features/standards/screens/StandardsPage/components/RuleDrawer.tsx';
import { RuleList } from '#src/features/standards/screens/StandardsPage/components/RuleList.tsx';
import { StandardsHeader } from '#src/features/standards/screens/StandardsPage/components/StandardsHeader.tsx';
import { StandardsTrendChart } from '#src/features/standards/screens/StandardsPage/components/StandardsTrendChart.tsx';

/**
 * What this repo enforces, and what is currently broken.
 *
 * Everything on the page comes from one `StandardsView` the engine assembled,
 * so the tab and `lightsout standards-check` cannot disagree about a number.
 * The page holds two pieces of view state and no more: which rule the findings
 * are filtered to, and which rule's prose the drawer is showing. They are
 * separate because a reader arrives from either side — narrowing the findings
 * to a rule and reading what that rule says are different questions.
 */
export const StandardsPage = () => {
	const { data: view } = useSuspenseQuery(standardsQueryOptions());
	const [selectedRule, setSelectedRule] = useState<string | undefined>(undefined);
	const [openRule, setOpenRule] = useState<string | undefined>(undefined);
	const findings = selectedRule === undefined ? view.findings : view.findings.filter((finding) => finding.rule === selectedRule);

	return (
		<div className="flex flex-col gap-6 p-8">
			<StandardsHeader view={view} />
			<Card title="Trend" action={<span className="font-mono text-muted-foreground text-xs">{view.path}</span>}>
				<StandardsTrendChart points={view.trend} path={view.path} />
			</Card>
			<div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[22rem_1fr]">
				<Card title="Rules">
					<RuleList rules={view.rules} findingCount={view.findings.length} selected={selectedRule} onSelect={setSelectedRule} onOpenRule={setOpenRule} />
				</Card>
				<div className="flex min-w-0 flex-col gap-6">
					<Card title="Findings">
						<FindingList findings={findings} loadedRules={view.rules.map((rule) => rule.rule)} selected={selectedRule} onOpenRule={setOpenRule} />
					</Card>
					<Card title="By folder">
						<FolderBreakdown findings={findings} />
					</Card>
					<Card title="Refactor history">
						<RefactorHistoryPanel rules={view.rules} selected={selectedRule} />
					</Card>
				</div>
			</div>
			<RuleDrawer rule={view.rules.find((rule) => rule.rule === openRule)} onClose={() => setOpenRule(undefined)} />
		</div>
	);
};
