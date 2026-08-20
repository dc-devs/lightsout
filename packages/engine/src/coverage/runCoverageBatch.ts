import { dirname } from 'node:path';
import { buildUnitTestWriterInvocation } from '#src/agents/index.ts';
import { defaultCoverageSummaryPath } from '#src/common/constants/defaultCoverageSummaryPath.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { collectBatchChanges } from '#src/common/utils/collectBatchChanges.ts';
import { isTestFile } from '#src/common/utils/isTestFile.ts';
import { packageOf } from '#src/common/utils/packageOf.ts';
import { type AgentUsage, BatchOutcome, type CoverageBatchReport, type LightsoutConfig, WorkReportStatus } from '#src/contracts/index.ts';
import type { CoverageBatch } from '#src/coverage/common/types/CoverageBatch.ts';
import type { CoverageBatchStop } from '#src/coverage/common/types/CoverageBatchStop.ts';
import { invokeCoverageAgent } from '#src/coverage/invokeCoverageAgent.ts';
import { runCoverageCheck } from '#src/coverage/runCoverageCheck.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runBatchGates } from '#src/pipeline/index.ts';

const maxCheapFixRetries = 2;
const standaloneBanner =
	"Standalone coverage run — there is no feature plan. The files listed below are import-connected groups containing the run's current worst-covered files; raise their unit-test coverage. Change no source file: tests are the only deliverable.";

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
	// Kept by testsOnly, read by finish — the two are the batch's only writer
	// and only reader of what it changed.
	let changedFiles: string[] = [];
	const coverageDir = dirname(config['coverage-summary-path'] ?? defaultCoverageSummaryPath);
	const packagesDir = config['packages-dir'] ?? defaultPackagesDir;
	let invocationCount = 0;

	const invoke = ({ label, invocation }: { label: string; invocation: { systemPrompt: string; prompt: string } }) => {
		invocationCount += 1;

		return invokeCoverageAgent({
			cwd,
			runId,
			driver,
			config,
			batchId: batch.id,
			invocation,
			label,
			invocationCount,
			agentTimeoutMs,
			reportedFiles,
			rationale,
			recordUsage,
		});
	};

	// Coverage stays OFF: this run exists because that gate is red.
	const gates = () => runBatchGates({ cwd, config, coverage: false, runId, step: batch.id, onProgress });

	/**
	 * Record the batch's changed files with the measurement's own artifacts
	 * dropped, and return the tests-only verdict on what is left. Re-run after
	 * every invocation — a fix agent can edit source exactly as the first one can.
	 */
	const testsOnly = async () => {
		changedFiles = (await collectBatchChanges({ cwd, config, reportedFiles, attributedFiles })).filter(
			(path) => !isMeasurementOutput({ path, coverageDir, packagesDir }),
		);

		const offenders = changedFiles.filter((path) => !isTestFile({ path }));

		return {
			error:
				offenders.length === 0
					? undefined
					: `${batch.id}: this run may change no source file, but these are modified:\n${offenders.map((path) => `  ${path}`).join('\n')}\nThe tree is left as it stands — revert these changes by hand before resuming, since the engine never reverts and a resumed run would measure the contaminated tree.`,
		};
	};

	/**
	 * Every classified end of the batch goes through here, so no branch can
	 * report an outcome without the files the last tests-only pass observed.
	 */
	const finish = ({ outcome, files }: { outcome: BatchOutcome; files: CoverageBatchReport['files'] }): CoverageBatchStop => ({
		kind: 'done',
		report: { outcome, files, rationale },
		changedFiles,
	});

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
		invocation: buildUnitTestWriterInvocation({ planContent: standaloneBanner, subjects: batch.members, mustExecute: batch.members, standards: testStandards }),
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

		// Salvage check — an agent can die after finishing its edits but before
		// reporting. If coverage verifiably moved and gates are green, the work
		// is done; classify it, don't discard it.
		const salvaged = await measure();

		if (salvaged.improved && !(await gates())) {
			rationale.push(`[other] salvaged: agent invocation failed (${attempt.failure}) but coverage improved and gates are green`);
			onProgress(`${batch.id}: invocation failed but coverage moved on disk — salvaged as resolved`);

			return finish({ outcome: BatchOutcome.Resolved, files: salvaged.files });
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

		return finish({ outcome: BatchOutcome.Declined, files: unmeasured() });
	}

	if (report.status !== WorkReportStatus.Complete) {
		return { kind: 'escalated', error: `${batch.id}: ${report.status} — ${report.failures.join('; ')}` };
	}

	let gateError = await gates();

	for (let retry = 1; gateError && retry <= maxCheapFixRetries; retry += 1) {
		onProgress(`${batch.id}: gate red — fix attempt ${retry}/${maxCheapFixRetries}`);

		const fix = await invoke({
			label: `fix-${retry}`,
			invocation: buildUnitTestWriterInvocation({
				planContent: standaloneBanner,
				subjects: batch.members,
				mustExecute: batch.members,
				standards: testStandards,
				errorContext: gateError,
			}),
		});

		if (!fix.ok && fix.rateLimited) {
			return { kind: 'parked' };
		}

		const refixed = await testsOnly();

		if (refixed.error) {
			return { kind: 'failed', error: refixed.error };
		}

		gateError = await gates();
	}

	if (gateError) {
		return { kind: 'failed', error: `${batch.id}: gates still red after ${maxCheapFixRetries} fix attempt(s)\n${gateError}` };
	}

	const measured = await measure();

	return finish({ outcome: measured.improved ? BatchOutcome.Resolved : BatchOutcome.Declined, files: measured.files });
};
