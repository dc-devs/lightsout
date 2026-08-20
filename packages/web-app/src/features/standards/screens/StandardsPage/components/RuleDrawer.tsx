import type { StandardsRuleView } from '@lightsout/engine';
import { DefinitionList } from '#src/common/components/ui/DefinitionList.tsx';
import { Dialog } from '#src/common/components/ui/Dialog.tsx';
import { Markdown } from '#src/common/components/ui/Markdown.tsx';
import type { DefinitionEntry } from '#src/common/types/DefinitionEntry.ts';

/** How this repo runs the rule, in the order a reader asks: who says so, then how loudly, then with what numbers. */
const buildRuleFacts = ({ rule }: { rule: StandardsRuleView }): DefinitionEntry[] => [
	[
		'stated in',
		<span key="doc" className="font-mono">
			{rule.doc}
		</span>,
	],
	[
		'document',
		<span key="documentPath" className="font-mono">
			{rule.documentPath}
		</span>,
	],
	['set', rule.set],
	[
		'severity',
		<span key="severity">
			{rule.severity}
			{rule.fromConfig ? <span className="text-status-running"> · set by this repo, not the package</span> : null}
		</span>,
	],
	['checked by', rule.checked ? 'code' : 'judgment'],
	...Object.entries(rule.settings).map(
		([name, value]): DefinitionEntry => [
			name,
			<span key={name} className="font-mono">
				{value}
			</span>,
		],
	),
];

interface Props {
	/** The rule the drawer is showing; nothing is open when this is absent. */
	rule?: StandardsRuleView;
	onClose: () => void;
}

/**
 * One rule's own prose, beside how this repo runs it.
 *
 * The text comes from the view rather than from disk, so a rule brought in by
 * somebody else's standards package reads exactly like one of this repo's. The
 * rule's implementation is deliberately not shown: what a reader needs in order
 * to agree or disagree is the argument, and a check's source is neither.
 */
export const RuleDrawer = ({ rule, onClose }: Props) =>
	rule === undefined ? null : (
		<Dialog open onOpenChange={() => onClose()} title={rule.rule}>
			<div className="flex flex-col gap-4">
				<p className="text-sm leading-6">{rule.summary}</p>
				<DefinitionList entries={buildRuleFacts({ rule })} />
				<Markdown text={rule.prose} />
			</div>
		</Dialog>
	);
