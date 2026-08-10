import { dirname } from 'node:path';
import { buildUnitTestWriterInvocation } from '@/agents';
import { BatchOutcome, WorkReportStatus, type AgentUsage, type CoverageBatchReport, type LightsoutConfig } from '@/contracts';
import type { Driver } from '@/drivers';
import { runBatchGates } from '@/pipeline';
import { defaultCoverageSummaryPath } from '@/common/constants/defaultCoverageSummaryPath';
import { defaultPackagesDir } from '@/common/constants/defaultPackagesDir';
import { collectBatchChanges } from '@/common/utils/collectBatchChanges';
import { isTestFile } from '@/common/utils/isTestFile';
import { packageOf } from '@/common/utils/packageOf';
import { invokeCoverageAgent } from '@/coverage/invokeCoverageAgent';
import { runCoverageCheck } from '@/coverage/runCoverageCheck';
import type { CoverageBatch } from '@/coverage/common/types/CoverageBatch';
import type { CoverageBatchStop } from '@/coverage/common/types/CoverageBatchStop';

const maxCheapFixRetries = 2;
const standaloneBanner =
	'Standalone coverage run — there is no feature plan. The files listed below are import-connected groups containing the run\'s current worst-covered files; raise their unit-test coverage. Change no source file: tests are the only deliverable.';

/**
 * True for the coverage tooling's own output — the measurement must never fail
 * the run it serves, exactly as generated paths never do. A package writes its
 * summary under its own directory, so the check reads both spellings.
 */
