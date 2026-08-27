import type { RunListing } from '@lightsout/engine';
import { RunStatus } from '@lightsout/engine/contracts';
import { Link } from '@tanstack/react-router';
import { CopyButton, SettingsCard, StatusBadge } from '#src/appUI/index.ts';
import { statusBadgeConfig } from '#src/common/constants/statusBadgeConfig.ts';

/**
 * What to do about one stopped run.
 *
 * A resumable run gets the command that picks it up, because that is the whole
 * of the answer. An escalated one gets a link instead: it stopped on a question
 * for a human, and `resume` is not what it needs first.
 */
const RunAction = ({ run }: { run: RunListing }) =>
	run.resumable ? (
		<CopyButton value={`lightsout resume --run ${run.shortId}`} label="Copy resume" />
	) : (
		<Link to="/repo/runs/$runId" params={{ runId: run.runId }} className="text-brand-to text-sm underline underline-offset-4">
			Read the escalation →
		</Link>
	);

interface Props {
	/** Top-level runs only, so a coordinator and its phase never both ask for the same attention. */
	runs: RunListing[];
}

/**
 * The runs that are waiting on a person right now.
 *
 * `resumable` is the engine's own answer to "would `resume` do something", so
 * the panel cannot claim a run needs picking up that `resume` would refuse.
 * Escalated runs are added to it by hand, because `isRunResumable` excludes them
 * on purpose — they are waiting on a decision rather than on a restart, which is
 * exactly the case this panel exists for.
 */
export const NeedsYouPanel = ({ runs }: Props) => {
	const waiting = runs.filter((run) => run.resumable || run.status === RunStatus.Escalated);

	return (
		<SettingsCard title="Needs you" description="Runs that stopped and are waiting on a person.">
			{waiting.length === 0 ? (
				<p className="text-muted-foreground text-sm">Nothing is waiting on you.</p>
			) : (
				<ul className="flex flex-col">
					{waiting.map((run) => (
						<li key={run.runId} className="flex flex-wrap items-center gap-3 border-border border-b py-2 first:pt-0 last:border-0 last:pb-0">
							<StatusBadge status={run.status} config={statusBadgeConfig} live={run.live} />
							<Link to="/repo/runs/$runId" params={{ runId: run.runId }} className="min-w-0 flex-1 truncate font-medium text-sm hover:underline">
								{run.title}
							</Link>
							<RunAction run={run} />
						</li>
					))}
				</ul>
			)}
		</SettingsCard>
	);
};
