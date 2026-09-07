import { expect, test } from '@jest/globals';
import type { ApprovedTestRecord } from '#src/contracts/index.ts';
import { readApprovedTest } from '#src/pipeline/approvedTests/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const runId = 'run-approved-2';
const testFile = 'src/widget.unit.test.ts';

/** What the repo carries at `HEAD` for `testFile` — the answer only a path with no record gets. */
const committed = "test('widget: renders', () => { expect(1).toBe(1); });\n";

/**
 * A manifest that records an approved copy the run folder does not hold: the
 * record survived, the file under it did not.
 */
const setupLostCopy = () => {
	const cwd = setupConsumerRepo({ sources: { 'src/index.js': 'export const one = 1;\n', [testFile]: committed } });
	const approvedTests: ApprovedTestRecord[] = [{ path: testFile, sha256: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0', removed: false }];
	const run = { cwd, current: () => ({ runId, approvedTests }) } as unknown as PipelineRun;

	return { run };
};

test('readApprovedTest: a recorded copy the run folder no longer holds reads as no approved version', async () => {
	const { run } = setupLostCopy();

	const content = await readApprovedTest({ run, path: testFile });

	// Once a record names a copy, the run has moved past HEAD, so falling back to
	// the committed bytes would reinstate a baseline the review already replaced
	// and hide every change made since. "No approved version" is the honest
	// answer: the live file arrives at the next checkpoint as an addition, and
	// the reviewer rules on the whole of it.
	expect(content).toBe(undefined);
});
