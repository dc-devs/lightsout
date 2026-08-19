import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { plantSequence } from '@tests/helpers/plantSequence';
import { RunStatus } from '@/contracts';
import { findUnfinishedSequence } from '@/phases';

const overviewPath = join('plans', 'demo', 'overview.md');

const setupRunsDir = () => mkdtempSync(join(tmpdir(), 'lightsout-unfinished-'));

describe('findUnfinishedSequence', () => {
	test('a failed sequence for this overview is mid-flight, and the most recently updated one is the answer', async () => {
		const dir = setupRunsDir();

		plantSequence({ dir, runId: 'older-sequence', plan: overviewPath, updatedAt: '2026-01-02T00:00:00.000Z' });
		plantSequence({ dir, runId: 'newer-sequence', plan: overviewPath, updatedAt: '2026-03-04T05:06:07.000Z' });

		const unfinished = await findUnfinishedSequence({ cwd: dir, overviewPath });

		// two stopped sequences cannot both be "the" one to resume — recency decides
		expect(unfinished?.runId).toBe('newer-sequence');
	});

	test('a passed sequence is history, not a block', async () => {
		const dir = setupRunsDir();

		plantSequence({ dir, runId: 'finished-sequence', plan: overviewPath, status: RunStatus.Passed });

		expect(await findUnfinishedSequence({ cwd: dir, overviewPath })).toBe(undefined);
	});

	test('an unfinished sequence for a different overview is not this one’s business', async () => {
		const dir = setupRunsDir();

		plantSequence({ dir, runId: 'other-plans-sequence', plan: join('plans', 'other', 'overview.md') });

		expect(await findUnfinishedSequence({ cwd: dir, overviewPath })).toBe(undefined);
	});

	test('a run from another pipeline never counts, whatever plan it names', async () => {
		const dir = setupRunsDir();

		plantSequence({ dir, runId: 'implement-run', plan: overviewPath, pipeline: 'implement' });

		expect(await findUnfinishedSequence({ cwd: dir, overviewPath })).toBe(undefined);
	});

	test('a run whose manifest no longer parses is skipped rather than treated as unfinished', async () => {
		const dir = setupRunsDir();

		plantSequence({ dir, runId: 'unreadable-run', plan: overviewPath, manifestText: 'not json at all' });

		expect(await findUnfinishedSequence({ cwd: dir, overviewPath })).toBe(undefined);
	});

	test('a repo with no runs directory at all has nothing unfinished, not an error', async () => {
		expect(await findUnfinishedSequence({ cwd: setupRunsDir(), overviewPath })).toBe(undefined);
	});
});
