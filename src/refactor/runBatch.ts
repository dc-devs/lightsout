import { buildRefactorExecutorInvocation } from '@/agents';
import {
	BatchOutcome,
	ScanDetector,
	ScanSeverity,
	WorkReportStatus,
	type AgentUsage,
	type BatchReport,
	type LightsoutConfig,
	type RefactorBatch,
	type ScanFinding,
} from '@/contracts';
import type { Driver } from '@/drivers';
import { runScan } from '@/scan';
import { buildBatchFixInvocation } from '@/refactor/buildBatchFixInvocation';
import { collectBatchChanges } from '@/refactor/collectBatchChanges';
import { invokeBatchAgent } from '@/refactor/invokeBatchAgent';
import { matchRemainingFindings } from '@/refactor/matchRemainingFindings';
import { runBatchGates } from '@/refactor/runBatchGates';
import { superviseBatch } from '@/refactor/superviseBatch';

const maxCheapFixRetries = 2;
const standaloneBanner =
	'Standalone refactor run — there is no feature plan. The scan findings below are the entire work-list; nothing else about the repo is being changed.';

/** One batch attempt's terminal condition, before outcome classification. */
type BatchStop =
	| { kind: 'parked' }
	| { kind: 'failed'; error: string }
	| { kind: 'escalated'; error: string }
	| { kind: 'done'; report: BatchReport; changedFiles: string[] };

interface Params {
	cwd: string;
	runId: string;
	driver: Driver;
	config: LightsoutConfig;
	batch: RefactorBatch;
	/** Scan scope of the run's worklist, threaded into the per-batch re-scan. */
	scanPath?: string;
	/** Include baselined findings in re-scans — must match the worklist's mode. */
	scanAll: boolean;
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
 * back to the refactor executor), then re-scan the batch's clusters.
 * Clusters gone → resolved; agent changed nothing and clusters persist →
 * declined; partial → one re-invocation on the remainder, then whatever
 * persists is declined with the agent's rationale attached.
 */
