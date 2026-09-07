import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { removeApprovedTests } from '#src/pipeline/approvedTests/removeApprovedTests.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

const runId = 'run-1';

/**
 * A finished run's folder: the approved copies the review worked against, and
 * beside them the three things that are the run's evidence — its manifest, its
 * review journal, and the per-test results a gate wrote.
 */
const setupFinishedRun = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-approved-tests-'));
	const runDir = join(cwd, '.lightsout', 'runs', runId);
	const files = [
		join(runDir, 'approved', 'packages/api/src/widget.unit.test.ts'),
		join(runDir, 'approved', 'packages/web/src/widget.unit.test.ts'),
		join(runDir, 'manifest.json'),
		join(runDir, 'test-reviews.jsonl'),
		join(runDir, 'test-results', 'verify-tests', 'root', 'test', '1234.json'),
	];

	for (const target of files) {
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, '{}');
	}

	const run = { cwd, current: () => ({ runId }) } as unknown as PipelineRun;

	return { run, runDir };
};

test("removeApprovedTests: the run's approved directory is deleted and the rest of the run folder stands", async () => {
	const { run, runDir } = setupFinishedRun();

	await removeApprovedTests({ run });

	// the copies are the working baseline a resume needs and a finished run does
	// not, so they go whole — nested copies included — while the manifest, the
	// review journal and the per-test results stay as the run's evidence
	expect({
		approved: existsSync(join(runDir, 'approved')),
		manifest: existsSync(join(runDir, 'manifest.json')),
		journal: existsSync(join(runDir, 'test-reviews.jsonl')),
		results: existsSync(join(runDir, 'test-results', 'verify-tests', 'root', 'test', '1234.json')),
	}).toStrictEqual({ approved: false, manifest: true, journal: true, results: true });
});
