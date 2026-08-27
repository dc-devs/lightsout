import { type CommandCatalogEntry, type CommandFlag, type CommandStep, spellFlag } from '@lightsout/engine';
import { Link } from '@tanstack/react-router';
import { Badge, Card, DataTable, MetadataTag, PageHeader, SectionHeader } from '#src/appUI/index.ts';
import type { DataTableColumn } from '#src/common/types/DataTableColumn.ts';
import { recordKindLabels } from '#src/features/commands/common/constants/recordKindLabels.ts';

/** The flag columns: what to type, what it means, and what happens when it is left out. */
const flagColumns: Array<DataTableColumn<CommandFlag>> = [
	{ key: 'name', header: 'flag', render: (flag) => <span className="font-mono">{spellFlag({ flag })}</span> },
	{ key: 'meaning', header: 'meaning', render: (flag) => flag.meaning },
	{ key: 'fallback', header: 'left out', render: (flag) => flag.fallback ?? (flag.required ? 'required' : 'off') },
];

/**
 * How the command is invoked, and every flag it accepts.
 *
 * Deliberately not the bracketed one-liner `lightsout --help` prints: a page has
 * room for a table, and re-deriving the usage line's rules here would be exactly
 * the second list the catalog exists to prevent. Two renderings of one data
 * structure, not two data structures.
 */
const InvocationSection = ({ entry }: { entry: CommandCatalogEntry }) => (
	<Card title="How to run it">
		<div className="flex flex-col gap-2">
			{entry.invocations.map((invocation) => (
				<div key={invocation.id} className="flex flex-wrap items-baseline gap-2">
					<code className="font-mono text-sm">{[entry.cli, invocation.positional].filter((word) => word !== undefined).join(' ')}</code>
					{invocation.note === undefined ? null : <span className="text-muted-foreground text-xs">{invocation.note}</span>}
				</div>
			))}
			{entry.flags.length === 0 ? null : (
				<DataTable className="mt-2" rows={entry.flags} columns={flagColumns} getRowKey={(flag) => `${flag.name}:${flag.shape ?? 'any'}`} />
			)}
		</div>
	</Card>
);

/** One step of the sequence: who does it, what it does, what it prevents, and the files it leaves behind. */
const StepSection = ({ step, position }: { step: CommandStep; position: number }) => (
	<div className="flex flex-col gap-2 border-border border-l-2 pl-4">
		<SectionHeader title={`${position}. ${step.title}`} action={<Badge>{step.actor}</Badge>} />
		<ul className="list-disc space-y-1 pl-5 text-sm">
			{step.bullets.map((bullet) => (
				<li key={bullet}>{bullet}</li>
			))}
		</ul>
		{step.note === undefined ? null : <p className="text-muted-foreground text-sm italic">{step.note}</p>}
		{step.saved.length === 0 ? null : (
			<p className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
				<span>{step.savedLabel ?? 'writes'}</span>
				{step.saved.map((path) => (
					<MetadataTag key={path}>{path}</MetadataTag>
				))}
			</p>
		)}
	</div>
);

interface Props {
	entry: CommandCatalogEntry;
}

/**
 * One command's manual: how to invoke it, when to reach for it, what it does
 * step by step, and what else is worth knowing about.
 *
 * Every word comes from the engine's command catalog, which is also what the
 * CLI's `--help` and the README's infographics render from.
 */
export const CommandManual = ({ entry }: Props) => (
	<div className="flex flex-col gap-6">
		<PageHeader title={entry.slash ?? entry.cli ?? entry.id} description={entry.summary} action={<Badge>{recordKindLabels[entry.records]}</Badge>} />
		<div className="flex flex-wrap gap-2">
			{entry.slash === undefined ? null : <MetadataTag>{entry.slash}</MetadataTag>}
			{entry.cli === undefined ? null : <MetadataTag>{entry.cli}</MetadataTag>}
		</div>
		<Card title="When to reach for it">
			<p className="max-w-3xl text-sm leading-6">{entry.whenToUse}</p>
		</Card>
		{entry.invocations.length === 0 ? null : <InvocationSection entry={entry} />}
		{entry.steps.length === 0 ? null : (
			<Card title="What happens">
				<div className="flex flex-col gap-6">
					{entry.steps.map((step, index) => (
						<StepSection key={step.title} step={step} position={index + 1} />
					))}
				</div>
			</Card>
		)}
		{entry.related.length === 0 ? null : (
			<Card title="Related commands">
				<div className="flex flex-wrap gap-3">
					{entry.related.map((id) => (
						<Link key={id} to="/commands/$command" params={{ command: id }} className="font-mono text-brand-to text-sm underline underline-offset-4">
							{id}
						</Link>
					))}
				</div>
			</Card>
		)}
	</div>
);
