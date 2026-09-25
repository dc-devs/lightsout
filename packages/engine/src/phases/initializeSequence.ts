import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { toRepoRelativePath } from '#src/common/utils/toRepoRelativePath.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { StepRecord } from '#src/contracts/run/StepRecord.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { findUnfinishedSequence } from '#src/phases/findUnfinishedSequence.ts';
import { readOverviewPhases } from '#src/phases/readOverviewPhases.ts';
import { resolveRecordedPlanPath } from '#src/plan/common/paths/resolveRecordedPlanPath.ts';
import { planNameFromPath } from '#src/plan/planNameFromPath.ts';
import { createRun } from '#src/runState/createRun.ts';
import { writeRunManifest } from '#src/runState/writeRunManifest.ts';

interface Params {
	cwd: string;
	driver: Driver;
	config: LightsoutConfig;
	overviewPath?: string;
	startPhase?: number;
	/** The id a fresh coordinator is created under, minted by the caller. Ignored when resuming. */
	runId?: string;
	existing?: RunManifest;
	/** Resolved before the run starts: a passing run will ship this branch. Recorded on the coordinator's manifest so the progress view can show a ship row. Ignored when resuming. */
	willShip?: boolean;
}

/** The phase file names the overview's table names, refusing an empty table and a file listed twice. */
const getPhaseFiles = async ({ cwd, overview }: { cwd: string; overview: string }) => {
	// The shared resolver, not a bare join: a plan folder lives in the primary
	// checkout whichever checkout the run works in, so a plans-directory path
	// joined to a worktree names a file that is not there.
	const overviewFullPath = await resolveRecordedPlanPath({ cwd, path: overview });
	const overviewContent = await readFile(overviewFullPath, 'utf8').catch(() => undefined);

	if (overviewContent === undefined) {
		throw new Error(`overview file not found: ${overviewFullPath}`);
	}

	const phases = readOverviewPhases({ overviewContent });

	if (phases.length === 0) {
		throw new Error(`overview has no Phases table rows: ${overview}`);
	}

	// Step ids ARE phase file names, so a repeated file would collapse two
	// phases onto one record — caught here, before any state is written.
	const duplicate = phases.find((file, index) => phases.indexOf(file) !== index);

	if (duplicate !== undefined) {
		throw new Error(`overview lists ${duplicate} twice: ${overview}`);
	}

	return phases;
};

/** Every phase file is checked upfront, so an unattended run cannot die at phase 7 on a typo'd table entry. */
const assertPhaseFilesExist = async ({ cwd, overview, phases }: { cwd: string; overview: string; phases: string[] }) => {
	const missing: string[] = [];

	for (const file of phases) {
		const phasePath = join(dirname(overview), file);
		// Resolved the same way the overview beside it is: a phase file sits in
		// that same plan folder, so joining it to the run's checkout would report
		// every phase of a phased plan as missing.
		const present = await access(await resolveRecordedPlanPath({ cwd, path: phasePath })).then(
			() => true,
			() => false,
		);

		if (!present) {
			missing.push(phasePath);
		}
	}

	if (missing.length > 0) {
		throw new Error(`the overview's Phases table names files that do not exist:\n${missing.map((file) => `  ${file}`).join('\n')}`);
	}
};

/**
 * Resolve a phased run's manifest — resume validation, or fresh-start creation
 * with one step record per phase in the overview's written order.
 *
 * Every validation failure throws before any state exists: the CLI prints the
 * message and exits, and a rejected fresh start leaves no half-born run behind.
 *
 * @param overviewPath - overview path for a fresh sequence, cwd-relative or absolute
 * @param startPhase - 1-based phase to start from; earlier phases are recorded as passed outside the sequence
 * @param existing - resume: the coordinator manifest to continue
 * @throws {Error} When the overview is missing, its Phases table is empty or repeats a file, a phase file
 * is missing, the starting phase is out of range, or an unfinished sequence for this plan already exists.
 */
export const initializeSequence = async ({
	cwd,
	driver,
	config,
	overviewPath,
	startPhase,
	runId,
	existing,
	willShip,
}: Params): Promise<{ manifest: RunManifest }> => {
	if (existing) {
		const pipeline = existing.pipeline ?? PipelineKind.Implement;

		if (pipeline !== PipelineKind.Phases) {
			throw new Error(
				`run ${existing.runId} belongs to the ${pipeline} pipeline — resume it with: lightsout ${pipeline === PipelineKind.Refactor ? 'refactor' : 'resume'} --run ${existing.runId}`,
			);
		}

		return { manifest: existing };
	}

	if (!overviewPath) {
		throw new Error('a fresh phased run needs an overview path');
	}

	// The relative form up front, not only in the record: the phase-file checks
	// and the unfinished-sequence guard below all read it.
	const overview = toRepoRelativePath({ cwd, path: overviewPath });
	const phases = await getPhaseFiles({ cwd, overview });
	const firstPhase = startPhase ?? 1;

	if (!Number.isInteger(firstPhase) || firstPhase < 1 || firstPhase > phases.length) {
		throw new Error(`--start-phase must be between 1 and ${phases.length} — the overview lists ${phases.length} phase(s), got ${firstPhase}`);
	}

	await assertPhaseFilesExist({ cwd, overview, phases });

	const unfinished = await findUnfinishedSequence({ cwd, planName: await planNameFromPath({ cwd, planPath: overview }) });

	if (unfinished) {
		throw new Error(`an unfinished run for this plan already exists — resume with: lightsout resume --run ${unfinished.runId}`);
	}

	const created = await createRun({ cwd, runId, plan: overview, pipeline: PipelineKind.Phases, driver: driver.name, config, willShip });
	// Phases below the starting one are recorded as done OUTSIDE the sequence —
	// adopted, never re-run, and never counted as this run's work.
	const steps: StepRecord[] = phases.map((file, index) => ({
		id: file,
		status: index + 1 < firstPhase ? RunStatus.Passed : RunStatus.Pending,
		attempts: 0,
	}));

	return { manifest: await writeRunManifest({ cwd, manifest: { ...created, steps } }) };
};
