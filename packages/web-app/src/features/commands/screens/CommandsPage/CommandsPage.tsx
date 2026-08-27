import { CommandGroup } from '@lightsout/engine/contracts';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Terminal } from 'lucide-react';
import { PageHeader, SectionHeader } from '#src/appUI/index.ts';
import { commandGroupLabels } from '#src/features/commands/common/constants/commandGroupLabels.ts';
import { commandsQueryOptions } from '#src/features/commands/queries/commandsQueryOptions.ts';
import { CommandCard } from '#src/features/commands/screens/CommandsPage/components/CommandCard.tsx';

/** The four groups in the order the page reads them: building, burning down, the standards themselves, and keeping the install honest. */
const groupOrder = [CommandGroup.Build, CommandGroup.BurnDown, CommandGroup.Standards, CommandGroup.Housekeeping];

/**
 * Everything lightsout can be asked to do, grouped by what it is for.
 *
 * Every number and every word comes from the engine's own command catalog,
 * which is also what `lightsout --help` and the README infographics render
 * from — so a command that gains a flag gains it here in the same commit.
 *
 * No repo is needed: the catalog is engine source rather than run state.
 */
export const CommandsPage = () => {
	const { data: commands } = useSuspenseQuery(commandsQueryOptions());

	return (
		<div className="flex flex-col gap-8 p-6">
			<PageHeader
				icon={Terminal}
				title="Commands"
				description="Every command lightsout offers — what it does, when to reach for it, and what it leaves behind."
			/>
			{groupOrder.map((group) => (
				<section key={group} className="flex flex-col gap-4">
					<SectionHeader title={commandGroupLabels[group]} />
					<div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
						{commands
							.filter((entry) => entry.group === group)
							.map((entry) => (
								<CommandCard key={entry.id} entry={entry} />
							))}
					</div>
				</section>
			))}
		</div>
	);
};
