import { runPreflightGate } from '#src/common/utils/runPreflightGate.ts';
import { type LightsoutConfig, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { closeRefactorRun } from '#src/refactor/closeRefactorRun.ts';
import { countByRule } from '#src/refactor/countByRule.ts';
import { initializeRun } from '#src/refactor/initializeRun.ts';
import type { RefactorResult } from '#src/refactor/RefactorResult.ts';
import { RefactorRun } from '#src/refactor/RefactorRun.ts';
import { runWorklistBatches } from '#src/refactor/runWorklistBatches.ts';
import { seedResumeState } from '#src/refactor/seedResumeState.ts';
import { withRunLock } from '#src/runState/index.ts';
import { resolveStandards } from '#src/standards/index.ts';
import { resolveStandardsPacks } from '#src/standardsPacks/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	config: LightsoutConfig;
	/** Repo-relative check scope (default: the whole repo). */
	path?: string;
	/** Include baselined findings — burn-down mode. */
	all?: boolean;
	/** Stop (parked, resumable) after this many batches — budget control. */
	maxBatches?: number;
	/** false skips each batch's agent review of the judgment rules — code-checks-only mode. */
	agentReview?: boolean;
	/** Accept a dirty tree: the standing dirt is recorded as baseline, never attributed to a batch. */
	allowDirty?: boolean;
	/** Resume: an existing manifest — batches already passed are skipped. */
	existing?: RunManifest;
	onProgress?: (message: string) => void;
}

/**
 * The refactor pipeline body — always entered holding the run lock (the
 * exported wrapper acquires and releases it). Pre-flight green gate →
 * serial batches (invoke → verify with gate-kind routing → re-check →
 * resolved/declined) → final whole-scope re-check for the burn-down. Every
 * state transition persists before the next action; rate limits park, a
 * budget ceiling parks, three consecutive declines stop the run as systemic.
 * The engine never commits and never baselines — the run ends with changes
 * in the working tree and declines recommended for human review.
 */
const executeRefactor = async ({
	cwd,
	runId,
	driver,
	config,
	path,
	all,
	maxBatches,
	agentReview = true,
	allowDirty,
	existing,
	onProgress,
}: Params & { runId: string }): Promise<RefactorResult> => {
	const { manifest, worklist } = await initializeRun({ cwd, runId, driver, config, path, all, allowDirty, existing });
	// Declines and the systemic streak survive park/resume boundaries — they
	// are rebuilt from persisted step reports, never process memory.
	const seeded = seedResumeState({ manifest, batches: worklist.batches });
	const before = countByRule({ findings: worklist.batches.flatMap((batch) => batch.blocking) });
	const run = new RefactorRun({ cwd, config, manifest, onProgress, declined: seeded.declined, before });

	await run.update({ patch: { status: RunStatus.Running } });

	if (worklist.batches.length === 0) {
		await run.update({ patch: { status: RunStatus.Passed, currentStep: null } });
		run.progress('refactor: no findings in scope — nothing to do');

		return { ok: true, manifest: run.current(), declined: run.declined, before: run.before, after: run.before };
	}

	const redBaseline = await runPreflightGate({
		run,
		coverage: true,
		label: 'pre-flight — full gates before any batch',
		redBaselineError: 'Codebase is not green before refactoring — fix this first.',
	});

	if (redBaseline) {
		return redBaseline;
	}

	// A refactor run has no package scope of its own, so channels come from the
	// repo root manifest.
	const { standards, testStandards, channels } = await resolveStandards({ cwd, config, packages: [] });
	// Resolved once for the whole run: every batch's agent review reads the same
	// judgment rules, and re-walking the pack tree per batch would only invite
	// two batches to disagree about what the standards are.
	const packs = await resolveStandardsPacks({ cwd, config });

	if (!agentReview) {
		run.progress('code checks only — the per-batch agent review is off for this run');
	}

	const halted = await runWorklistBatches({
		run,
		driver,
		worklist,
		batchInputs: { packs, channels, standards, testStandards, agentReview },
		maxBatches,
		declineStreak: seeded.declineStreak,
	});

	if (halted) {
		return halted;
	}

	return closeRefactorRun({ run, worklist });
};

/**
 * Public entry: the shared run-lock lifecycle around the body — an implement
 * run and a refactor run take the same repo lock, so they can never race one
 * tree.
 */
export const runRefactorPipeline = (params: Params): Promise<RefactorResult> => withRunLock({ params, run: executeRefactor });
