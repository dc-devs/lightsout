import { defaultRefactorMaxRounds } from '#src/common/constants/defaultRefactorMaxRounds.ts';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';
import { CleanupEndReason, type RefactorStepReport, RunStatus, type StandardsFinding } from '#src/contracts/index.ts';
import { sourceFiles } from '#src/pipeline/common/utils/sourceFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';
import type { CleanupContext } from '#src/pipeline/steps/refactorStep/common/types/CleanupContext.ts';
import type { CleanupState } from '#src/pipeline/steps/refactorStep/common/types/CleanupState.ts';
import { buildCleanupRecord } from '#src/pipeline/steps/refactorStep/common/utils/buildCleanupRecord.ts';
import { describePersistingFindings } from '#src/pipeline/steps/refactorStep/common/utils/describePersistingFindings.ts';
import { fingerprintScopeFiles } from '#src/pipeline/steps/refactorStep/common/utils/fingerprintScopeFiles.ts';
import { readPriorCleanup } from '#src/pipeline/steps/refactorStep/common/utils/readPriorCleanup.ts';
import { reviewAdvisories } from '#src/pipeline/steps/refactorStep/common/utils/reviewAdvisories.ts';
import { runCleanupRound } from '#src/pipeline/steps/refactorStep/common/utils/runCleanupRound.ts';
import { standardsWorkList } from '#src/pipeline/steps/refactorStep/common/utils/standardsWorkList.ts';
import { readRunStandardsBaseline } from '#src/runState/index.ts';
import { resolveStandardsChannels } from '#src/standards/index.ts';
import { resolveStandardsPacks } from '#src/standardsPacks/index.ts';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	/** Overview text for a phased run — see `buildRefactorExecutorInvocation`. */
	overviewContent?: string;
	standards?: string;
}

/**
 * Everything cleanup reads once, before it can spend anything: the rules both
 * reviews judge by, the pre-edit comparison point, the round budget, the tree
 * as it stands now, and the judgment reviewer's opening read.
 *
 * A resume reuses the recorded initial review rather than buying a second one —
 * it describes code the resume has not changed — and re-runs only the
 * deterministic check.
 */
const buildCleanupContext = async ({ run, gitPrefix, planContent, overviewContent, standards, prior }: Params & { prior: RefactorStepReport | undefined }) => {
	const packs = await resolveStandardsPacks({ cwd: run.cwd, config: run.config });
	const channels = await resolveStandardsChannels({ cwd: run.cwd, config: run.config, packages: run.current().packages });
	const baseline = await readRunStandardsBaseline({ cwd: run.cwd, runId: run.current().runId });

	return {
		run,
		gitPrefix,
		planContent,
		overviewContent,
		standards,
		packs,
		channels,
		baseline: baseline?.findings,
		budget: run.config.implement?.refactor?.['max-rounds'] ?? defaultRefactorMaxRounds,
		before: await fingerprintScopeFiles({ run }),
		initialReview: prior?.initialReview ?? (await reviewAdvisories({ run, packs, channels, files: sourceFiles({ run }) })),
	};
};

/** What the deterministic checks and the opening review between them are asking of this round, narrated for a watching human. */
const narrateGate = ({ run, workList, advisories }: { run: PipelineRun; workList: StandardsFinding[]; advisories: StandardsFinding[] }) => {
	if (workList.length > 0 || advisories.length > 0) {
		run.progress(`standards gate: ${workList.length} blocking + ${advisories.length} advisory on changed files`);
	}
};

/**
 * Spend rounds while a qualifying deterministic blocking finding still stands.
 *
 * The first round may also be earned by advisories — the deterministic ones the
 * run introduced, plus the judgment reviewer's opening read. Every later round
 * is earned only by qualifying blocking work, so the opening advisory pass is
 * never replayed as an open-ended tidy.
 */
const runCleanupRounds = async ({ context, state }: { context: CleanupContext; state: CleanupState }) => {
	while (state.endReason === undefined) {
		const check = await standardsWorkList({ run: context.run, baseline: context.baseline });
		const advisories = state.roundsUsed === 0 ? [...check.advisories, ...context.initialReview] : [];

		state.remaining = check.workList;
		state.inherited = check.inherited;
		state.uncertain = check.uncertain;
		narrateGate({ run: context.run, workList: check.workList, advisories });

		if (check.workList.length === 0 && advisories.length === 0) {
			state.endReason = state.roundsUsed === 0 ? CleanupEndReason.NoWork : CleanupEndReason.Clean;
		} else if (state.roundsUsed >= context.budget) {
			state.endReason = CleanupEndReason.BudgetExhausted;
		} else {
			const parked = await runCleanupRound({ context, state, findings: check.workList, advisories });

			if (parked) {
				return parked;
			}
		}
	}

	return undefined;
};

/**
 * What cleanup leaves behind, recorded rather than escalated: a truthful
 * re-check where the last round edited without being re-checked, the judgment
 * reviewer's read of the files cleanup actually changed, and the narration of
 * anything still standing.
 *
 * The final review is scoped by the same non-test filter the opening review's
 * `sourceFiles` applies, so both reads see the same kind of file. Cleanup that
 * changed nothing is not reviewed twice — the opening read stands as the final
 * one — and neither review ever buys a round.
 */
const finishCleanup = async ({ context, state }: { context: CleanupContext; state: CleanupState }) => {
	const { run, packs, channels } = context;

	if (state.endReason === CleanupEndReason.AgentFailed) {
		state.remaining = (await standardsWorkList({ run, baseline: context.baseline })).workList;
	}

	const reviewed = state.edited.filter((file) => !isTestFile({ path: file }));

	state.finalReview = reviewed.length === 0 ? context.initialReview : await reviewAdvisories({ run, packs, channels, files: reviewed });

	if (state.remaining.length > 0) {
		state.narration = describePersistingFindings({ findings: state.remaining, report: state.lastReport, roundsUsed: state.roundsUsed });
		run.progress(state.narration);
	}

	await run.setStep({ record: { ...buildCleanupRecord({ context, state }), status: RunStatus.Passed } });
	run.progress(`step refactor passed — cleanup ended: ${state.endReason}`);
};

/**
 * Bounded, non-blocking implementation cleanup.
 *
 * A round is bought only while a deterministic blocking finding this run's own
 * edits introduced or measurably worsened is still standing — pre-existing
 * debt, findings whose provenance cannot be established and the judgment
 * reviewer's opinions are recorded and handed forward, never converted into
 * work. Cleanup ends for one of five named reasons, whatever it leaves behind
 * is written to the step record's typed report, and the run always carries on
 * to the formatter and normal verification: no branch of this step stops it.
 *
 * A harness rate limit still parks the run, exactly as every other step does.
 * The recorded round count and the baseline survive the park, so the resume
 * continues rather than restarts.
 */
export const refactorStep = ({ run, gitPrefix, planContent, overviewContent, standards }: Params): PipelineStep['run'] => {
	return async () => {
		const record = run.nextRecord({ id: 'refactor' });
		const prior = readPriorCleanup({ run });
		const context = await buildCleanupContext({ run, gitPrefix, planContent, overviewContent, standards, prior });
		const state: CleanupState = {
			record,
			roundsUsed: prior?.roundsUsed ?? 0,
			edited: [],
			failures: prior?.failures ?? [],
			remaining: [],
			inherited: [],
			uncertain: [],
			finalReview: [],
		};

		const parked = await runCleanupRounds({ context, state });

		if (parked) {
			return parked;
		}

		await finishCleanup({ context, state });

		return undefined;
	};
};
