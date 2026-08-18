import { buildRefactorExecutorInvocation } from '@/agents';
import { collectBatchChanges } from '@/common/utils/collectBatchChanges';
import {
	type AdvisoryOutcome,
	type AgentUsage,
	BatchOutcome,
	type LightsoutConfig,
	type RefactorBatch,
	type StandardsFinding,
	WorkReportStatus,
} from '@/contracts';
import type { Driver } from '@/drivers';
import { runBatchGates } from '@/pipeline';
import { buildBatchFixInvocation } from '@/refactor/buildBatchFixInvocation';
import { buildBatchReport } from '@/refactor/buildBatchReport';
import { collectBatchAdvisories } from '@/refactor/collectBatchAdvisories';
import type { BatchStop } from '@/refactor/common/types/BatchStop';
import { invokeBatchAgent } from '@/refactor/invokeBatchAgent';
import { matchRemainingFindings } from '@/refactor/matchRemainingFindings';
import { settleBatchGates } from '@/refactor/settleBatchGates';
import { runStandardsCheck } from '@/standardsCheck';
import type { LoadedStandardsPackage } from '@/standardsPackages';

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

	// Coverage stays on: a refactor must not drop coverage.
	const gates = () => runBatchGates({ cwd, config, coverage: true, runId, step: batch.id, onProgress });

	const checkLive = () => runStandardsCheck({ cwd, path: checkPath, all: checkAll, persist: false });

	const remainingSiteKeys = async ({ frozen }: { frozen: StandardsFinding[] }) => {
		const { findings } = await checkLive();

		return matchRemainingFindings({ frozen, live: findings });
	};

	const batchChangedFiles = () => collectBatchChanges({ cwd, config, reportedFiles, attributedFiles });

	// One live check up front serves two purposes: the staleness check (earlier
	// batches may have already eliminated these sites — no agent spent) and
	// FRESH advisories (frozen worklist advisories cite pre-run line numbers;
	// live lesson from run 50d4ab35, where the agent flagged the drift).
	const preCheck = await checkLive();

	if (matchRemainingFindings({ frozen: batch.blocking, live: preCheck.findings }).length === 0) {
		onProgress(`${batch.id}: sites already resolved by earlier work — no agent spent`);

		return { kind: 'done', report: reportOf({ outcome: BatchOutcome.Resolved, remainingSiteKeys: [] }), changedFiles: [] };
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

	for (let pass = 1; pass <= 2; pass += 1) {
		const files = [...new Set(workFindings.flatMap((finding) => finding.files.map((file) => file.path)))];

		const buildFixInvocation = ({ gateError, guidance }: { gateError: string; guidance?: string }) =>
			buildBatchFixInvocation({ planContent: standaloneBanner, files, standards, testStandards, findings: workFindings, advisories, gateError, guidance });
		const attemptOutcome = await invoke({
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

		if (!attemptOutcome.ok) {
			if (attemptOutcome.rateLimited) {
				return { kind: 'parked' };
			}

			const { failure } = attemptOutcome;

			// Salvage check (live lesson: a laptop-sleep-killed agent had finished
			// its edits but never reported): if the sites are verifiably gone
			// AND gates are green, the work is done — classify it, don't discard it.
			if ((await remainingSiteKeys({ frozen: workFindings })).length === 0 && !(await gates())) {
				rationale.push(`[other] salvaged: agent invocation failed (${failure}) but the sites are resolved and gates are green`);
				onProgress(`${batch.id}: invocation failed but work verified on disk — salvaged as resolved`);

				return { kind: 'done', report: reportOf({ outcome: BatchOutcome.Resolved, remainingSiteKeys: [] }), changedFiles: await batchChangedFiles() };
			}

			return { kind: 'failed', error: `${batch.id}: ${failure}` };
		}

		const { report } = attemptOutcome;

		if (report.status === WorkReportStatus.TerminatedScope) {
			// A scope refusal is judgment, not failure — record it as a decline
			// and let the run continue; the human reviews it with the report.
			rationale.push(...report.failures.map((entry) => `[scope] ${entry}`));

			return {
				kind: 'done',
				report: reportOf({ outcome: BatchOutcome.Declined, remainingSiteKeys: await remainingSiteKeys({ frozen: workFindings }) }),
				changedFiles: await batchChangedFiles(),
			};
		}

		if (report.status !== WorkReportStatus.Complete) {
			const kind = report.status === WorkReportStatus.Failed ? ('failed' as const) : ('escalated' as const);

			return { kind, error: `${batch.id}: ${report.status} — ${report.failures.join('; ')}` };
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
			return { kind: 'parked' };
		}

		if (settled.kind === 'escalated') {
			return { kind: 'escalated', error: settled.error };
		}

		const remaining = await remainingSiteKeys({ frozen: workFindings });

		if (remaining.length === 0) {
			return { kind: 'done', report: reportOf({ outcome: BatchOutcome.Resolved, remainingSiteKeys: [] }), changedFiles: await batchChangedFiles() };
		}

		if (report.changedFiles.length === 0 || pass === 2) {
			// Nothing changed (a judged decline) or the requeue is spent — record
			// honestly and move on; a decline never fails the run by itself.
			return {
				kind: 'done',
				report: reportOf({ outcome: BatchOutcome.Declined, remainingSiteKeys: remaining }),
				changedFiles: await batchChangedFiles(),
			};
		}

		onProgress(`${batch.id}: ${remaining.length} site(s) persist after a changing pass — one requeue`);
		workFindings = workFindings.filter((finding) => remaining.includes(finding.siteKey));
	}

	// Unreachable: the pass-2 branch above always returns.
	return { kind: 'failed', error: `${batch.id}: batch loop exited without a terminal condition` };
};
