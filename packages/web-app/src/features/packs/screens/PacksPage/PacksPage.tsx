import { useSuspenseQuery } from '@tanstack/react-query';
import { Library } from 'lucide-react';
import { CopyButton, PageHeader, SettingsCard } from '#src/appUI/index.ts';
import { packsQueryOptions } from '#src/features/packs/queries/packsQueryOptions.ts';
import { PackCard } from '#src/features/packs/screens/PacksPage/components/PackCard.tsx';

/** The `standards-packs` entry a repo would write to load exactly these packs. */
const buildConfigSnippet = ({ paths }: { paths: string[] }) => JSON.stringify({ 'standards-packs': paths }, null, '\t');

/**
 * The standards packs this build can see: what each one holds, and how a repo
 * asks for them.
 *
 * A pack is a folder of rules — prose a coding agent is handed, and for about
 * half of them a check that proves the rule mechanically. Packs stack, so a shop
 * adds its own beside the defaults rather than forking them.
 *
 * Finding nothing is a state the page renders rather than an error: a build with
 * no repo under it and no bundled pack beside it has nothing true to say, and
 * the reason it found nothing is in the server log, where the person who can fix
 * it is.
 */
export const PacksPage = () => {
	const { data: packs } = useSuspenseQuery(packsQueryOptions());
	const configured = packs.filter((pack) => !pack.isDefault);
	const snippet = buildConfigSnippet({ paths: configured.length === 0 ? ['./packages/house-standards'] : configured.map((pack) => pack.path) });

	return (
		<div className="flex flex-col gap-6 p-6">
			<PageHeader icon={Library} title="Standards packs" />
			{packs.length === 0 ? (
				<p className="text-muted-foreground text-sm">No standards pack could be found from here.</p>
			) : (
				<>
					<p className="max-w-3xl text-muted-foreground text-sm">
						A standards pack is a folder of rules: each one states what it catches, argues the case in prose an agent is handed, and — where the rule can be
						decided mechanically — ships a check and a pair of examples that prove it. Packs stack, so your own rules sit beside these rather than replacing
						them.
					</p>
					<SettingsCard
						title="Use these packs"
						description="Point lightsout.config.json at each pack folder. Paths are relative to the repo root."
						action={<CopyButton value={snippet} label="Copy config" />}
					>
						<pre className="overflow-x-auto font-mono text-muted-foreground-strong text-xs">{snippet}</pre>
						{configured.length === 0 ? (
							<p className="mt-2 text-muted-foreground text-xs">The default pack loads when you say nothing — add entries only for your own packs.</p>
						) : null}
					</SettingsCard>
					<div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
						{packs.map((pack) => (
							<PackCard key={pack.name} pack={pack} />
						))}
					</div>
				</>
			)}
		</div>
	);
};
