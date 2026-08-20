import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { collectImportEdges } from '#src/common/utils/collectImportEdges.ts';
import { isTestFile } from '#src/common/utils/isTestFile.ts';
import { listSourceFiles } from '#src/common/utils/listSourceFiles.ts';
import { resolveConsumerTypescript } from '#src/common/utils/resolveConsumerTypescript.ts';
import {
	type AgentUsage,
	BatchOutcome,
	CoverageBatchReport,
	type LightsoutConfig,
	type RunManifest,
	RunStatus,
	type StepRecord,
} from '#src/contracts/index.ts';
import { buildCoverageBatch } from '#src/coverage/buildCoverageBatch.ts';
import type { CoverageResult } from '#src/coverage/CoverageResult.ts';
import { maxFileStrikes } from '#src/coverage/common/constants/maxFileStrikes.ts';
import { updateFileStrikes } from '#src/coverage/common/utils/updateFileStrikes.ts';
import { initializeCoverageRun } from '#src/coverage/initializeCoverageRun.ts';
import { runCoverageBatch } from '#src/coverage/runCoverageBatch.ts';
import { runCoverageCheck } from '#src/coverage/runCoverageCheck.ts';
import { seedCoverageResumeState } from '#src/coverage/seedCoverageResumeState.ts';
import { selectCoverageCandidates } from '#src/coverage/selectCoverageCandidates.ts';
import type { Driver } from '#src/drivers/index.ts';
import { groupConnectedFiles, runGates } from '#src/pipeline/index.ts';
import { recordAgentUsage, seedUsageTotals, withRunLock, writeManifestWithUsage } from '#src/runState/index.ts';
import { resolveStandards } from '#src/standards/index.ts';

const defaultAgentTimeoutMinutes = 60;
const maxConsecutiveDeclines = 3;

interface Params {
	cwd: string;
	driver: Driver;
	config: LightsoutConfig;
	/** Stop (parked, resumable) after this many batches — budget control. */
	maxBatches?: number;
	/** Accept a dirty tree: the standing dirt is recorded as baseline, never attributed to a batch. */
	allowDirty?: boolean;
	/** Resume: an existing manifest — set-aside files, streak, and numbering reseed from its steps. */
	existing?: RunManifest;
	onProgress?: (message: string) => void;
}

/**
 * The coverage pipeline body — always entered holding the run lock (the
 * exported wrapper acquires and releases it). Pre-flight green gate → rounds
 * of (measure → batch the worst files of one failing scope → write tests →
 * verify → re-measure) until the consumer's own coverage command exits 0.
 *
 * Rounds, not a frozen batch list: writing tests changes the very numbers a
 * work-list would be built from. Every state transition persists before the
 * next action; rate limits park, a budget ceiling parks, three consecutive
 * declines stop the run as systemic. The engine never commits — the run ends
 * with tests in the working tree and set-aside files recommended for review.
 */
