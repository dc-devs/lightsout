import { ShipBlockReason, type ShipResult, ShipStatus } from '#src/contracts/index.ts';
import { checkShipPreconditions } from '#src/ship/checkShipPreconditions.ts';
import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';
import { createPullRequest, findPullRequest, mergePullRequest, PullRequestState, type PullRequestSummary } from '#src/ship/forge/index.ts';
import { pushBranch } from '#src/ship/pushBranch.ts';
import { renderPullRequestBody } from '#src/ship/renderPullRequestBody.ts';
import { runPreShip } from '#src/ship/runPreShip.ts';
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

/**
 * The block's own sentence, with the failing command's words after it.
 *
 * Redacted before it is kept: the result file is persisted and quoted outward
 * by tracker skills, and `git push` stderr can echo a tokenized remote
 * (`https://user:ghp_xxx@github.com/...`). URL userinfo and token-shaped runs
 * are masked, so a credential can never leave the machine through this file.
 *
 * Capped rather than whole: this is a hand-off a tracker skill quotes into a
 * comment, not a log, so a hook that prints a page of guidance is cut off at
 * the point a human has already got the message. An empty stderr leaves the
 * sentence exactly as it was, so no result ever ends in a bare colon.
 */
const appendCommandOutput = ({ sentence, stderr }: { sentence: string; stderr: string }) => {
	const maxStderrCharacters = 500;
	const redacted = stderr.replaceAll(/(\/\/)[^\s/@]+(?::[^\s/@]*)?@/g, '$1***@').replaceAll(/\b(gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}\b/g, '***');
	const trimmed = redacted.trim();
	const capped = trimmed.length > maxStderrCharacters ? `${trimmed.slice(0, maxStderrCharacters)}…` : trimmed;

	return capped === '' ? sentence : `${sentence}: ${capped}`;
};

/**
 * The pre-ship command, and the stop it earns when it fails.
 *
 * It runs before the preconditions, deliberately: the command exists to make
 * the tree shippable (rebuild committed outputs, bump a shipped version), and
 * its commit is what lets the dirty-tree check that follows pass.
 */
const runPreShipStep = async ({ cwd, settings, onProgress }: Params) => {
	if (settings.preShip === undefined) {
		return undefined;
	}

	const failure = await runPreShip({ cwd, command: settings.preShip, onProgress });

	if (failure === undefined) {
		return undefined;
	}

	return stopShip({
		cwd,
		onProgress,
		reason: ShipBlockReason.PreShipFailed,
		detail: appendCommandOutput({ sentence: `the pre-ship command '${settings.preShip}' failed`, stderr: failure.stderr }),
	});
};

/** The checks the merge waits on, and the stop an unfinished or red run earns. */
const waitForChecksStep = async ({
	prNumber,
	stopFields,
}: {
	prNumber: number;
	stopFields: { cwd: string; onProgress?: ProgressSink; branch: string; ticketRef: string };
}) => {
	const { cwd, onProgress } = stopFields;
	const checks = await waitForChecks({ prNumber, cwd, onProgress });

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

	return undefined;
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
}): Promise<PullRequestSummary | ShipStepFailure> => {
	const adopted = await findPullRequest({ branch, cwd, state: PullRequestState.Open });

	if (adopted !== undefined) {
		// Adoption is resume, not re-render: a body someone has since edited by
		// hand is theirs, and a re-run must not overwrite it.
		onProgress?.(`pull request #${adopted.number} is already open — adopting it`);

		return adopted;
	}

	const body = renderPullRequestBody({ template: settings.pullRequestBody, tokens: { ...ticket, branch } });
	const created = await createPullRequest({ branch, body, cwd });

	onProgress?.('stderr' in created ? 'the forge would not open a pull request' : `opened pull request #${created.number}`);

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
	const preShipStop = await runPreShipStep({ cwd, settings, onProgress });

	if (preShipStop !== undefined) {
		return preShipStop;
	}

	const preconditions = await checkShipPreconditions({ cwd, ticketPattern: settings.ticketPattern });

	if ('reason' in preconditions) {
		return stopShip({ cwd, onProgress, ...preconditions });
	}

	const { branch, defaultBranch, ticket } = preconditions;
	const ticketRef = ticket.ticket;
	const stopFields = { cwd, onProgress, branch, ticketRef };

	onProgress?.(`ship: ${branch} → ${defaultBranch}, ticket ${ticketRef}`);

	const pushFailure = await pushBranch({ branch, cwd });

	if (pushFailure !== undefined) {
		return stopShip({
			...stopFields,
			reason: ShipBlockReason.PushFailed,
			detail: appendCommandOutput({ sentence: `git could not push '${branch}' to origin`, stderr: pushFailure.stderr }),
		});
	}

	const pullRequest = await openPullRequest({ branch, cwd, settings, ticket, onProgress });

	if ('stderr' in pullRequest) {
		return stopShip({
			...stopFields,
			reason: ShipBlockReason.PullRequestUnavailable,
			detail: appendCommandOutput({ sentence: `no pull request could be opened or read for '${branch}'`, stderr: pullRequest.stderr }),
		});
	}

	const checksStop = await waitForChecksStep({ prNumber: pullRequest.number, stopFields });

	if (checksStop !== undefined) {
		return checksStop;
	}

	const mergeCommit = await mergePullRequest({ prNumber: pullRequest.number, mergeMethod: settings.mergeMethod, cwd });

	if (typeof mergeCommit !== 'string') {
		return stopShip({
			...stopFields,
			reason: ShipBlockReason.MergeRejected,
			detail: appendCommandOutput({ sentence: `the forge refused to merge #${pullRequest.number}`, stderr: mergeCommit.stderr }),
		});
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