export const runBatch = async ({
	cwd,
	runId,
	driver,
	config,
	batch,
	scanPath,
	scanAll,
	standards,
	testStandards,
	agentTimeoutMs,
	attributedFiles,
	onProgress,
	recordUsage,
}: Params): Promise<BatchStop> => {
	const rationale: string[] = [];
	const reportedFiles = new Set<string>();
	let invocationCount = 0;

	const invoke = ({ label, invocation }: { label: string; invocation: { systemPrompt: string; prompt: string } }) => {
		invocationCount += 1;

		return invokeBatchAgent({ cwd, runId, driver, config, batch, invocation, label, invocationCount, agentTimeoutMs, reportedFiles, rationale, recordUsage });
	};

	const gates = () => runBatchGates({ cwd, config, runId, step: batch.id, onProgress });

	const scanLive = () => runScan({ cwd, path: scanPath, all: scanAll, persist: false });

	const remainingClusters = async ({ frozen }: { frozen: ScanFinding[] }) => {
		const { findings } = await scanLive();

		return matchRemainingFindings({ frozen, live: findings });
	};

	const batchChangedFiles = () => collectBatchChanges({ cwd, config, reportedFiles, attributedFiles });

	// One live scan up front serves two purposes: the staleness check (earlier
	// batches may have already eliminated these clusters — no agent spent) and
	// FRESH advisories (frozen worklist advisories cite pre-run line numbers;
	// live lesson from run 50d4ab35, where the agent flagged the drift).
	const preScan = await scanLive();

	if (matchRemainingFindings({ frozen: batch.findings, live: preScan.findings }).length === 0) {
		onProgress(`${batch.id}: clusters already resolved by earlier work — no agent spent`);

		return { kind: 'done', report: { outcome: BatchOutcome.Resolved, remainingClusters: [], rationale }, changedFiles: [] };
	}

	const batchFiles = new Set(batch.findings.flatMap((finding) => finding.files.map((file) => file.path)));
	const liveAdvisories = preScan.findings.filter(
		(finding) =>
			finding.severity === ScanSeverity.Advisory &&
			finding.detector === ScanDetector.Size &&
			finding.files.some((file) => batchFiles.has(file.path)),
	);

	// Up to two executor passes: the initial batch, then one re-invocation on
	// whatever clusters survived a pass that DID change the tree (a partial).
	let workFindings: ScanFinding[] = batch.findings;

	for (let pass = 1; pass <= 2; pass += 1) {
		const files = [...new Set(workFindings.flatMap((finding) => finding.files.map((file) => file.path)))];

		const buildFixInvocation = ({ gateError, guidance }: { gateError: string; guidance?: string }) =>
			buildBatchFixInvocation({ planContent: standaloneBanner, files, standards, testStandards, scanFindings: workFindings, scanAdvisories: liveAdvisories, gateError, guidance });
		const attemptOutcome = await invoke({
			label: pass === 1 ? '' : 'requeue',
			invocation: buildRefactorExecutorInvocation({
				planContent: standaloneBanner,
				changedFiles: files,
				standards,
				scanFindings: workFindings,
				scanAdvisories: liveAdvisories,
			}),
		});

		if (!attemptOutcome.ok) {
			if (attemptOutcome.rateLimited) {
				return { kind: 'parked' };
			}

			const { failure } = attemptOutcome;

			// Salvage check (live lesson: a laptop-sleep-killed agent had finished
			// its edits but never reported): if the clusters are verifiably gone
			// AND gates are green, the work is done — classify it, don't discard it.
			if ((await remainingClusters({ frozen: workFindings })).length === 0 && !(await gates())) {
				rationale.push(`[other] salvaged: agent invocation failed (${failure}) but the clusters are resolved and gates are green`);
				onProgress(`${batch.id}: invocation failed but work verified on disk — salvaged as resolved`);

				return { kind: 'done', report: { outcome: BatchOutcome.Resolved, remainingClusters: [], rationale }, changedFiles: await batchChangedFiles() };
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
				report: { outcome: BatchOutcome.Declined, remainingClusters: await remainingClusters({ frozen: workFindings }), rationale },
				changedFiles: await batchChangedFiles(),
			};
		}

		if (report.status !== WorkReportStatus.Complete) {
			const kind = report.status === WorkReportStatus.Failed ? ('failed' as const) : ('escalated' as const);

			return { kind, error: `${batch.id}: ${report.status} — ${report.failures.join('; ')}` };
		}

		// Verify — cheap mechanical retries with gate-kind routing.
		let gateError = await gates();

		for (let retry = 1; gateError && retry <= maxCheapFixRetries; retry += 1) {
			onProgress(`${batch.id}: gate red — fix attempt ${retry}/${maxCheapFixRetries}`);

			const fix = await invoke({ label: `fix-${retry}`, invocation: buildFixInvocation({ gateError }) });

			if (!fix.ok && fix.rateLimited) {
				return { kind: 'parked' };
			}

			gateError = await gates();
		}

		// Exception path: mechanical retries exhausted — bring in judgment.
		if (gateError) {
			const supervised = await superviseBatch({
				cwd,
				runId,
				driver,
				config,
				batchId: batch.id,
				planContent: standaloneBanner,
				gateError,
				attempts: invocationCount,
				maxCheapFixRetries,
				onProgress,
				recordUsage,
				invokeGuidedFix: ({ guidance }) => invoke({ label: 'supervised-fix', invocation: buildFixInvocation({ gateError, guidance }) }),
				gates,
			});

			if (supervised.kind === 'parked') {
				return { kind: 'parked' };
			}

			if (supervised.kind === 'escalated') {
				return { kind: 'escalated', error: supervised.error };
			}
		}

		const remaining = await remainingClusters({ frozen: workFindings });

		if (remaining.length === 0) {
			return { kind: 'done', report: { outcome: BatchOutcome.Resolved, remainingClusters: [], rationale }, changedFiles: await batchChangedFiles() };
		}

		if (report.changedFiles.length === 0 || pass === 2) {
			// Nothing changed (a judged decline) or the requeue is spent — record
			// honestly and move on; a decline never fails the run by itself.
			return {
				kind: 'done',
				report: { outcome: BatchOutcome.Declined, remainingClusters: remaining, rationale },
				changedFiles: await batchChangedFiles(),
			};
		}

		onProgress(`${batch.id}: ${remaining.length} cluster(s) persist after a changing pass — one requeue`);
		workFindings = workFindings.filter((finding) => remaining.includes(finding.cluster));
	}

	// Unreachable: the pass-2 branch above always returns.
	return { kind: 'failed', error: `${batch.id}: batch loop exited without a terminal condition` };
};
