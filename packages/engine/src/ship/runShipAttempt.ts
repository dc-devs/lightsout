import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';
import { ShipBlockReason, type ShipResult, ShipStatus } from '#src/contracts/index.ts';
import type { ShipAttemptResult } from '#src/ship/common/types/ShipAttemptResult.ts';
import type { ShipIntegration } from '#src/ship/common/types/ShipIntegration.ts';
import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
import { appendCommandOutput } from '#src/ship/common/utils/appendCommandOutput.ts';
import { hasNoChecks } from '#src/ship/common/utils/hasNoChecks.ts';
import { type CheckFailure, mergePullRequest, readCheckFailureLogs } from '#src/ship/forge/index.ts';
import { integrateDefaultBranch } from '#src/ship/integration/index.ts';
import { openPullRequest } from '#src/ship/openPullRequest.ts';
import { publishCandidate } from '#src/ship/publishCandidate.ts';
import { waitForChecks } from '#src/ship/waitForChecks.ts';

type ProgressSink = (message: string) => void;

interface Params {
	cwd: string;
	settings: ShipSettings;
	integration: ShipIntegration;
	branch: string;
	defaultBranch: string;
	/** The branch's ticket capture groups — `ticket` plus whatever else the pattern names. */
	ticket: Record<string, string>;
	/** The branch's own diff against the commit it was cut from, captured once by `runShip` and unchanged across attempts. */
	branchDiff: string;
	/** The previous attempt's failure evidence, when this attempt is meant to repair a demonstrated CI defect. */
	ciEvidence?: string;
	onProgress?: ProgressSink;
}

/** Everything a blocked result carries that this attempt already knows. */
interface StopFields {
	branch: string;
	ticketRef: string;
}

/** A proposal, never a persisted result: `runShip` alone decides which attempt's outcome becomes the record. */
const blocked = ({
	stop,
	reason,
	detail,
	failingChecks = [],
	retryable = false,
	ciEvidence,
}: {
	stop: StopFields;
	reason: ShipBlockReason;
	detail: string;
	failingChecks?: string[];
	retryable?: boolean;
	ciEvidence?: string;
}): ShipAttemptResult => ({ result: { status: ShipStatus.Blocked, failingChecks, ...stop, reason, detail }, retryable, ciEvidence });

/** The failing runs' output, as one block of diagnostic data the repair attempt is handed. */
const describeEvidence = ({ evidence }: { evidence: CheckFailure[] }) =>
	evidence.map((failure) => `## ${failure.name} (run ${failure.runId}, commit ${failure.commit})\n\n${failure.output}`).join('\n\n');

/** What the checks came back as, folded into the stop the sequence owes for it — or nothing, when they were green. */
const readCheckStop = async ({
	prNumber,
	candidate,
	cwd,
	settings,
	stop,
	onProgress,
}: {
	prNumber: number;
	candidate: string;
	cwd: string;
	settings: ShipSettings;
	stop: StopFields;
	onProgress?: ProgressSink;
}) => {
	const checks = await waitForChecks({ prNumber, cwd, allowNoCi: settings.allowNoCi, expectedHead: candidate, onProgress });

	// Read successfully AND listing nothing is the one observation that means
	// this repository has no CI, as against one that could not be read.
	if (!checks.finished && checks.readable && hasNoChecks({ summary: checks })) {
		return blocked({
			stop,
			reason: ShipBlockReason.ChecksMissing,
			detail:
				'No CI checks appeared for this commit. If this repository intentionally has no CI, set ship.allow-no-ci to true in lightsout.config.json, commit the change, and rerun ship.',
		});
	}

	if (!checks.finished) {
		return blocked({ stop, reason: ShipBlockReason.ChecksTimedOut, detail: 'checks were still running at the wait ceiling', failingChecks: checks.pending });
	}

	if (checks.green) {
		return undefined;
	}

	const evidence = await readCheckFailureLogs({ prNumber, commit: candidate, failingChecks: checks.failing, cwd });

	return blocked({
		stop,
		reason: ShipBlockReason.ChecksFailed,
		detail:
			evidence === undefined
				? 'one or more checks finished red, and no failure evidence for this commit could be read — nothing was guessed at'
				: 'one or more checks finished red; the failing run’s own output was handed to the next attempt',
		failingChecks: checks.failing,
		retryable: evidence !== undefined,
		ciEvidence: evidence === undefined ? undefined : describeEvidence({ evidence }),
	});
};

