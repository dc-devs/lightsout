import { buildUnitTestWriterInvocation } from '#src/agents/index.ts';
import type { AgentUsage, LightsoutConfig } from '#src/contracts/index.ts';
import { invokeCoverageAgent } from '#src/coverage/batch/invokeCoverageAgent.ts';
import type { CoverageBatch } from '#src/coverage/common/types/CoverageBatch.ts';
import type { Driver } from '#src/drivers/index.ts';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	batch: CoverageBatch;
	/** Consumer test standards, inlined into the writer's system prompt. */
	testStandards?: string;
	agentTimeoutMs: number;
	/** Mutable batch-level collectors: every invocation the batch spends folds its paths and friction into these. */
	reportedFiles: Set<string>;
	rationale: string[];
	/** Run-wide usage recorder (appends to agents.jsonl and totals). */
	recordUsage: (params: { step: string; usage?: AgentUsage }) => Promise<void>;
}

/**
 * The one way a coverage batch spends an invocation. The writer's assignment is
 * identical on every attempt — the batch's members, tested through themselves —
 * and only the gate output that sent the work back differs, so the caller
 * supplies a label and, on a fix, that output.
 *
 * Created once per batch because the invocation count it keeps names the
 * evidence files: two counters would overwrite each other's streams.
 */
export const createCoverageInvoker = ({
	cwd,
	runId,
	driver,
	config,
	batch,
	testStandards,
	agentTimeoutMs,
	reportedFiles,
	rationale,
	recordUsage,
}: Params): ((params: { label: string; errorContext?: string }) => ReturnType<typeof invokeCoverageAgent>) => {
	let invocationCount = 0;

	return ({ label, errorContext }) => {
		const standaloneBanner =
			"Standalone coverage run — there is no feature plan. The files listed below are import-connected groups containing the run's current worst-covered files; raise their unit-test coverage. Change no source file: tests are the only deliverable.";

		invocationCount += 1;

		return invokeCoverageAgent({
			cwd,
			runId,
			driver,
			config,
			batchId: batch.id,
			invocation: buildUnitTestWriterInvocation({
				planContent: standaloneBanner,
				subjects: batch.members,
				mustExecute: batch.members,
				standards: testStandards,
				errorContext,
			}),
			label,
			invocationCount,
			agentTimeoutMs,
			reportedFiles,
			rationale,
			recordUsage,
		});
	};
};
