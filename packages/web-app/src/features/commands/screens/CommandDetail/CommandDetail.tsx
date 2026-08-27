import { useSuspenseQuery } from '@tanstack/react-query';
import { ContentHeader } from '#src/appUI/index.ts';
import { commandsQueryOptions } from '#src/features/commands/queries/commandsQueryOptions.ts';
import { CommandHistory } from '#src/features/commands/screens/CommandDetail/components/CommandHistory.tsx';
import { CommandManual } from '#src/features/commands/screens/CommandDetail/components/CommandManual.tsx';

interface Props {
	/** The route param — a catalog id such as `implement` or `standards-check`. */
	commandId: string;
}

/**
 * One command whole: its manual, and what it has done in the repo the app has
 * open.
 *
 * The manual half needs no repo, which is the point — it is the page a reader
 * lands on from a link before they have installed anything.
 *
 * An id the catalog does not carry renders nothing: the route answers that with
 * its own not-found panel before this component is reached.
 */
export const CommandDetail = ({ commandId }: Props) => {
	const { data: commands } = useSuspenseQuery(commandsQueryOptions());
	const entry = commands.find((candidate) => candidate.id === commandId);

	return entry === undefined ? null : (
		<div className="flex flex-col gap-6 p-6">
			<ContentHeader crumbs={[{ label: 'Commands', link: { to: '/commands' } }, { label: entry.id }]} />
			<CommandManual entry={entry} />
			<CommandHistory entry={entry} />
		</div>
	);
};
