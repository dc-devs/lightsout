import { mkdirSync } from 'node:fs';
import { runDirFor } from '#tests/helpers/runDirFor.ts';

/**
 * The run folder a real run would already have.
 *
 * `createRun` makes a run's folder before the run starts, and every path inside
 * it is looked up by run id — so a fixture that hands a run id to the subject
 * has to leave the folder behind too, or the lookup answers that no such run
 * exists.
 *
 * @returns the folder it created, for a fixture that wants to read it back
 */
export const seedRunFolder = (params: Parameters<typeof runDirFor>[0]): string => {
	const runDir = runDirFor(params);

	mkdirSync(runDir, { recursive: true });

	return runDir;
};
