import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { RunStatus } from '#src/contracts/index.ts';
import { findUnfinishedSequence } from '#src/phases/index.ts';
import { plantSequence } from '#tests/helpers/plantSequence.ts';

const overviewPath = join('plans', 'demo', 'overview.md');
/** The plan the cases' coordinators record themselves as belonging to. */
const planName = 'demo-ticket/001-demo';

const setupRunsDir = () => mkdtempSync(join(tmpdir(), 'lightsout-unfinished-'));

describe('findUnfinishedSequence', () => {
	test('a failed sequence for this plan is mid-flight, and the most recently updated one is the answer', async () => {
		const dir = setupRunsDir();

		plantSequence({ dir, runId: 'older-sequence', plan: overviewPath, planName, updatedAt: '2026-01-02T00:00:00.000Z' });
		plantSequence({ dir, runId: 'newer-sequence', plan: overviewPath, planName, updatedAt: '2026-03-04T05:06:07.000Z' });

		const unfinished = await findUnfinishedSequence({ cwd: dir, planName });

		// two stopped sequences cannot both be "the" one to resume — recency decides
		expect(unfinished?.runId).toBe('newer-sequence');
	});

	test('a passed sequence is history, not a block', async () => {
		const dir = setupRunsDir();

		plantSequence({ dir, runId: 'finished-sequence', plan: overviewPath, planName, status: RunStatus.Passed });

		expect(await findUnfinishedSequence({ cwd: dir, planName })).toBe(undefined);
	});

	test('an unfinished sequence for a different plan is not this one’s business', async () => {
		const dir = setupRunsDir();

		plantSequence({ dir, runId: 'other-plans-sequence', plan: join('plans', 'other', 'overview.md'), planName: 'demo-ticket/002-other' });

		expect(await findUnfinishedSequence({ cwd: dir, planName })).toBe(undefined);
	});

	test('a run from another pipeline never counts, whatever plan it names', async () => {
		const dir = setupRunsDir();

		plantSequence({ dir, runId: 'implement-run', plan: overviewPath, planName, pipeline: 'implement' });

		expect(await findUnfinishedSequence({ cwd: dir, planName })).toBe(undefined);
	});

	test('a run whose manifest no longer parses is skipped rather than treated as unfinished', async () => {
		const dir = setupRunsDir();

		plantSequence({ dir, runId: 'unreadable-run', plan: overviewPath, planName, manifestText: 'not json at all' });

		expect(await findUnfinishedSequence({ cwd: dir, planName })).toBe(undefined);
	});

	test('a repo with no runs directory at all has nothing unfinished, not an error', async () => {
		expect(await findUnfinishedSequence({ cwd: setupRunsDir(), planName })).toBe(undefined);
	});

	test('an unfinished sequence is found by the plan it recorded, whatever its overview path says', async () => {
		const dir = setupRunsDir();

		plantSequence({
			dir,
			runId: 'respelled-overview-sequence',
			plan: join(dir, '.lightsout', 'tickets', 'demo-ticket', 'plans', '001-demo', 'overview.md'),
			planName: 'demo-ticket/001-demo',
		});
		plantSequence({ dir, runId: 'other-plans-sequence', plan: overviewPath, planName: 'demo-ticket/002-other' });

		const unfinished = await findUnfinishedSequence({ cwd: dir, planName: 'demo-ticket/001-demo' });

		// the recorded name is the link — how the overview path happened to be spelled says nothing
		expect(unfinished?.runId).toBe('respelled-overview-sequence');
	});

	test('a sequence with no recorded name to match blocks nothing', async () => {
		const dir = setupRunsDir();

		plantSequence({ dir, runId: 'nameless-sequence', plan: overviewPath });

		expect(await findUnfinishedSequence({ cwd: dir, planName: undefined })).toBe(undefined);
	});
});
