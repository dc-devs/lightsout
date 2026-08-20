import { buildRefactorExecutorInvocation } from '#src/agents/index.ts';
import { collectBatchChanges } from '#src/common/utils/collectBatchChanges.ts';
import { type AdvisoryOutcome, type AgentUsage, BatchOutcome, type LightsoutConfig, type RefactorBatch, type StandardsFinding } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runBatchGates } from '#src/pipeline/index.ts';
import { buildBatchFixInvocation } from '#src/refactor/buildBatchFixInvocation.ts';
import { buildBatchReport } from '#src/refactor/buildBatchReport.ts';
import { collectBatchAdvisories } from '#src/refactor/collectBatchAdvisories.ts';
import { BatchStopKind } from '#src/refactor/common/constants/BatchStopKind.ts';
import type { BatchStop } from '#src/refactor/common/types/BatchStop.ts';
import { getAttemptStop } from '#src/refactor/getAttemptStop.ts';
import { invokeBatchAgent } from '#src/refactor/invokeBatchAgent.ts';
import { matchRemainingFindings } from '#src/refactor/matchRemainingFindings.ts';
import { settleBatchGates } from '#src/refactor/settleBatchGates.ts';
import { runStandardsCheck } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPackage } from '#src/standardsPackages/index.ts';

const standaloneBanner =
	'Standalone refactor run — there is no feature plan. The standards findings below are the entire work-list; nothing else about the repo is being changed.';

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	batch: RefactorBatch;
	/** The run's standards packages, resolved once by the pipeline — the judgment rules the agent review reads come from here. */
	packages: LoadedStandardsPackage[];
	/** Active framework channels, resolved once by the pipeline. */
	channels: string[];
	/** Check scope of the run's worklist, threaded into the per-batch re-check. */
	checkPath?: string;
	/** Include baselined findings in re-checks — must match the worklist's mode. */
	checkAll: boolean;
	/** false skips this batch's agent review — code-checks-only mode. */
	agentReview: boolean;
	standards?: string;
	testStandards?: string;
	agentTimeoutMs: number;
	/** Files earlier steps already attributed — excluded from this batch's git-truth merge. */
	attributedFiles: string[];
	onProgress: (message: string) => void;
	/** Run-wide usage recorder (appends to agents.jsonl and totals). */
	recordUsage: (params: { step: string; usage?: AgentUsage }) => Promise<void>;
}

/**
 * Execute one batch to a terminal condition: invoke the refactor executor on
 * the batch's findings, verify with scoped gates (cheap fix retries route by
 * gate kind — a red COVERAGE gate goes to the test writer, everything else
 * back to the refactor executor), then re-check the batch's site keys.
 * Sites gone → resolved; agent changed nothing and sites persist →
 * declined; partial → one re-invocation on the remainder, then whatever
 * persists is declined with the agent's rationale attached.
 */
