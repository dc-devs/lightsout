import { ShipBlockReason, type ShipResult, ShipStatus } from '#src/contracts/index.ts';
import { checkShipPreconditions } from '#src/ship/checkShipPreconditions.ts';
import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
import { createPullRequest, findOpenPullRequest, mergePullRequest, type PullRequestSummary } from '#src/ship/forge/index.ts';
import { pushBranch } from '#src/ship/pushBranch.ts';
import { renderPullRequestBody } from '#src/ship/renderPullRequestBody.ts';
import { syncDefaultBranch } from '#src/ship/syncDefaultBranch.ts';
import { waitForChecks } from '#src/ship/waitForChecks.ts';
import { writeShipResult } from '#src/ship/writeShipResult.ts';

type ProgressSink = (message: string) => void;

interface Params {
	cwd: string;
	/** Already-resolved settings — validating the config is the caller's job, so no step here throws. */
	settings: ShipSettings;
	/** Live progress sink — one line per step. Silent when omitted. */
	onProgress?: ProgressSink;
}

/** Persist a result and hand it back — the one way out of this file, so no exit path can forget to write one. */
const record = async ({ cwd, result, onProgress }: { cwd: string; result: ShipResult; onProgress?: ProgressSink }) => {
	const resultPath = await writeShipResult({ cwd, result });

	onProgress?.(`ship result: ${resultPath}`);

	return result;
};

/** A blocked result, written on the way out. Every stop in the sequence ends here rather than throwing. */
const stopShip = ({
	cwd,
	onProgress,
	failingChecks = [],
	...block
}: {
	cwd: string;
	onProgress?: ProgressSink;
	reason: ShipBlockReason;
	detail: string;
	branch?: string;
	ticketRef?: string;
	failingChecks?: string[];
}) => {
	return record({ cwd, onProgress, result: { status: ShipStatus.Blocked, failingChecks, ...block } });
};

/** The branch's pull request: the open one when there is one, else a new one carrying the rendered body. */
const openPullRequest = async ({
	branch,
	cwd,
	settings,
	ticket,
	onProgress,
}: {
	branch: string;
	cwd: string;
	settings: ShipSettings;
	ticket: Record<string, string>;
	onProgress?: ProgressSink;
}): Promise<PullRequestSummary | undefined> => {
	const adopted = await findOpenPullRequest({ branch, cwd });

	if (adopted !== undefined) {
		// Adoption is resume, not re-render: a body someone has since edited by
		// hand is theirs, and a re-run must not overwrite it.
		onProgress?.(`pull request #${adopted.number} is already open — adopting it`);

		return adopted;
	}

	const body = renderPullRequestBody({ template: settings.pullRequestBody, tokens: { ...ticket, branch } });
	const created = await createPullRequest({ branch, body, cwd });

	onProgress?.(created === undefined ? 'the forge would not open a pull request' : `opened pull request #${created.number}`);

	return created;
};

/**
 * Take the branch the caller is standing on from committed work to merged and
 * cleaned up, and write one typed result describing what happened.
 *
 * Every exit path — blocked and shipped alike — writes that result before
 * returning, because a tracker skill that finds no file cannot tell "ship never
 * ran" from "ship ran and stopped". A stop is typed and final: nothing here
 * retries a red check or a refused merge, and re-running `lightsout ship` is
 * the resume path, which the adopt branch above is what makes cheap.
 */
export const runShip = async ({ cwd, settings, onProgress }: Params): Promise<ShipResult> => {
	const preconditions = await checkShipPreconditions({ cwd, ticketPattern: settings.ticketPattern });

	if ('reason' in preconditions) {
		return stopShip({ cwd, onProgress, ...preconditions });
	}

	const { branch, defaultBranch, ticket } = preconditions;
	const ticketRef = ticket.ticket;
	const stopFields = { cwd, onProgress, branch, ticketRef };

	onProgress?.(`ship: ${branch} → ${defaultBranch}, ticket ${ticketRef}`);

	if (!(await pushBranch({ branch, cwd }))) {
		return stopShip({ ...stopFields, reason: ShipBlockReason.PushFailed, detail: `git could not push '${branch}' to origin` });
	}

	const pullRequest = await openPullRequest({ branch, cwd, settings, ticket, onProgress });

	if (pullRequest === undefined) {
		return stopShip({ ...stopFields, reason: ShipBlockReason.PullRequestUnavailable, detail: `no pull request could be opened or read for '${branch}'` });
	}

	const checks = await waitForChecks({ prNumber: pullRequest.number, cwd, onProgress });

	if (!checks.finished) {
		return stopShip({
			...stopFields,
			reason: ShipBlockReason.ChecksTimedOut,
			detail: 'checks were still running at the wait ceiling',
			failingChecks: checks.pending,
		});
	}

	if (!checks.green) {
		return stopShip({ ...stopFields, reason: ShipBlockReason.ChecksFailed, detail: 'one or more checks finished red', failingChecks: checks.failing });
	}

	const mergeCommit = await mergePullRequest({ prNumber: pullRequest.number, mergeMethod: settings.mergeMethod, cwd });

	if (mergeCommit === undefined) {
		return stopShip({ ...stopFields, reason: ShipBlockReason.MergeRejected, detail: `the forge refused to merge #${pullRequest.number}` });
	}

	await syncDefaultBranch({ cwd, defaultBranch, branch, onProgress });

	return record({
		cwd,
		onProgress,
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
		},
	});
};