/** The attempt's own inputs, with the ticket reference already resolved and the stop fields it would report. */
interface PrepareParams extends Omit<Params, 'ticket'> {
	ticketRef: string;
	stop: StopFields;
}

/**
 * The verified candidate commit this attempt will publish: the branch
 * integrated with the freshly fetched default branch, prepared, gated and
 * committed — or the stop that ended the attempt before there was one, told
 * apart the way the merge answer below is, by whether it is a commit string.
 */
const prepareCandidate = async ({ cwd, settings, integration, branch, defaultBranch, ticketRef, branchDiff, ciEvidence, stop, onProgress }: PrepareParams) => {
	const baselineCommit = await readGitHeadCommit({ cwd });

	if (baselineCommit === undefined) {
		return blocked({ stop, reason: ShipBlockReason.IntegrationUnavailable, detail: `git could not name the commit '${branch}' is standing on` });
	}

	const integrationFailure = await integrateDefaultBranch({
		cwd,
		integration,
		branch,
		defaultBranch,
		baselineCommit,
		preShip: settings.preShip,
		ciEvidence,
		branchDiff,
		ticketRef,
		onProgress,
	});

	if (integrationFailure !== undefined) {
		return blocked({ stop, reason: integrationFailure.reason, detail: integrationFailure.detail, failingChecks: integrationFailure.paths });
	}

	const candidate = await readGitHeadCommit({ cwd });

	return candidate ?? blocked({ stop, reason: ShipBlockReason.IntegrationUnavailable, detail: 'git could not name the verified candidate commit' });
};

/**
 * One complete shipping attempt: integrate, verify, commit, push, open or adopt
 * the pull request, wait for that commit's checks, and ask for the configured
 * merge.
 *
 * It writes no result, reconciles no ticket and cleans nothing up. Those belong
 * to the invocation rather than the attempt — `runShip` may spend three of
 * these, and a result file per attempt would tell a tracker skill the ship
 * ended twice.
 *
 * `retryable` is narrow on purpose: a confirmed stale base, or failed checks
 * whose evidence was readable enough to repair. Everything else — a local
 * preparation failure, missing CI, a timeout, a policy blocker, an unreadable
 * remote outcome — is the end of the invocation, because another whole attempt
 * would meet exactly the same wall.
 */
export const runShipAttempt = async ({
	cwd,
	settings,
	integration,
	branch,
	defaultBranch,
	ticket,
	branchDiff,
	ciEvidence,
	onProgress,
}: Params): Promise<ShipAttemptResult> => {
	const ticketRef = ticket.ticket ?? branch;
	const stop: StopFields = { branch, ticketRef };
	const candidate = await prepareCandidate({ cwd, settings, integration, branch, defaultBranch, ticketRef, branchDiff, ciEvidence, stop, onProgress });

	if (typeof candidate !== 'string') {
		return candidate;
	}

	const pushFailure = await publishCandidate({ branch, cwd, candidate });

	if (pushFailure !== undefined) {
		const detail = appendCommandOutput({ sentence: `git could not push '${branch}' to origin`, stderr: pushFailure.stderr });

		return blocked({ stop, reason: ShipBlockReason.PushFailed, detail });
	}

	const pullRequest = await openPullRequest({ branch, cwd, settings, ticket, onProgress });

	if ('stderr' in pullRequest) {
		const detail = appendCommandOutput({ sentence: `no pull request could be opened or read for '${branch}'`, stderr: pullRequest.stderr });

		return blocked({ stop, reason: ShipBlockReason.PullRequestUnavailable, detail });
	}

	const checkStop = await readCheckStop({ prNumber: pullRequest.number, candidate, cwd, settings, stop, onProgress });

	if (checkStop !== undefined) {
		return checkStop;
	}

	const mergeCommit = await mergePullRequest({ prNumber: pullRequest.number, mergeMethod: settings.mergeMethod, expectedHead: candidate, cwd });

	if (typeof mergeCommit !== 'string') {
		const detail = appendCommandOutput({ sentence: `the forge refused to merge #${pullRequest.number}`, stderr: mergeCommit.stderr });

		return blocked({ stop, reason: ShipBlockReason.MergeRejected, detail, retryable: mergeCommit.staleBase === true });
	}

	return {
		result: {
			status: ShipStatus.Shipped,
			branch,
			ticketRef,
			prNumber: pullRequest.number,
			prUrl: pullRequest.url,
			prTitle: pullRequest.title,
			mergeCommit,
			mergedAt: new Date().toISOString(),
			failingChecks: [],
		} satisfies ShipResult,
		retryable: false,
	};
};
