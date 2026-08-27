import type { RunListing } from '@lightsout/engine';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MetadataTag } from '#src/appUI/index.ts';
import { statusBadgeConfig } from '#src/common/constants/statusBadgeConfig.ts';
import { formatRelativeTime } from '#src/common/formatting/formatRelativeTime.ts';
import { repoRootQueryOptions } from '#src/features/app/index.ts';
import { configQueryOptions } from '#src/features/config/index.ts';

/** When this repo last did anything, or the sentence a repo that has never run needs instead of a dash. */
const LastRun = ({ run }: { run: RunListing | undefined }) =>
	run === undefined ? (
		<span>no runs yet</span>
	) : (
		<span>
			last run {formatRelativeTime({ at: run.updatedAt })} · {statusBadgeConfig[run.status].label}
		</span>
	);

interface Props {
	/** Top-level runs only, newest first — the page has already ordered them, and a phase finishing is not the repo's last run, its coordinator is. */
	runs: RunListing[];
}

/**
 * One line saying which repository this is, what it runs agents with, and when
 * it last did anything.
 *
 * The config is subscribed to rather than suspended on. A `lightsout.config.json`
 * that will not parse is a real state with a real message — one this page
 * deliberately sends the reader to `/repo/config` to read — and it should cost
 * two chips here, never the whole health page.
 */
export const RepoStrip = ({ runs }: Props) => {
	const {
		data: { repoRoot },
	} = useSuspenseQuery(repoRootQueryOptions());
	const { data: config, isError } = useQuery(configQueryOptions());
	// `null` is what the view says when the file states neither, and the chip is
	// dropped rather than filled with the engine's fallback — the Harness section
	// on /repo/config is the page that explains what happens then.
	const harness = config?.harness ?? undefined;
	const model = config?.model ?? undefined;

	return (
		// An inline element, not a block one: `PageHeader` renders its description
		// inside a paragraph, and a <div> there is invalid HTML that React warns
		// about and a browser would reparse.
		<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-2">
			<MetadataTag className="min-w-0 truncate" title={repoRoot}>
				{repoRoot}
			</MetadataTag>
			{harness === undefined ? null : <MetadataTag>{harness}</MetadataTag>}
			{model === undefined ? null : <MetadataTag>{model}</MetadataTag>}
			{isError ? (
				<Link to="/repo/config" className="underline underline-offset-4">
					config unreadable
				</Link>
			) : null}
			<LastRun run={runs[0]} />
		</span>
	);
};
