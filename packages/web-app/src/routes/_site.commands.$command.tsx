import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { AddressNotFound } from '#src/common/components/boundaries/AddressNotFound.tsx';
import { CommandDetail, commandsQueryOptions } from '#src/features/commands/index.ts';

/** No command answers to the word in the path. */
const CommandNotFound = () => {
	const { command } = Route.useParams();

	return (
		<AddressNotFound title="No command by that name.">
			lightsout has no command called <span className="font-mono">{command}</span> —{' '}
			<Link to="/commands" className="text-brand-to underline underline-offset-4">
				pick one from the commands list
			</Link>
			.
		</AddressNotFound>
	);
};

const CommandDetailPage = () => {
	const { command } = Route.useParams();

	return <CommandDetail commandId={command} />;
};

export const Route = createFileRoute('/_site/commands/$command')({
	// The whole catalog, warmed once. It is a few kilobytes of static data, so
	// the loader already holds every entry — which is how it can answer a wrong
	// id here rather than sending the page off for a second round trip to find
	// out.
	loader: async ({ context, params }) => {
		const commands = await context.queryClient.ensureQueryData(commandsQueryOptions());

		if (!commands.some((entry) => entry.id === params.command)) {
			throw notFound();
		}
	},
	// From the path alone, so the tab is named before the query resolves.
	head: ({ params }) => ({ meta: [{ title: `${params.command} — lightsout command` }] }),
	component: CommandDetailPage,
	notFoundComponent: CommandNotFound,
});
