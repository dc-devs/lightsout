import type { CommandCatalogEntry } from '@lightsout/engine';
import { Link } from '@tanstack/react-router';
import { Badge } from '#src/appUI/index.ts';
import { recordKindLabels } from '#src/features/commands/common/constants/recordKindLabels.ts';
import { CommandCount } from '#src/features/commands/screens/CommandsPage/components/CommandCount.tsx';

interface Props {
	entry: CommandCatalogEntry;
}

/**
 * One command on the commands page: what it is called, what it does in a line,
 * what it leaves behind, and — on a machine with a repo — what it has done here.
 *
 * The title is the slash form where the plugin ships a skill and the CLI form
 * otherwise, because that is the string a reader would actually type.
 */
export const CommandCard = ({ entry }: Props) => (
	<article className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
		<div className="flex flex-wrap items-center justify-between gap-2">
			<Link to="/commands/$command" params={{ command: entry.id }} className="font-medium font-mono text-sm hover:underline hover:underline-offset-2">
				{entry.slash ?? entry.cli}
			</Link>
			<Badge>{recordKindLabels[entry.records]}</Badge>
		</div>
		<p className="text-muted-foreground text-sm">{entry.summary}</p>
		<CommandCount entry={entry} />
	</article>
);