const executeCoverage = async ({
	cwd,
	runId,
	driver,
	config,
	maxBatches,
	allowDirty,
	existing,
	onProgress,
}: Params & { runId: string }): Promise<CoverageResult> => {
	const progress = onProgress ?? (() => undefined);

	const initialized = await initializeCoverageRun({ cwd, runId, driver, config, allowDirty, existing });
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

	// Set-aside files, the systemic streak and the per-file strikes survive
	// park/resume boundaries — rebuilt from persisted batch reports, never
	// process memory.
	const seeded = seedCoverageResumeState({ manifest });
	const setAside = seeded.setAside;
	const fileStrikes = seeded.fileStrikes;
	const before = worklist.totals;

	const stop = async ({ record, status, error }: { record: StepRecord; status: RunStatus; error: string }): Promise<CoverageResult> => {
		await setStep({ record: { ...record, status, error }, patch: { status } });
		progress(`coverage run stopped at ${record.id} — ${status}`);

		return { ok: false, manifest, error, setAside, before, after: before };
	};

	await update({ status: RunStatus.Running });

	// Pre-flight green gate, coverage excluded: the coverage gate is red by
	// definition here, but a red check or unit suite must not be blamed on a batch.
	if (!manifest.steps.some((step) => step.id === 'pre-flight' && step.status === RunStatus.Passed)) {
		const record: StepRecord = {
			id: 'pre-flight',
			status: RunStatus.Running,
			attempts: (manifest.steps.find((step) => step.id === 'pre-flight')?.attempts ?? 0) + 1,
		};

		await setStep({ record });
		progress('pre-flight — types and unit tests before any batch');

		const gateError = await runGates({ cwd, config, coverage: false, runId: manifest.runId, step: 'pre-flight', onProgress });

		if (gateError) {
			return stop({ record, status: RunStatus.Failed, error: `Codebase is not green before raising coverage — fix this first.\n${gateError}` });
		}

		await setStep({ record: { ...record, status: RunStatus.Passed } });
	}

	const { testStandards } = await resolveStandards({ cwd, config, packages: [] });
	const agentTimeoutMs = (config.timeouts?.['agent-minutes'] ?? defaultAgentTimeoutMinutes) * 60_000;
	// Resolved once for the run: without a consumer TypeScript, grouping degrades
	// to one file per batch component, exactly like the implement fan-out.
	const compiler = resolveConsumerTypescript({ cwd, packagesDir: config['packages-dir'] ?? defaultPackagesDir });
	// Also once for the run: standards-package roots make the test-file question
	// answerable — a rule check under a package's `tests/` document set is
	// source, and filtering without them excludes it everywhere.
	const { standardsPackages } = await listSourceFiles({ cwd });

	let declineStreak = seeded.declineStreak;
	let batchCount = seeded.batchCount;
	let processed = 0;

	while (true) {
		const measured = await runCoverageCheck({ cwd, config, runId: manifest.runId, step: 'measure', onProgress: progress });

		// The consumer's own exit codes are the only done signal — the engine
		// never learns the threshold number.
		if (measured.passed) {
			await update({ status: RunStatus.Passed, currentStep: null });
			progress('coverage gate green — nothing left to do');

			return { ok: true, manifest, setAside, before, after: measured.totals };
		}

		if (maxBatches !== undefined && processed >= maxBatches) {
			await update({ status: RunStatus.PausedBudget, currentStep: null });
			progress(`budget ceiling (${maxBatches} batch(es)) reached — resume with: lightsout test-coverage-to-threshold --run ${manifest.runId}`);

			return {
				ok: false,
				manifest,
				error: `paused at --max-batches ${maxBatches} — resume with: lightsout test-coverage-to-threshold --run ${manifest.runId}`,
				setAside,
				before,
				after: before,
			};
		}

		const setAsidePaths = new Set(setAside.flatMap((entry) => entry.files));
		const candidates = await selectCoverageCandidates({ cwd, measured, setAsidePaths, standardsPackages, compiler });

		if (candidates.length === 0) {
			const error =
				'coverage gate is red but no improvable file remains — set-aside files need source changes, or the threshold binds on a metric other than statements (branches/functions/lines); human required';

			await update({ status: RunStatus.Escalated, currentStep: null });
			progress(`coverage run escalated — ${error}`);

			return { ok: false, manifest, error, setAside, before, after: before };
		}

		// The worst file's scope earns the round: a package whose own gate is
		// already green never appears among the candidates at all.
		const scope = candidates[0].scope;
		const memberPool = measured.files
			.filter((file) => file.scope === scope && !setAsidePaths.has(file.path) && !isTestFile({ path: file.path, standardsPackages }))
			.map((file) => file.path);
		const components = compiler
			? groupConnectedFiles({ files: memberPool, edges: await collectImportEdges({ cwd, files: memberPool, compiler }) })
			: memberPool.map((file) => [file]);

		batchCount += 1;

		const batch = buildCoverageBatch({ files: candidates.filter((file) => file.scope === scope), components, batchNumber: batchCount });

		if (batch.members.length === 0) {
			// A candidate the member pool refuses is a filtering disagreement — an
			// engine bug to surface, never an empty assignment to spend a writer on.
			const error = `scope '${scope}' has candidates but the member pool excludes them all — candidate selection and member filtering disagree; human required`;

			await update({ status: RunStatus.Escalated, currentStep: null });
			progress(`coverage run escalated — ${error}`);

			return { ok: false, manifest, error, setAside, before, after: before };
		}

		const record: StepRecord = { id: batch.id, status: RunStatus.Running, attempts: (manifest.steps.find((step) => step.id === batch.id)?.attempts ?? 0) + 1 };

		await setStep({ record });
		progress(`${batch.id} — ${batch.files.length} file(s) worst-covered, ${batch.members.length} in the writer's hands`);

		const outcome = await runCoverageBatch({
			cwd,
			runId: manifest.runId,
			driver,
			config,
			batch,
			testStandards,
			agentTimeoutMs,
			// The baseline dirt rides along: files dirty before the run started are
			// no batch's doing, however git sees the union.
			attributedFiles: [...manifest.changedFiles, ...manifest.baselineDirtyFiles],
			onProgress: progress,
			recordUsage,
		});

		processed += 1;

		if (outcome.kind === 'parked') {
			return stop({
				record,
				status: RunStatus.PausedRateLimit,
				error: `run parked: harness rate limited or overloaded — resume with \`lightsout test-coverage-to-threshold --run ${manifest.runId}\` when the window resets.`,
			});
		}

		if (outcome.kind === 'failed' || outcome.kind === 'escalated') {
			return stop({ record, status: outcome.kind === 'failed' ? RunStatus.Failed : RunStatus.Escalated, error: outcome.error });
		}

		const report = CoverageBatchReport.parse(outcome.report);

		await setStep({
			record: { ...record, status: RunStatus.Passed, report, changedFiles: outcome.changedFiles },
			patch: { changedFiles: [...new Set([...manifest.changedFiles, ...outcome.changedFiles])] },
		});

		if (report.outcome === BatchOutcome.Declined) {
			setAside.push({ batchId: batch.id, files: report.files.map((file) => file.path), rationale: report.rationale });
			declineStreak += 1;
			progress(`${batch.id}: declined (${report.files.length} file(s) set aside)`);

			if (declineStreak >= maxConsecutiveDeclines) {
				// The batch's Passed record is already written — only the RUN
				// escalates, so resume never re-spends on it.
				const error = `${maxConsecutiveDeclines} consecutive batches declined — likely systemic (standards injection, gate config, or untestable source), not worth further agent spend.`;

				await update({ status: RunStatus.Escalated, currentStep: null });
				progress(`coverage run stopped after ${batch.id} — ${RunStatus.Escalated}`);

				return { ok: false, manifest, error, setAside, before, after: before };
			}

			continue;
		}

		declineStreak = 0;

		// The free-rider guard, applied to the same report resume would read: a
		// file carried through improving batches without improving is set aside
		// on its own.
		const struck = updateFileStrikes({ batchId: batch.id, files: report.files, fileStrikes });

		setAside.push(...struck);

		for (const path of struck.flatMap((entry) => entry.files)) {
			progress(`${path}: set aside after ${maxFileStrikes} batches without improvement`);
		}

		progress(`${batch.id}: resolved`);
	}
};

/**
 * Public entry: the shared run-lock lifecycle around the body — every pipeline
 * takes the same repo lock, so no two runs can race one tree.
 */
export const runCoveragePipeline = (params: Params): Promise<CoverageResult> => withRunLock({ params, run: executeCoverage });
