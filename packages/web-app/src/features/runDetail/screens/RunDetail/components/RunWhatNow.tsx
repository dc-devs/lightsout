import { RunStatus } from '@lightsout/engine/contracts';
import { CopyButton, MetadataTag } from '#src/appUI/index.ts';
import type { RunDetailView } from '#src/features/runDetail/common/types/RunDetailView.ts';

/**
 * What each stopped state means, and what a reader does about it.
 *
 * The three states that carry no failing step and no error between them: a
 * paused run stopped at a wall rather than on a defect, and an escalated one is
 * waiting on a person. Without a sentence each, all a reader sees is a badge.
 */
const stateSentences: Partial<Record<RunStatus, string>> = {
	[RunStatus.PausedRateLimit]: 'Paused at the harness rate limit — resume when the window resets.',
	[RunStatus.PausedBudget]: 'Paused at the batch ceiling you set — resume to continue.',
	[RunStatus.Escalated]: 'Escalated — the supervisor asked for a human decision; read the step’s report, then resume.',
};

/** The step a run is standing on: the one that failed, else the last that has not passed, else whatever the manifest still has open. */
const findOpenStep = ({ view }: { view: RunDetailView }) => {
	const failed = view.steps.find((step) => step.status === RunStatus.Failed);
	const unfinished = [...view.steps].reverse().find((step) => step.status !== RunStatus.Passed);

	return failed ?? unfinished;
};

interface Props {
	view: RunDetailView;
	/** Suppresses the resume command — set when no repo was found, since it names a run only this machine has. */
	commandsDisabled?: boolean;
}

/**
 * Where a run that has not finished is standing, and the one command that
 * would move it on.
 *
 * A run that passed has no next thing to do and a run that has not started has
 * nothing to say yet, so both draw nothing at all. The resume line follows the
 * manifest's own `resumable` rather than a second list of states, so this and
 * the runs table can never disagree about which runs offer one.
 */
export const RunWhatNow = ({ view, commandsDisabled = false }: Props) => {
	const { listing } = view;

	if (listing.status === RunStatus.Passed || listing.status === RunStatus.Pending) {
		return null;
	}

	const step = findOpenStep({ view });
	const sentence = stateSentences[listing.status];
	const failure = listing.status === RunStatus.Failed ? step?.error?.split('\n')[0] : undefined;
	const resumeCommand = `lightsout resume --run ${listing.shortId}`;

	return (
		<div className="flex flex-col items-start gap-2 rounded-md border border-border bg-muted px-3 py-2">
			<p className="text-sm">
				{listing.status === RunStatus.Running ? 'working on ' : 'stopped at '}
				<MetadataTag>{step?.id ?? view.currentStep ?? 'nothing yet'}</MetadataTag>
			</p>
			{failure === undefined ? null : <p className="text-sm text-status-failed">{failure}</p>}
			{sentence === undefined ? null : <p className="text-muted-foreground text-sm">{sentence}</p>}
			{listing.resumable && !commandsDisabled ? (
				<div className="flex items-center gap-2">
					<code className="rounded-md bg-background px-2 py-1 font-mono text-xs">{resumeCommand}</code>
					<CopyButton value={resumeCommand} label="Copy resume command" />
				</div>
			) : null}
		</div>
	);
};
