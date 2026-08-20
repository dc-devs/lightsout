import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { toRepoRelativePath } from '#src/common/utils/toRepoRelativePath.ts';
import { type LightsoutConfig, type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { findUnfinishedSequence } from '#src/phases/findUnfinishedSequence.ts';
import { readOverviewPhases } from '#src/phases/readOverviewPhases.ts';
import { createRun, writeRunManifest } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	config: LightsoutConfig;
	overviewPath?: string;
	startPhase?: number;
	existing?: RunManifest;
}

/** The phase file names the overview's table names, refusing an empty table and a file listed twice. */
const getPhaseFiles = async ({ cwd, overview }: { cwd: string; overview: string }) => {
	const overviewFullPath = join(cwd, overview);
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
		const present = await access(join(cwd, phasePath)).then(
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
 * is missing, the starting phase is out of range, or an unfinished sequence for this overview already exists.
 */
export const initializeSequence = async ({ cwd, driver, config, overviewPath, startPhase, existing }: Params): Promise<{ manifest: RunManifest }> => {
	if (existing) {
		const pipeline = existing.pipeline ?? 'implement';

		if (pipeline !== 'phases') {
			throw new Error(
				`run ${existing.runId} belongs to the ${pipeline} pipeline — resume it with: lightsout ${pipeline === 'refactor' ? 'refactor' : 'resume'} --run ${existing.runId}`,
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

	const unfinished = await findUnfinishedSequence({ cwd, overviewPath: overview });

	if (unfinished) {
		throw new Error(`an unfinished run for this plan already exists — resume with: lightsout resume --run ${unfinished.runId}`);
	}

	const created = await createRun({ cwd, plan: overview, pipeline: 'phases', driver: driver.name, config });
	// Phases below the starting one are recorded as done OUTSIDE the sequence —
	// adopted, never re-run, and never counted as this run's work.
	const steps: StepRecord[] = phases.map((file, index) => ({
		id: file,
		status: index + 1 < firstPhase ? RunStatus.Passed : RunStatus.Pending,
		attempts: 0,
	}));

	return { manifest: await writeRunManifest({ cwd, manifest: { ...created, steps } }) };
};
