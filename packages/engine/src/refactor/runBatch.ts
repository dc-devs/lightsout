import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildRefactorExecutorInvocation, buildUnitTestWriterInvocation } from '@lightsout/agents';
import {
	BatchOutcome,
	WorkReport,
	WorkReportStatus,
	type AgentUsage,
	type BatchReport,
	type LightsoutConfig,
	type RefactorBatch,
	type ScanFinding,
} from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { invokeAgentWithContract } from '../invoke';
import { appendFriction, getRunDir } from '../runState';
import { runScan } from '../scan';
import { collectBatchChanges } from './collectBatchChanges';
import { matchRemainingFindings } from './matchRemainingFindings';
import { runBatchGates } from './runBatchGates';

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
	const agentsDir = join(getRunDir({ cwd, runId }), 'agents');
	const rationale: string[] = [];
	const reportedFiles = new Set<string>();
	let invocationCount = 0;

	const invoke = async ({ label, invocation }: { label: string; invocation: { systemPrompt: string; prompt: string } }) => {
		invocationCount += 1;

		const streamPath = join(agentsDir, `stream-${batch.id.replace(/[:/]/g, '_')}-${invocationCount}.jsonl`);

		await mkdir(agentsDir, { recursive: true });

		const outcome = await invokeAgentWithContract({
			driver,
			cwd,
			invocation,
			contract: WorkReport,
			model: config.model,
			permissionMode: config.permissionMode ?? 'acceptEdits',
			timeoutMs: agentTimeoutMs,
			allowedCommands: config.agentCommands,
			onEvent: (event) => {
				void appendFile(streamPath, `${JSON.stringify(event)}\n`, 'utf8').catch(() => undefined);
			},
			onRejectedOutput: async ({ text, attempt }) => {
				await writeFile(join(agentsDir, `rejected-${batch.id.replace(/[:/]/g, '_')}-${invocationCount}-${attempt}.txt`), text, 'utf8').catch(
					() => undefined,
				);
			},
		});

		await recordUsage({ step: `${batch.id}${label ? ` ${label}` : ''}`, usage: outcome.usage });

		for (const file of outcome.report?.changedFiles ?? []) {
			reportedFiles.add(file.path);
		}

		if (outcome.report?.friction && outcome.report.friction.length > 0) {
			await appendFriction({ cwd, runId, step: batch.id, friction: outcome.report.friction });
			rationale.push(...outcome.report.friction.map((entry) => `[${entry.area}] ${entry.detail}`));
		}

		return outcome;
	};

	const gates = () => runBatchGates({ cwd, config, runId, step: batch.id, onProgress });

	const remainingClusters = async ({ frozen }: { frozen: ScanFinding[] }) => {
		const { findings } = await runScan({ cwd, path: scanPath, all: scanAll, persist: false });

		return matchRemainingFindings({ frozen, live: findings });
	};

	const batchChangedFiles = () => collectBatchChanges({ cwd, config, reportedFiles, attributedFiles });

	// Earlier batches may have already eliminated these clusters (a shared
	// file, a broad fix) — check before spending an agent on a stale batch.
	if ((await remainingClusters({ frozen: batch.findings })).length === 0) {
		onProgress(`${batch.id}: clusters already resolved by earlier work — no agent spent`);

		return { kind: 'done', report: { outcome: BatchOutcome.Resolved, remainingClusters: [], rationale }, changedFiles: [] };
	}

	// Up to two executor passes: the initial batch, then one re-invocation on
	// whatever clusters survived a pass that DID change the tree (a partial).
	let workFindings: ScanFinding[] = batch.findings;

	for (let pass = 1; pass <= 2; pass += 1) {
		const files = [...new Set(workFindings.flatMap((finding) => finding.files.map((file) => file.path)))];
		const { report, failure, rateLimited } = await invoke({
			label: pass === 1 ? '' : 'requeue',
			invocation: buildRefactorExecutorInvocation({
				planContent: standaloneBanner,
				changedFiles: files,
				standards,
				scanFindings: workFindings,
				scanAdvisories: batch.advisories,
			}),
		});

		if (rateLimited) {
			return { kind: 'parked' };
		}

		if (!report) {
			return { kind: 'failed', error: `${batch.id}: ${failure ?? 'unknown failure'}` };
		}

		if (report.status !== WorkReportStatus.Complete) {
			const kind = report.status === WorkReportStatus.Failed ? ('failed' as const) : ('escalated' as const);

			return { kind, error: `${batch.id}: ${report.status} — ${report.failures.join('; ')}` };
		}

		// Verify — cheap mechanical retries with gate-kind routing.
		let gateError = await gates();

		for (let retry = 1; gateError && retry <= maxCheapFixRetries; retry += 1) {
			onProgress(`${batch.id}: gate red — fix attempt ${retry}/${maxCheapFixRetries}`);

			// Coverage routes to the test writer only when coverage is the ONLY
			// red kind — mixed failures fix the source first (the coverage red
			// may be downstream of the source break).
			const coverageRed = gateError.includes('test-coverage failed') && !/(check|test-unit|build|generate|format) failed/.test(gateError);
			const fix = await invoke({
				label: `fix-${retry}`,
				invocation: coverageRed
					? buildUnitTestWriterInvocation({
							planContent: standaloneBanner,
							changedFiles: files,
							standards: testStandards,
							errorContext: gateError,
						})
					: buildRefactorExecutorInvocation({
							planContent: standaloneBanner,
							changedFiles: files,
							standards,
							scanFindings: workFindings,
							scanAdvisories: batch.advisories,
							errorContext: gateError,
						}),
			});

			if (fix.rateLimited) {
				return { kind: 'parked' };
			}

			gateError = await gates();
		}

		if (gateError) {
			return { kind: 'escalated', error: `${batch.id}: gates still red after ${maxCheapFixRetries} fix attempt(s).\n\n${gateError}` };
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