const isMeasurementOutput = ({ path, coverageDir, packagesDir }: { path: string; coverageDir: string; packagesDir: string }) => {
	const owner = packageOf({ file: path, packagesDir });
	const withinPackage = owner === undefined ? path : path.slice(`${packagesDir}/${owner}/`.length);

	return path.startsWith(`${coverageDir}/`) || withinPackage.startsWith(`${coverageDir}/`);
};

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
 * writer on the batch's components, refuse any non-test edit, verify with
 * scoped gates (coverage off — it is red by definition mid-run), then
 * re-measure the batch's scope. Any tracked file whose statements percentage
 * strictly improved resolves the batch; none improving declines it.
 *
 * A writer report of `failed` is a decline, not a run-stopper: that status is
 * exactly what the writer's own role rules say to report when a file's source
 * looks defective, which is the routine set-aside case here. Only
 * invocation-level errors stop the run.
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
	const coverageDir = dirname(config.coverageSummaryPath ?? defaultCoverageSummaryPath);
	const packagesDir = config.packagesDir ?? defaultPackagesDir;
	let invocationCount = 0;

	const invoke = ({ label, invocation }: { label: string; invocation: { systemPrompt: string; prompt: string } }) => {
		invocationCount += 1;

		return invokeCoverageAgent({ cwd, runId, driver, config, batchId: batch.id, invocation, label, invocationCount, agentTimeoutMs, reportedFiles, rationale, recordUsage });
	};

	// Coverage stays OFF: this run exists because that gate is red.
	const gates = () => runBatchGates({ cwd, config, coverage: false, runId, step: batch.id, onProgress });

	/**
	 * The batch's changed files with the measurement's own artifacts dropped,
	 * and the tests-only verdict on what is left. Re-run after every invocation
	 * — a fix agent can edit source exactly as the first one can.
	 */
	const testsOnly = async () => {
		const changed = (await collectBatchChanges({ cwd, config, reportedFiles, attributedFiles })).filter(
			(path) => !isMeasurementOutput({ path, coverageDir, packagesDir }),
		);
		const offenders = changed.filter((path) => !isTestFile({ path }));

		return {
			changed,
			error:
				offenders.length === 0
					? undefined
					: `${batch.id}: this run may change no source file, but these are modified:\n${offenders.map((path) => `  ${path}`).join('\n')}\nThe tree is left as it stands — revert these changes by hand before resuming, since the engine never reverts and a resumed run would measure the contaminated tree.`,
		};
	};

	const reportOf = ({ outcome, files }: { outcome: BatchOutcome; files: CoverageBatchReport['files'] }): CoverageBatchReport => ({ outcome, files, rationale });

	/** The batch's files as they stood before it ran — the record a batch that never measured leaves. */
	const unmeasured = () => batch.files.map((file) => ({ path: file.path, beforePct: file.statementsPct, afterPct: file.statementsPct }));

	/** Re-measure the batch's scope and compare every tracked file against its pre-batch percentage. */
	const measure = async () => {
		const measured = await runCoverageCheck({ cwd, config, scope: batch.scope, runId, step: batch.id });
		const pctByPath = new Map(measured.files.map((file) => [file.path, file.statementsPct]));
		// A file absent from the fresh summary counts as unimproved: the writer
		// covered nothing the measurement can see.
		const files = batch.files.map((file) => ({ path: file.path, beforePct: file.statementsPct, afterPct: pctByPath.get(file.path) ?? file.statementsPct }));

		return { files, improved: files.some((file) => file.afterPct > file.beforePct) };
	};

	const attempt = await invoke({
		label: '',
		invocation: buildUnitTestWriterInvocation({ planContent: standaloneBanner, changedFiles: batch.members, standards: testStandards }),
	});

	if (!attempt.ok) {
		if (attempt.rateLimited) {
			return { kind: 'parked' };
		}

		// Salvage never waives the tests-only rule — a dying agent's source edit
		// fails the batch exactly as a live one's would.
		const violated = await testsOnly();

		if (violated.error) {
			return { kind: 'failed', error: violated.error };
		}

		// Salvage check (live lesson from refactor: a sleep-killed agent had
		// finished its edits but never reported) — if coverage verifiably moved
		// and gates are green, the work is done; classify it, don't discard it.
		const salvaged = await measure();

		if (salvaged.improved && !(await gates())) {
			rationale.push(`[other] salvaged: agent invocation failed (${attempt.failure}) but coverage improved and gates are green`);
			onProgress(`${batch.id}: invocation failed but coverage moved on disk — salvaged as resolved`);

			return { kind: 'done', report: reportOf({ outcome: BatchOutcome.Resolved, files: salvaged.files }), changedFiles: violated.changed };
		}

		return { kind: 'failed', error: `${batch.id}: ${attempt.failure}` };
	}

	// Cheapest check first, and before any classification: no path records a
	// batch while a source file sits modified in the tree.
	const checked = await testsOnly();

	if (checked.error) {
		return { kind: 'failed', error: checked.error };
	}

	const { report } = attempt;

	if (report.status === WorkReportStatus.TerminatedScope || report.status === WorkReportStatus.Failed) {
		// Both are judgment the writer is entitled to: the batch is too large to
		// take on, or the source cannot be tested without changing it. Either way
		// the files go to a human, and the run continues.
		const marker = report.status === WorkReportStatus.TerminatedScope ? 'scope' : 'failed';

		rationale.push(...report.failures.map((entry) => `[${marker}] ${entry}`));

		return { kind: 'done', report: reportOf({ outcome: BatchOutcome.Declined, files: unmeasured() }), changedFiles: checked.changed };
	}

	if (report.status !== WorkReportStatus.Complete) {
		return { kind: 'escalated', error: `${batch.id}: ${report.status} — ${report.failures.join('; ')}` };
	}

	let changed = checked.changed;
	let gateError = await gates();

	for (let retry = 1; gateError && retry <= maxCheapFixRetries; retry += 1) {
		onProgress(`${batch.id}: gate red — fix attempt ${retry}/${maxCheapFixRetries}`);

		const fix = await invoke({
			label: `fix-${retry}`,
			invocation: buildUnitTestWriterInvocation({ planContent: standaloneBanner, changedFiles: batch.members, standards: testStandards, errorContext: gateError }),
		});

		if (!fix.ok && fix.rateLimited) {
			return { kind: 'parked' };
		}

		const refixed = await testsOnly();

		if (refixed.error) {
			return { kind: 'failed', error: refixed.error };
		}

		changed = refixed.changed;
		gateError = await gates();
	}

	if (gateError) {
		return { kind: 'failed', error: `${batch.id}: gates still red after ${maxCheapFixRetries} fix attempt(s)\n${gateError}` };
	}

	const measured = await measure();
	const outcome = measured.improved ? BatchOutcome.Resolved : BatchOutcome.Declined;

	return { kind: 'done', report: reportOf({ outcome, files: measured.files }), changedFiles: changed };
};
