import type { ConfigView } from '@lightsout/engine';
import { StandardsSeverity } from '@lightsout/engine/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, DataTable, EmptyState, FilterDropdown, MetadataTag } from '#src/appUI/index.ts';
import { ruleStateBadgeVariants } from '#src/common/constants/ruleStateBadgeVariants.ts';
import type { DataTableColumn } from '#src/common/types/DataTableColumn.ts';

/** One row of the ledger — a loaded rule and the state this repo runs it at. */
type RuleState = ConfigView['ruleStates'][number];

/** The rule id, as the way into what the rule actually says. */
const RuleLink = ({ state }: { state: RuleState }) => (
	<Link to="/standards/$pack/$rule" params={{ pack: state.pack, rule: state.rule }} className="font-mono text-sm hover:underline hover:underline-offset-2">
		{state.rule}
	</Link>
);

/** How this repo tuned one rule's numbers, or nothing at all when it left them as the pack wrote them. */
const RuleSettings = ({ state }: { state: RuleState }) => {
	const entries = Object.entries(state.settings);

	return entries.length === 0 ? (
		<span className="text-muted-foreground">—</span>
	) : (
		<span className="flex flex-wrap gap-1">
			{entries.map(([name, value]) => (
				<MetadataTag key={name}>
					{name} {value}
				</MetadataTag>
			))}
		</span>
	);
};

const columns: Array<DataTableColumn<RuleState>> = [
	{ key: 'rule', header: 'rule', sortValue: (state) => state.rule, render: (state) => <RuleLink state={state} /> },
	{
		key: 'severity',
		header: 'severity here',
		sortValue: (state) => state.severity,
		render: (state) => <Badge variant={ruleStateBadgeVariants[state.severity]}>{state.severity}</Badge>,
	},
	{
		key: 'fromConfig',
		header: 'set by',
		render: (state) => <span className="text-muted-foreground">{state.fromConfig ? 'this repo' : 'the pack'}</span>,
	},
	{ key: 'settings', header: 'settings', render: (state) => <RuleSettings state={state} /> },
];

interface Props {
	ruleStates: ConfigView['ruleStates'];
}

/**
 * Every rule this repo loads, at the state it actually runs at here.
 *
 * The same table `lightsout standards-check --list` prints, from the same
 * reader — so the terminal and the page cannot disagree about what a repo
 * enforces. It lives on the config page rather than beside the findings because
 * it is a record of decisions, not of breakage.
 */
export const RuleLedger = ({ ruleStates }: Props) => {
	const [severities, setSeverities] = useState<string[]>([]);
	const rows = severities.length === 0 ? ruleStates : ruleStates.filter((state) => severities.includes(state.severity));

	return (
		<div className="flex flex-col gap-2">
			<FilterDropdown
				label="severity"
				options={Object.values(StandardsSeverity).map((severity) => ({
					value: severity,
					label: severity,
					count: ruleStates.filter((state) => state.severity === severity).length,
				}))}
				selected={severities}
				onChange={setSeverities}
			/>
			<DataTable rows={rows} columns={columns} getRowKey={(state) => state.rule} empty={<EmptyState title="No rules match this severity." />} />
		</div>
	);
};
