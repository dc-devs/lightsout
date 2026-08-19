import { type LightsoutConfig, type RunManifest, RunStatus, StandardsSeverity } from '@/contracts';
import type { Driver } from '@/drivers';
import { countByRule } from '@/refactor/countByRule';
import { initializeRun } from '@/refactor/initializeRun';
import type { RefactorResult } from '@/refactor/RefactorResult';
import { RefactorRun } from '@/refactor/RefactorRun';
import { runPreflightGate } from '@/refactor/runPreflightGate';
import { runWorklistBatches } from '@/refactor/runWorklistBatches';
import { seedResumeState } from '@/refactor/seedResumeState';
import { withRunLock } from '@/runState';
import { resolveStandards } from '@/standards';
import { runStandardsCheck } from '@/standardsCheck';
import { resolveStandardsPackages } from '@/standardsPackages';

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

	await run.update({ status: RunStatus.Running });

	if (worklist.batches.length === 0) {
		await run.update({ status: RunStatus.Passed, currentStep: null });
		run.progress('refactor: no findings in scope — nothing to do');

		return { ok: true, manifest: run.current(), declined: run.declined, before: run.before, after: run.before };
	}

	const redBaseline = await runPreflightGate({ run });

	if (redBaseline) {
		return redBaseline;
	}

	// A refactor run has no package scope of its own, so channels come from the
	// repo root manifest.
	const { standards, testStandards, channels } = await resolveStandards({ cwd, config, packages: [] });
	// Resolved once for the whole run: every batch's agent review reads the same
	// judgment rules, and re-walking the package tree per batch would only invite
	// two batches to disagree about what the standards are.
	const packages = await resolveStandardsPackages({ cwd, config });

	if (!agentReview) {
		run.progress('code checks only — the per-batch agent review is off for this run');
	}

	const halted = await runWorklistBatches({
		run,
		driver,
		worklist,
		batchInputs: { packages, channels, standards, testStandards, agentReview },
		maxBatches,
		declineStreak: seeded.declineStreak,
	});

	if (halted) {
		return halted;
	}

	const finalCheck = await runStandardsCheck({ cwd, path: worklist.path === '.' ? undefined : worklist.path, all: worklist.all, persist: false });

	await run.update({ status: RunStatus.Passed, currentStep: null });

	// Finding severity only, mirroring the worklist filter — the burn-down
	// compares work against work, never advisories.
	return {
		ok: true,
		manifest: run.current(),
		declined: run.declined,
		before: run.before,
		after: countByRule({ findings: finalCheck.findings.filter((finding) => finding.severity === StandardsSeverity.Blocking) }),
	};
};

/**
 * Public entry: the shared run-lock lifecycle around the body — an implement
 * run and a refactor run take the same repo lock, so they can never race one
 * tree.
 */
export const runRefactorPipeline = (params: Params): Promise<RefactorResult> => withRunLock({ params, run: executeRefactor });
