import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';
import { ShipBlockReason, ShippingStepId, type ShipResult, ShipStatus } from '#src/contracts/index.ts';
import type { ShipAttemptResult } from '#src/ship/common/types/ShipAttemptResult.ts';
import type { ShipIntegration } from '#src/ship/common/types/ShipIntegration.ts';
import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
import type { ShipStopFields } from '#src/ship/common/types/ShipStopFields.ts';
import { appendCommandOutput } from '#src/ship/common/utils/appendCommandOutput.ts';
import { createBlockedAttempt } from '#src/ship/common/utils/createBlockedAttempt.ts';
import { mergePullRequest, type PullRequestSummary } from '#src/ship/forge/index.ts';
import { integrateDefaultBranch } from '#src/ship/integration/index.ts';
import { openPullRequest } from '#src/ship/openPullRequest.ts';
import type { ShippingProgressRecorder } from '#src/ship/progress/index.ts';
import { publishCandidate } from '#src/ship/publishCandidate.ts';
import { readCheckStop } from '#src/ship/readCheckStop.ts';

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
	/** Records each step as it starts and finishes. Required, so no attempt can run without recording. */
	recorder: ShippingProgressRecorder;
	onProgress?: ProgressSink;
}

/** The attempt's own inputs, with the ticket reference already resolved and the stop fields it would report. */
interface PrepareParams extends Omit<Params, 'ticket' | 'recorder'> {
	ticketRef: string;
	stop: ShipStopFields;
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
		return createBlockedAttempt({ stop, reason: ShipBlockReason.IntegrationUnavailable, detail: `git could not name the commit '${branch}' is standing on` });
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
		return createBlockedAttempt({ stop, reason: integrationFailure.reason, detail: integrationFailure.detail, failingChecks: integrationFailure.paths });
	}

	const candidate = await readGitHeadCommit({ cwd });

	return (
		candidate ?? createBlockedAttempt({ stop, reason: ShipBlockReason.IntegrationUnavailable, detail: 'git could not name the verified candidate commit' })
	);
};

/**
 * One step of the attempt, recorded as it starts and as it finishes — passed or
 * failed by the step's own answer. A step that stops the attempt is finished
 * failed before its stop is returned, and the steps after it stay untouched.
 */
const recordStep = async <Answer>({
	recorder,
	step,
	run,
	passed,
}: {
	recorder: ShippingProgressRecorder;
	step: ShippingStepId;
	run: () => Promise<Answer>;
	passed: (answer: Answer) => boolean;
}) => {
	recorder.startStep({ step });

	const answer = await run();

	recorder.finishStep({ step, passed: passed(answer) });

	return answer;
};

/** The configured merge of the green candidate: the shipped result, or the refusal that ends the attempt — retryable only for a base the forge proved stale. */
const mergeCandidate = async ({
	pullRequest,
	candidate,
	cwd,
	settings,
	stop,
	recorder,
}: {
	pullRequest: PullRequestSummary;
	candidate: string;
	cwd: string;
	settings: ShipSettings;
	stop: ShipStopFields;
	recorder: ShippingProgressRecorder;
}) => {
	const mergeCommit = await recordStep({
		recorder,
		step: ShippingStepId.Merge,
		run: () => mergePullRequest({ prNumber: pullRequest.number, mergeMethod: settings.mergeMethod, expectedHead: candidate, cwd }),
		passed: (merged) => typeof merged === 'string',
	});

	if (typeof mergeCommit !== 'string') {
		const detail = appendCommandOutput({ sentence: `the forge refused to merge #${pullRequest.number}`, stderr: mergeCommit.stderr });

		return createBlockedAttempt({ stop, reason: ShipBlockReason.MergeRejected, detail, retryable: mergeCommit.staleBase === true });
	}

	return {
		result: {
			status: ShipStatus.Shipped,
			...stop,
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
	recorder,
	onProgress,
}: Params): Promise<ShipAttemptResult> => {
	const ticketRef = ticket.ticket ?? branch;
	const stop: ShipStopFields = { branch, ticketRef };

	const candidate = await recordStep({
		recorder,
		step: ShippingStepId.Integrate,
		run: () => prepareCandidate({ cwd, settings, integration, branch, defaultBranch, ticketRef, branchDiff, ciEvidence, stop, onProgress }),
		passed: (prepared) => typeof prepared === 'string',
	});

	if (typeof candidate !== 'string') {
		return candidate;
	}

	const pushFailure = await recordStep({
		recorder,
		step: ShippingStepId.Push,
		run: () => publishCandidate({ branch, cwd, candidate }),
		passed: (failure) => failure === undefined,
	});

	if (pushFailure !== undefined) {
		const detail = appendCommandOutput({ sentence: `git could not push '${branch}' to origin`, stderr: pushFailure.stderr });

		return createBlockedAttempt({ stop, reason: ShipBlockReason.PushFailed, detail });
	}

	const pullRequest = await recordStep({
		recorder,
		step: ShippingStepId.PullRequest,
		run: () => openPullRequest({ branch, cwd, settings, ticket, onProgress }),
		passed: (opened) => !('stderr' in opened),
	});

	if ('stderr' in pullRequest) {
		const detail = appendCommandOutput({ sentence: `no pull request could be opened or read for '${branch}'`, stderr: pullRequest.stderr });

		return createBlockedAttempt({ stop, reason: ShipBlockReason.PullRequestUnavailable, detail });
	}

	const checkStop = await recordStep({
		recorder,
		step: ShippingStepId.Checks,
		run: () => readCheckStop({ prNumber: pullRequest.number, candidate, cwd, settings, stop, onProgress }),
		passed: (stopped) => stopped === undefined,
	});

	return checkStop ?? mergeCandidate({ pullRequest, candidate, cwd, settings, stop, recorder });
};
