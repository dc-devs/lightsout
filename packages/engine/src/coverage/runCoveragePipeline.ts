import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { listSourceFiles } from '#src/common/sourceFiles/listSourceFiles.ts';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import { type LightsoutConfig, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { CoverageResult } from '#src/coverage/CoverageResult.ts';
import { CoverageRun } from '#src/coverage/CoverageRun.ts';
import { initializeCoverageRun } from '#src/coverage/initializeCoverageRun.ts';
import { runCoveragePreflightGate } from '#src/coverage/runCoveragePreflightGate.ts';
import { runCoverageRounds } from '#src/coverage/runCoverageRounds.ts';
import { seedCoverageResumeState } from '#src/coverage/seedCoverageResumeState.ts';
import type { Driver } from '#src/drivers/index.ts';
import { withRunLock } from '#src/runState/index.ts';
import { resolveStandards } from '#src/standards/index.ts';

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
 * Every state transition persists before the next action; rate limits park, a
 * budget ceiling parks, three consecutive declines stop the run as systemic.
 * The engine never commits — the run ends with tests in the working tree and
 * set-aside files recommended for review.
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
	const { manifest, worklist } = await initializeCoverageRun({ cwd, runId, driver, config, allowDirty, existing });
	// Set-aside files, the systemic streak and the per-file strikes survive
	// park/resume boundaries — rebuilt from persisted batch reports, never
	// process memory.
	const seeded = seedCoverageResumeState({ manifest });
	const run = new CoverageRun({ cwd, config, manifest, onProgress, setAside: seeded.setAside, before: worklist.totals });

	await run.update({ patch: { status: RunStatus.Running } });

	const redBaseline = await runCoveragePreflightGate({ run });

	if (redBaseline) {
		return redBaseline;
	}

	const { testStandards } = await resolveStandards({ cwd, config, packages: [] });
	// Resolved once for the run: without a consumer TypeScript, grouping degrades
	// to one file per batch component, exactly like the implement fan-out.
	const compiler = resolveConsumerTypescript({ cwd, packagesDir: config['packages-dir'] ?? defaultPackagesDir });
	// Also once for the run: standards-package roots make the test-file question
	// answerable — a rule check under a package's `tests/` document set is
	// source, and filtering without them excludes it everywhere.
	const { standardsPackages } = await listSourceFiles({ cwd });

	return runCoverageRounds({ run, driver, batchInputs: { testStandards, compiler, standardsPackages }, maxBatches, resumed: seeded });
};

/**
 * Public entry: the shared run-lock lifecycle around the body — every pipeline
 * takes the same repo lock, so no two runs can race one tree.
 */
export const runCoveragePipeline = (params: Params): Promise<CoverageResult> => withRunLock({ params, run: executeCoverage });
