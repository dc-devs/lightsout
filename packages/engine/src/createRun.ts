import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { RunStatus, type RunManifest } from '@lightsout/contracts';
import { getRunDir } from './getRunDir';
import { writeRunManifest } from './writeRunManifest';

interface Params {
	cwd: string;
	plan: string;
	driver: string;
}

/** Create a new run: fresh id, run directory, and initial manifest on disk. */
export const createRun = async ({ cwd, plan, driver }: Params) => {
	const now = new Date().toISOString();
	const manifest: RunManifest = {
		runId: randomUUID(),
		createdAt: now,
		updatedAt: now,
		plan,
		driver,
		status: RunStatus.Pending,
		currentStep: null,
		steps: [],
		changedFiles: [],
	};

	await mkdir(getRunDir({ cwd, runId: manifest.runId }), { recursive: true });

	return writeRunManifest({ cwd, manifest });
};
