import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { ApprovedTestRecord } from '#src/contracts/index.ts';
import { readApprovedTest } from '#src/pipeline/approvedTests/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const runId = 'run-approved-1';
const testFile = 'src/widget.unit.test.ts';

/** What the repo carries at `HEAD` for `testFile` — the fallback answer. */
const committed = "test('widget: renders', () => { expect(1).toBe(1); });\n";

/** What the run approved later, deliberately different so which one came back is observable. */
const approvedCopy = "test('widget: renders', () => { expect(2).toBe(2); });\n";

interface SetupParams {
	/** Content of the run's approved copy, written to disk and recorded with its hash. */
	copy?: string;
	/** Record an approved removal for the file instead of a copy. */
	removed?: boolean;
}

/** A repo whose `HEAD` carries the test file, plus whatever the run has approved since. */
const setupApprovedRun = ({ copy, removed = false }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ sources: { 'src/index.js': 'export const one = 1;\n', [testFile]: committed } });
	const approvedTests: ApprovedTestRecord[] = [];

	if (copy !== undefined) {
		const target = join(cwd, '.lightsout', 'runs', runId, 'approved', testFile);

		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, copy);
		approvedTests.push({ path: testFile, sha256: sha256({ content: copy }), removed: false });
	}

	if (removed) {
		approvedTests.push({ path: testFile, removed: true });
	}

	const run = { cwd, current: () => ({ runId, approvedTests }) } as unknown as PipelineRun;

	return { run };
};

test('readApprovedTest: a recorded copy wins over the content at HEAD', async () => {
	const { run } = setupApprovedRun({ copy: approvedCopy });

	const content = await readApprovedTest({ run, path: testFile });

	// once the run has approved a version of a test file, that version is the
	// baseline the next change is judged against — not the state the run started
	// from, which the reviewer has already moved past
	expect(content).toBe(approvedCopy);
});

test('readApprovedTest: an approved removal reads as no approved version', async () => {
	const { run } = setupApprovedRun({ removed: true });

	const content = await readApprovedTest({ run, path: testFile });

	// an approved removal and a path that never existed are the same answer, so
	// the file being back on disk is an addition the reviewer has to see
	expect(content).toBe(undefined);
});

test('readApprovedTest: with no record the answer is HEAD, and nothing when HEAD does not track the path', async () => {
	const { run } = setupApprovedRun();

	const tracked = await readApprovedTest({ run, path: testFile });
	const untracked = await readApprovedTest({ run, path: 'src/never/existed.unit.test.ts' });

	// a run starts from a clean tree, so with nothing approved yet the committed
	// content is the approved test; a path git never tracked has no approved
	// version at all, which makes a file written at that path an addition
	expect(tracked).toBe(committed);
	expect(untracked).toBe(undefined);
});
