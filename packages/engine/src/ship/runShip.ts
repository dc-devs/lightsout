import { maxCheapFixRetries } from '#src/common/constants/maxCheapFixRetries.ts';
import { type ShipBlockReason, ShippingStepId, type ShipResult, ShipStatus } from '#src/contracts/index.ts';
import { checkShipPreconditions } from '#src/ship/checkShipPreconditions.ts';
import type { ShipIntegration } from '#src/ship/common/types/ShipIntegration.ts';
import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
import { quoteGitArgument } from '#src/ship/common/utils/quoteGitArgument.ts';
import { runGit } from '#src/ship/common/utils/runGit.ts';
import { ShippingProgressRecorder } from '#src/ship/progress/index.ts';
import { runShipAttempt } from '#src/ship/runShipAttempt.ts';
import { syncDefaultBranch } from '#src/ship/syncDefaultBranch.ts';
import { writeShipResult } from '#src/ship/writeShipResult.ts';

type ProgressSink = (message: string) => void;

interface Params {
	cwd: string;
	/** Already-resolved settings — validating the config is the caller's job, so no step here throws. */
	settings: ShipSettings;
	/** The effective config and harness the integration step verifies and repairs with. Required, so no shipping path can be added without the safety contract. */
	integration: ShipIntegration;
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
 * The branch's own diff against the commit it was cut from — what states this
 * candidate's intent to a repair attempt.
 *
 * Read once, from the clean starting HEAD, and unchanged for the rest of the
 * invocation: a repair is bounded by what the branch set out to do, and a diff
 * re-read after an integration would quietly widen that bound to include the
 * default branch's work. An unreadable diff is an empty one, which blocks a CI
 * repair rather than inventing an intent for it.
 */
const readBranchDiff = async ({ cwd, defaultBranch }: { cwd: string; defaultBranch: string }) => {
	const maxDiffCharacters = 32_000;
	const forkPoint = await runGit({ command: `git merge-base ${quoteGitArgument({ argument: `origin/${defaultBranch}` })} HEAD`, cwd });

	if (forkPoint === undefined || forkPoint.exitCode !== 0) {
		return '';
	}

	const diffed = await runGit({ command: `git diff ${quoteGitArgument({ argument: forkPoint.stdout.trim() })} HEAD`, cwd });

	if (diffed === undefined || diffed.exitCode !== 0) {
		return '';
	}

	return diffed.stdout.length > maxDiffCharacters
		? `${diffed.stdout.slice(0, maxDiffCharacters)}\n… truncated: the branch's diff is longer than this`
		: diffed.stdout;
};

/**
 * Take the branch the caller is standing on from committed work to merged and
 * cleaned up, and write one typed result describing what happened.
 *
 * Every exit path — blocked and shipped alike — writes that result before
 * returning, because a tracker skill that finds no file cannot tell "ship never
 * ran" from "ship ran and stopped".
 *
 * The bound is `1 + maxCheapFixRetries` COMPLETE attempts, each of which
 * integrates the freshly fetched default branch, prepares the release, verifies
 * it, commits, pushes, waits for that commit's checks and asks for the
 * configured merge. Only two obstacles earn another one: a merge the forge's own
 * state proved is behind a newer base, and failed checks whose evidence was
 * readable enough to repair. Everything else stops here, because another whole
 * attempt would meet exactly the same wall — and the allowance is never reset,
 * so a default branch that keeps moving cannot spin this forever.
 *
 * A retry starts from whatever the last attempt safely committed, so published
 * work is preserved and nothing is ever force-pushed or reset behind a commit
 * the remote already holds. Only a confirmed merge earns the local cleanup, and
 * it runs once.
 *
 * Once the preconditions pass, the sequence also records each of its six steps
 * in a shipping progress record beside the result, which is what
 * `lightsout status --shipping` reads while the ship is still going.
 */
export const runShip = async ({ cwd, settings, integration, onProgress }: Params): Promise<ShipResult> => {
	const preconditions = await checkShipPreconditions({ cwd, ticketPattern: settings.ticketPattern });

	if ('reason' in preconditions) {
		return stopShip({ cwd, onProgress, ...preconditions });
	}

	const { branch, defaultBranch, ticket } = preconditions;
	const maxAttempts = 1 + maxCheapFixRetries;
	const recorder = new ShippingProgressRecorder({ cwd, branch, maxAttempts });

	recorder.beginAttempt({ attempt: 1 });

	// Every line still reaches the caller unchanged; the record keeps the last one as what the ship is doing now.
	const trackedProgress: ProgressSink = (message) => {
		onProgress?.(message);
		recorder.noteProgress({ message });
	};

	trackedProgress(`ship: ${branch} → ${defaultBranch}, ticket ${ticket.ticket}`);

	const branchDiff = await readBranchDiff({ cwd, defaultBranch });
	const attempt = { cwd, settings, integration, branch, defaultBranch, ticket, branchDiff, recorder, onProgress: trackedProgress };
	let outcome = await runShipAttempt(attempt);

	for (let spent = 1; spent < maxAttempts && outcome.retryable; spent += 1) {
		trackedProgress(`ship: attempt ${spent} did not merge — refreshing and trying again (${spent + 1} of ${maxAttempts})`);
		recorder.beginAttempt({ attempt: spent + 1 });
		outcome = await runShipAttempt({ ...attempt, ciEvidence: outcome.ciEvidence });
	}

	if (outcome.result.status === ShipStatus.Shipped) {
		recorder.startStep({ step: ShippingStepId.Sync });
		await syncDefaultBranch({ cwd, defaultBranch, branch, onProgress: trackedProgress });
		// Passed whatever the cleanup met: a sync that did not work is a progress line, never a failed ship.
		recorder.finishStep({ step: ShippingStepId.Sync, passed: true });
	}

	const result = await record({ cwd, onProgress: trackedProgress, result: outcome.result });

	await recorder.end();

	return result;
};
