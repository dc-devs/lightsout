import { type RefactorWorklist, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runBatch } from '#src/refactor/batch/index.ts';
import type { RefactorResult } from '#src/refactor/RefactorResult.ts';
import type { RefactorRun } from '#src/refactor/RefactorRun.ts';
import { settleBatchOutcome } from '#src/refactor/settleBatchOutcome.ts';

interface Params {
	run: RefactorRun;
	driver: Driver;
	worklist: RefactorWorklist;
	/** Per-run inputs every batch shares, forwarded to runBatch unchanged. */
	batchInputs: Pick<Parameters<typeof runBatch>[0], 'packs' | 'channels' | 'standards' | 'testStandards' | 'agentReview'>;
	/** Stop (parked, resumable) after this many batches this run — budget control. */
	maxBatches?: number;
	/** Consecutive declines carried in from persisted steps on resume. */
	declineStreak: number;
}

/**
 * Walk the frozen worklist's batches serially, skipping the ones a previous
 * attempt already passed. Each batch is invoked, verified and settled before
 * the next begins, so the run's state on disk is truthful at every boundary.
 *
 * @returns the run-ending result when a batch parks, fails, escalates or hits
 *   the budget ceiling, undefined when the whole worklist is processed
 */
export const runWorklistBatches = async ({ run, driver, worklist, batchInputs, maxBatches, declineStreak }: Params): Promise<RefactorResult | undefined> => {
	let streak = declineStreak;
	let processed = 0;
	let result: RefactorResult | undefined;

	for (const batch of worklist.batches) {
		const prior = run.current().steps.find((step) => step.id === batch.id);

		if (prior?.status === RunStatus.Passed) {
			continue;
		}

		if (maxBatches !== undefined && processed >= maxBatches) {
			await run.update({ patch: { status: RunStatus.PausedBudget, currentStep: null } });
			run.progress(`budget ceiling (${maxBatches} batch(es)) reached — resume with: lightsout refactor --run ${run.current().runId}`);
			result = run.buildHaltedResult({ error: `paused at --max-batches ${maxBatches} — resume with: lightsout refactor --run ${run.current().runId}` });

			break;
		}

		const record: StepRecord = { id: batch.id, status: RunStatus.Running, attempts: (prior?.attempts ?? 0) + 1 };

		await run.setStep({ record });
		run.progress(`${batch.id} — ${batch.blocking.length} blocking`);

		const outcome = await runBatch({
			...batchInputs,
			cwd: run.cwd,
			runId: run.current().runId,
			driver,
			config: run.config,
			batch,
			checkPath: worklist.path === '.' ? undefined : worklist.path,
			checkAll: worklist.all,
			agentTimeoutMs: run.agentTimeoutMs,
			// The baseline dirt rides along: files dirty before the run started are
			// no batch's doing, however git sees the union.
			attributedFiles: [...run.current().changedFiles, ...run.current().baselineDirtyFiles],
			onProgress: (message) => run.progress(message),
			recordUsage: (entry) => run.recordUsage(entry),
		});

		processed += 1;

		const settled = await settleBatchOutcome({ run, batch, record, outcome, declineStreak: streak });

		streak = settled.declineStreak;

		if (settled.result) {
			result = settled.result;

			break;
		}
	}

	return result;
};
