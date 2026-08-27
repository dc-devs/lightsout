import type { PlanWorkspaceView } from '@lightsout/engine';
import type { DecisionRow } from '@lightsout/engine/contracts';
import { Badge, DataTable } from '#src/appUI/index.ts';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';
import type { DataTableColumn } from '#src/common/types/DataTableColumn.ts';

/** One row of the log, with a key of its own — two decisions may honestly ask the same question in different words. */
interface LoggedDecision {
	key: string;
	decision: DecisionRow;
}

/** The columns, in the order the Decision Log itself reads: where it came from, what was asked, and what was settled. */
const columns: Array<DataTableColumn<LoggedDecision>> = [
	{ key: 'source', header: 'source', render: ({ decision }) => <Badge>{decision.source}</Badge> },
	{
		key: 'question',
		header: 'question',
		className: 'max-w-md',
		render: ({ decision }) => (
			<span className="flex flex-col gap-1">
				<span className="leading-5">{decision.question}</span>
				{/* A choice nobody confirmed is the one thing a reader of this table has to be able to spot. */}
				{decision.assumption ? <Badge variant={BadgeVariant.Advisory}>assumption</Badge> : null}
			</span>
		),
	},
	{ key: 'options', header: 'options', className: 'max-w-xs', render: ({ decision }) => <span className="leading-5">{decision.options}</span> },
	{ key: 'choice', header: 'choice', className: 'max-w-xs', render: ({ decision }) => <span className="font-medium leading-5">{decision.choice}</span> },
	{ key: 'rationale', header: 'rationale', className: 'max-w-md', render: ({ decision }) => <span className="leading-5">{decision.rationale}</span> },
];

interface Props {
	view: PlanWorkspaceView;
}

/**
 * Every decision settled before an agent ran, brainstorm first and the plan's
 * own interview after — the order they were actually made in.
 */
export const DecisionsTab = ({ view }: Props) => {
	const rows: LoggedDecision[] = [...(view.brainstormDecisions?.decisions ?? []), ...(view.decisions?.decisions ?? [])].map((decision, index) => ({
		key: `${index}:${decision.question}`,
		decision,
	}));

	return (
		<DataTable
			rows={rows}
			columns={columns}
			getRowKey={({ key }) => key}
			empty={<p className="px-4 py-6 text-muted-foreground text-sm">No decisions recorded — /brainstorm and /plan write them.</p>}
		/>
	);
};
