import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunStatus } from '#src/contracts/index.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';

interface Params {
	dir: string;
	runId: string;
	plan: string;
	/** The plan the run records itself as belonging to; absent when it belongs to none. */
	planName?: string;
	updatedAt?: string;
	status?: RunStatus;
	/** Raw file contents, for a manifest that must fail to parse. */
	manifestText?: string;
	pipeline?: string;
}

/**
 * A phased run written straight onto disk — the prior run state a fresh start
 * has to reckon with. Written by hand rather than run, because the states worth
 * testing (two sequences for one overview, a manifest that no longer parses) are
 * ones the guard itself prevents a second run from producing.
 */
export const plantSequence = ({ dir, runId, plan, planName, updatedAt, status = RunStatus.Failed, manifestText, pipeline = 'phases' }: Params): void => {
	const runDir = runDirFor({ cwd: dir, runId, planName, pipeline });

	mkdirSync(runDir, { recursive: true });
	writeFileSync(
		join(runDir, 'manifest.json'),
		manifestText ??
			JSON.stringify({
				runId,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: updatedAt ?? '2026-01-01T00:00:00.000Z',
				plan,
				planName,
				pipeline,
				harness: 'stub',
				status,
				currentStep: null,
				steps: [],
				changedFiles: [],
				packages: [],
				baselineDirtyFiles: [],
				testSubjects: [],
				unreachableChangedFiles: [],
				coverageExcludedChangedFiles: [],
			}),
	);
};
