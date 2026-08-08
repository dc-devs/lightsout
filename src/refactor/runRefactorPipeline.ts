import {
	BatchOutcome,
	BatchReport,
	RunStatus,
	StandardsSeverity,
	type AgentUsage,
	type LightsoutConfig,
	type RunManifest,
	type StepRecord,
} from '@/contracts';
import type { Driver } from '@/drivers';
import { runGates } from '@/pipeline';
import { recordAgentUsage, seedUsageTotals, withRunLock, writeManifestWithUsage } from '@/runState';
import { runStandardsCheck } from '@/standardsCheck';
import { resolveStandards } from '@/standards';
import { countByRule } from '@/refactor/countByRule';
import { initializeRun } from '@/refactor/initializeRun';
import { seedResumeState } from '@/refactor/seedResumeState';
import { runBatch } from '@/refactor/runBatch';
import type { RefactorResult } from '@/refactor/RefactorResult';

const defaultAgentTimeoutMinutes = 60;
const maxConsecutiveDeclines = 3;

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
	existing,
	onProgress,
}: Params & { runId: string }): Promise<RefactorResult> => {
	const progress = onProgress ?? (() => undefined);

	const initialized = await initializeRun({ cwd, runId, driver, config, path, all, existing });
	const { worklist } = initialized;
	let { manifest } = initialized;

	const usageTotals = seedUsageTotals({ usage: manifest.usage });

	const update = async (patch: Partial<RunManifest>) => {
		manifest = await writeManifestWithUsage({ cwd, manifest, patch, usageTotals });
	};

	const recordUsage = ({ step, usage }: { step: string; usage?: AgentUsage }) =>
		recordAgentUsage({ cwd, runId: manifest.runId, step, model: config.model, effort: config.effort, totals: usageTotals, usage });

	const setStep = async ({ record, patch }: { record: StepRecord; patch?: Partial<RunManifest> }) => {
		const steps = manifest.steps.some((step) => step.id === record.id)
			? manifest.steps.map((step) => (step.id === record.id ? record : step))
			: [...manifest.steps, record];

		await update({ ...patch, currentStep: record.id, steps });
	};

	// Declines and the systemic streak survive park/resume boundaries — they
	// are rebuilt from persisted step reports, never process memory.
	const seeded = seedResumeState({ manifest, batches: worklist.batches });
	const declined = seeded.declined;
	const before = countByRule({ findings: worklist.batches.flatMap((batch) => batch.findings) });

	const stop = async ({ record, status, error }: { record: StepRecord; status: RunStatus; error: string }): Promise<RefactorResult> => {
		await setStep({ record: { ...record, status, error }, patch: { status } });
		progress(`refactor run stopped at ${record.id} — ${status}`);

		return { ok: false, manifest, error, declined, before, after: before };
	};

	await update({ status: RunStatus.Running });

	if (worklist.batches.length === 0) {
		await update({ status: RunStatus.Passed, currentStep: null });
		progress('refactor: no findings in scope — nothing to do');

		return { ok: true, manifest, declined, before, after: before };
	}

	// Pre-flight green gate: a red gate after a batch can only mean "the
	// batch's doing" if the baseline was green.
	if (!manifest.steps.some((step) => step.id === 'pre-flight' && step.status === RunStatus.Passed)) {
		const record: StepRecord = {
			id: 'pre-flight',
			status: RunStatus.Running,
			attempts: (manifest.steps.find((step) => step.id === 'pre-flight')?.attempts ?? 0) + 1,
		};

		await setStep({ record });
		progress('pre-flight — full gates before any batch');

		const gateError = await runGates({ cwd, config, coverage: true, runId: manifest.runId, step: 'pre-flight', onProgress });

		if (gateError) {
			return stop({ record, status: RunStatus.Failed, error: `Codebase is not green before refactoring — fix this first.\n${gateError}` });
		}

		await setStep({ record: { ...record, status: RunStatus.Passed } });
	}

	// A refactor run has no package scope of its own, so channels come from the
	// repo root manifest.
	const { standards, testStandards } = await resolveStandards({ cwd, config, packages: [] });
	const agentTimeoutMs = (config.timeouts?.agentMinutes ?? defaultAgentTimeoutMinutes) * 60_000;

	let declineStreak = seeded.declineStreak;
	let processed = 0;

	for (const batch of worklist.batches) {
		const prior = manifest.steps.find((step) => step.id === batch.id);

		if (prior?.status === RunStatus.Passed) {
			continue;
		}

		if (maxBatches !== undefined && processed >= maxBatches) {
			await update({ status: RunStatus.PausedBudget, currentStep: null });
			progress(`budget ceiling (${maxBatches} batch(es)) reached — resume with: lightsout refactor --run ${manifest.runId}`);

			return { ok: false, manifest, error: `paused at --max-batches ${maxBatches} — resume with: lightsout refactor --run ${manifest.runId}`, declined, before, after: before };
		}

		const record: StepRecord = { id: batch.id, status: RunStatus.Running, attempts: (prior?.attempts ?? 0) + 1 };

		await setStep({ record });
		progress(`${batch.id} — ${batch.findings.length} finding(s)`);

		const outcome = await runBatch({
			cwd,
			runId: manifest.runId,
			driver,
			config,
			batch,
			checkPath: worklist.path === '.' ? undefined : worklist.path,
			checkAll: worklist.all,
			standards,
			testStandards,
			agentTimeoutMs,
			attributedFiles: manifest.changedFiles,
			onProgress: progress,
			recordUsage,
		});

		processed += 1;

		if (outcome.kind === 'parked') {
			return stop({
				record,
				status: RunStatus.PausedRateLimit,
				error: `run parked: harness rate limit reached — resume with \`lightsout refactor --run ${manifest.runId}\` when the window resets.`,
			});
		}

		if (outcome.kind === 'failed' || outcome.kind === 'escalated') {
			return stop({ record, status: outcome.kind === 'failed' ? RunStatus.Failed : RunStatus.Escalated, error: outcome.error });
		}

		const report = BatchReport.parse(outcome.report);

		await setStep({
			record: { ...record, status: RunStatus.Passed, report, changedFiles: outcome.changedFiles },
			patch: { changedFiles: [...new Set([...manifest.changedFiles, ...outcome.changedFiles])] },
		});

		if (report.outcome === BatchOutcome.Declined) {
			declined.push({ batchId: batch.id, remainingSiteKeys: report.remainingSiteKeys, rationale: report.rationale });
			declineStreak += 1;
			progress(`${batch.id}: declined (${report.remainingSiteKeys.length} site(s) persist)`);

			if (declineStreak >= maxConsecutiveDeclines) {
				// The batch's Passed record (outcome + files) is already written —
				// only the RUN escalates, so resume never re-spends on it.
				const error = `${maxConsecutiveDeclines} consecutive batches declined — likely systemic (standards injection, gate config, or a rule bug), not worth further agent spend.`;

				await update({ status: RunStatus.Escalated, currentStep: null });
				progress(`refactor run stopped after ${batch.id} — ${RunStatus.Escalated}`);

				return { ok: false, manifest, error, declined, before, after: before };
			}

			continue;
		}

		declineStreak = 0;
		progress(`${batch.id}: resolved`);
	}

	const finalCheck = await runStandardsCheck({ cwd, path: worklist.path === '.' ? undefined : worklist.path, all: worklist.all, persist: false });

	await update({ status: RunStatus.Passed, currentStep: null });

	// Finding severity only, mirroring the worklist filter — the burn-down
	// compares work against work, never advisories.
	return { ok: true, manifest, declined, before, after: countByRule({ findings: finalCheck.findings.filter((finding) => finding.severity === StandardsSeverity.Finding) }) };
};

/**
 * Public entry: the shared run-lock lifecycle around the body — an implement
 * run and a refactor run take the same repo lock, so they can never race one
 * tree.
 */
export const runRefactorPipeline = (params: Params): Promise<RefactorResult> => withRunLock({ params, run: executeRefactor });