export const runBatch = async ({
	cwd,
	runId,
	driver,
	config,
	batch,
	packages,
	channels,
	checkPath,
	checkAll,
	agentReview,
	standards,
	testStandards,
	agentTimeoutMs,
	attributedFiles,
	onProgress,
	recordUsage,
}: Params): Promise<BatchStop> => {
	const rationale: string[] = [];
	const reportedFiles = new Set<string>();
	const advisoryOutcomes = new Map<string, AdvisoryOutcome>();
	let invocationCount = 0;

	const invoke = ({ label, invocation }: { label: string; invocation: { systemPrompt: string; prompt: string } }) => {
		invocationCount += 1;

		return invokeBatchAgent({
			cwd,
			runId,
			driver,
			config,
			batch,
			invocation,
			label,
			invocationCount,
			agentTimeoutMs,
			reportedFiles,
			rationale,
			advisoryOutcomes,
			recordUsage,
		});
	};

	const reportOf = ({ outcome, remainingSiteKeys }: { outcome: BatchOutcome; remainingSiteKeys: string[] }) =>
		buildBatchReport({ outcome, remainingSiteKeys, rationale, advisoryOutcomes: [...advisoryOutcomes.values()] });

	/** Every classified end of the batch goes through here, so no branch can report an outcome without the files it changed. */
	const finish = async ({ outcome, remainingSiteKeys }: { outcome: BatchOutcome; remainingSiteKeys: string[] }): Promise<BatchStop> => ({
		kind: BatchStopKind.Done,
		report: reportOf({ outcome, remainingSiteKeys }),
		changedFiles: await collectBatchChanges({ cwd, config, reportedFiles, attributedFiles }),
	});

	// Coverage stays on: a refactor must not drop coverage.
	const gates = () => runBatchGates({ cwd, config, coverage: true, runId, step: batch.id, onProgress });

	const checkLive = () => runStandardsCheck({ cwd, path: checkPath, all: checkAll, persist: false });

	const remainingSiteKeys = async ({ frozen }: { frozen: StandardsFinding[] }) => {
		const { findings } = await checkLive();

		return matchRemainingFindings({ frozen, live: findings });
	};

	// One live check up front serves two purposes: the staleness check (earlier
	// batches may have already eliminated these sites — no agent spent) and
	// FRESH advisories (frozen worklist advisories cite pre-run line numbers).
	const preCheck = await checkLive();

	if (matchRemainingFindings({ frozen: batch.blocking, live: preCheck.findings }).length === 0) {
		onProgress(`${batch.id}: sites already resolved by earlier work — no agent spent`);

		return { kind: BatchStopKind.Done, report: reportOf({ outcome: BatchOutcome.Resolved, remainingSiteKeys: [] }), changedFiles: [] };
	}

	const advisories = await collectBatchAdvisories({
		cwd,
		driver,
		batch,
		packages,
		channels,
		findings: preCheck.findings,
		agentReview,
		timeoutMs: agentTimeoutMs,
		onProgress,
	});

	// Up to two executor passes: the initial batch, then one re-invocation on
	// whatever sites survived a pass that DID change the tree (a partial).
	let workFindings: StandardsFinding[] = batch.blocking;
	let stop: BatchStop | undefined;

	for (let pass = 1; pass <= 2; pass += 1) {
		const files = [...new Set(workFindings.flatMap((finding) => finding.files.map((file) => file.path)))];

		const buildFixInvocation = ({ gateError, guidance }: { gateError: string; guidance?: string }) =>
			buildBatchFixInvocation({ planContent: standaloneBanner, files, standards, testStandards, findings: workFindings, advisories, gateError, guidance });
		const attempt = await invoke({
			label: pass === 1 ? '' : 'requeue',
			invocation: buildRefactorExecutorInvocation({
				planContent: standaloneBanner,
				changedFiles: files,
				standards,
				findings: workFindings,
				advisories,
				reportAdvisoryOutcomes: true,
			}),
		});
		// Read before the pass is classified: past the classification the report
		// is known complete, but only the union's `ok` arm carries it.
		const changedNothing = attempt.ok && attempt.report.changedFiles.length === 0;

		stop = await getAttemptStop({ batchId: batch.id, attempt, workFindings, rationale, onProgress, remainingSiteKeys, gates, finish });

		if (stop) {
			break;
		}

		// Verify — cheap mechanical retries with gate-kind routing, then the
		// supervisor's exception path if those are spent.
		const settled = await settleBatchGates({
			cwd,
			runId,
			driver,
			config,
			batchId: batch.id,
			planContent: standaloneBanner,
			attempts: invocationCount,
			onProgress,
			recordUsage,
			invokeFix: ({ label, gateError, guidance }) => invoke({ label, invocation: buildFixInvocation({ gateError, guidance }) }),
			gates,
		});

		if (settled.kind === 'parked') {
			stop = { kind: BatchStopKind.Parked };
			break;
		}

		if (settled.kind === 'escalated') {
			stop = { kind: BatchStopKind.Escalated, error: settled.error };
			break;
		}

		const remaining = await remainingSiteKeys({ frozen: workFindings });

		if (remaining.length === 0) {
			stop = await finish({ outcome: BatchOutcome.Resolved, remainingSiteKeys: [] });
			break;
		}

		if (changedNothing || pass === 2) {
			// Nothing changed (a judged decline) or the requeue is spent — record
			// honestly and move on; a decline never fails the run by itself.
			stop = await finish({ outcome: BatchOutcome.Declined, remainingSiteKeys: remaining });
			break;
		}

		onProgress(`${batch.id}: ${remaining.length} site(s) persist after a changing pass — one requeue`);
		workFindings = workFindings.filter((finding) => remaining.includes(finding.siteKey));
	}

	// The fallback is unreachable: a pass-2 iteration always sets a stop.
	return stop ?? { kind: BatchStopKind.Failed, error: `${batch.id}: batch loop exited without a terminal condition` };
};
