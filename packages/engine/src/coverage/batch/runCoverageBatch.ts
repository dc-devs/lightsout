import { type AgentUsage, BatchOutcome, type CoverageBatchReport, type LightsoutConfig } from '#src/contracts/index.ts';
import { checkTestsOnly } from '#src/coverage/batch/checkTestsOnly.ts';
import { createCoverageInvoker } from '#src/coverage/batch/createCoverageInvoker.ts';
import { getCoverageAttemptStop } from '#src/coverage/batch/getCoverageAttemptStop.ts';
import { measureCoverageBatch } from '#src/coverage/batch/measureCoverageBatch.ts';
import { settleCoverageGates } from '#src/coverage/batch/settleCoverageGates.ts';
import { CoverageBatchStopKind } from '#src/coverage/common/constants/CoverageBatchStopKind.ts';
import type { CoverageBatch } from '#src/coverage/common/types/CoverageBatch.ts';
import type { CoverageBatchStop } from '#src/coverage/common/types/CoverageBatchStop.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runBatchGates } from '#src/gates/index.ts';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	batch: CoverageBatch;
	/** Consumer test standards, inlined into the writer's system prompt. */
	testStandards?: string;
	agentTimeoutMs: number;
	/** Files earlier steps already attributed — excluded from this batch's git-truth merge. */
	attributedFiles: string[];
	onProgress: (message: string) => void;
	/** Run-wide usage recorder (appends to agents.jsonl and totals). */
	recordUsage: (params: { step: string; usage?: AgentUsage }) => Promise<void>;
}

/**
 * Execute one coverage batch to a terminal condition: invoke the unit-test
 * writer on the batch's components, read what its answer already settles, then
 * drive the scoped gates to green (coverage off — it is red by definition
 * mid-run) and re-measure the batch's scope. Any tracked file whose statements
 * percentage strictly improved resolves the batch; none improving declines it.
 */
export const runCoverageBatch = async ({
	cwd,
	runId,
	driver,
	config,
	batch,
	testStandards,
	agentTimeoutMs,
	attributedFiles,
	onProgress,
	recordUsage,
}: Params): Promise<CoverageBatchStop> => {
	const rationale: string[] = [];
	const reportedFiles = new Set<string>();
	// Kept by testsOnly, read by finish — the two are the batch's only writer
	// and only reader of what it changed.
	let changedFiles: string[] = [];
	const invoke = createCoverageInvoker({ cwd, runId, driver, config, batch, testStandards, agentTimeoutMs, reportedFiles, rationale, recordUsage });

	// Coverage stays OFF: this run exists because that gate is red.
	const gates = () => runBatchGates({ cwd, config, coverage: false, runId, step: batch.id, onProgress });

	/** The tests-only verdict, keeping the files it observed for whatever ends the batch. */
	const testsOnly = async () => {
		const checked = await checkTestsOnly({ cwd, config, batchId: batch.id, reportedFiles, attributedFiles });

		changedFiles = checked.changedFiles;

		return checked.error;
	};

	const measure = () => measureCoverageBatch({ cwd, config, runId, batch });

	/**
	 * Every classified end of the batch goes through here, so no branch can
	 * report an outcome without the files the last tests-only pass observed.
	 */
	const finish = ({ outcome, files }: { outcome: BatchOutcome; files: CoverageBatchReport['files'] }): CoverageBatchStop => ({
		kind: CoverageBatchStopKind.Done,
		report: { outcome, files, rationale },
		changedFiles,
	});

	const attempt = await invoke({ label: '' });
	let stop = await getCoverageAttemptStop({ batchId: batch.id, batch, attempt, rationale, onProgress, testsOnly, measure, gates, finish });

	if (stop === undefined) {
		stop = await settleCoverageGates({ batchId: batch.id, onProgress, invokeFix: invoke, testsOnly, gates });
	}

	if (stop === undefined) {
		const measured = await measure();

		stop = finish({ outcome: measured.improved ? BatchOutcome.Resolved : BatchOutcome.Declined, files: measured.files });
	}

	return stop;
};
