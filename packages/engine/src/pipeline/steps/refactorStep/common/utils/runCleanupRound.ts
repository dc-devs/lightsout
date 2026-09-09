import { CleanupEndReason, type StandardsFinding } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import type { CleanupContext } from '#src/pipeline/steps/refactorStep/common/types/CleanupContext.ts';
import type { CleanupState } from '#src/pipeline/steps/refactorStep/common/types/CleanupState.ts';
import { buildCleanupRecord } from '#src/pipeline/steps/refactorStep/common/utils/buildCleanupRecord.ts';
import { runExecutorPass } from '#src/pipeline/steps/refactorStep/common/utils/runExecutorPass.ts';

/**
 * Whether the tree looks exactly as it did after the previous round.
 *
 * Both lists are measured against the same step-start fingerprint, so a round
 * that touched nothing answers the identical set its predecessor did — and a
 * round that put a file back the way it found it drops that file out again.
 */
const sameEdits = ({ before, after }: { before: string[]; after: string[] }) =>
	before.length === after.length && [...before].sort().join('\n') === [...after].sort().join('\n');

/**
 * Where a round that changed nothing leaves the loop. A work list the agent
 * declines twice running is a stable disagreement — the agent has judged, the
 * checks cannot hear judgment, and another round only re-buys the same answer.
 * Checked before the budget, so a work list declined twice on the round that
 * also spends the last of the budget is recorded as the more specific fact.
 */
const foldDecline = ({ context, state, findings, round }: { context: CleanupContext; state: CleanupState; findings: StandardsFinding[]; round: number }) => {
	const declined = findings
		.map((finding) => finding.siteKey)
		.sort()
		.join('\n');

	if (declined === state.lastDeclined) {
		state.endReason = CleanupEndReason.DeclinedTwice;
		context.run.progress(`refactor round ${round}: the cleanup agent declined the same work list twice — no further round is bought`);

		return;
	}

	state.lastDeclined = declined;
	context.run.progress(`refactor round ${round}: no changes but ${findings.length} qualifying blocking finding(s) remain — another round`);
	state.record = { ...state.record, attempts: state.record.attempts + 1 };
};

interface Params {
	context: CleanupContext;
	state: CleanupState;
	/** The qualifying blocking work list this round hands the executor. */
	findings: StandardsFinding[];
	/** Judgment-carrying findings the executor weighs but is never held on — the first round only. */
	advisories: StandardsFinding[];
}

/**
 * One cleanup round, folded into the run's cleanup account.
 *
 * Returns the park result when the harness rate limited the invocation, and
 * `undefined` in every other case — including a failed one, because cleanup is
 * best-effort tidying and a broken agent is recorded rather than terminal. A
 * park spends no round: the resume re-invokes that same one.
 */
export const runCleanupRound = async ({ context, state, findings, advisories }: Params): Promise<PipelineResult | undefined> => {
	const { run, gitPrefix, planContent, overviewContent, standards, before, budget } = context;
	const round = state.roundsUsed + 1;
	const record = buildCleanupRecord({ context, state });

	await run.setStep({ record });
	run.progress(`step refactor — round ${round}/${budget}`);

	const executed = await runExecutorPass({ run, gitPrefix, planContent, overviewContent, standards, record, findings, advisories, before });

	if ('parked' in executed) {
		return executed.parked;
	}

	const changed = !sameEdits({ before: state.edited, after: executed.edited });

	state.roundsUsed = round;
	state.record = executed.record;
	state.lastReport = executed.report ?? state.lastReport;
	state.edited = executed.edited;

	if (executed.failure !== undefined) {
		state.failures = [...state.failures, executed.failure];
		state.endReason = CleanupEndReason.AgentFailed;
		run.progress(`refactor round ${round}: the cleanup agent could not finish — ${executed.failure}`);
	} else if (changed) {
		state.lastDeclined = undefined;
		run.progress(`refactor round ${round}: ${executed.edited.length} changed file(s)`);
		state.record = { ...state.record, attempts: state.record.attempts + 1 };
	} else {
		foldDecline({ context, state, findings, round });
	}

	return undefined;
};
