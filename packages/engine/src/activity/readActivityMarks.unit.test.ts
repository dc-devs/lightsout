import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readActivityMarks } from '#src/activity/readActivityMarks.ts';

// No module mocks: the reader's whole job is a file in a directory, so each case
// writes a real record into a temporary directory and reads it back off disk.

/** The complete lines a plan's record held before the process was killed. */
const completeLines = [
	{
		kind: 'level-start',
		id: 'lo-150-planning-observability',
		level: 'plan',
		label: 'lo-150-planning-observability',
		at: '2026-09-17T08:00:00.000Z',
	},
	{
		kind: 'level-start',
		id: 'level-draft',
		parentId: 'lo-150-planning-observability',
		level: 'step',
		label: 'draft',
		at: '2026-09-17T08:00:01.000Z',
	},
	{
		kind: 'harness-process',
		levelId: 'level-draft',
		harness: 'claude',
		model: 'claude-opus-5',
		effort: 'high',
		spawn: 1,
		reemit: false,
		startedAt: '2026-09-17T08:00:02.000Z',
		endedAt: '2026-09-17T08:04:00.000Z',
		endReason: 'completed',
		usage: { inputTokens: 1200, outputTokens: 340 },
	},
].map((mark) => JSON.stringify(mark));

interface SetupParams {
	/** Raw file contents, written verbatim so a cut-off final line stays cut off. */
	contents?: string;
}

const setupActivityRecord = async ({ contents }: SetupParams = {}) => {
	const dir = await mkdtemp(join(tmpdir(), 'lightsout-activity-marks-'));

	if (contents !== undefined) {
		await writeFile(join(dir, 'activity.jsonl'), contents, 'utf8');
	}

	return { dir };
};

describe('readActivityMarks', () => {
	test('a truncated final line is skipped and the complete marks are returned', async () => {
		// the process died mid-append, so its last line stops partway through its JSON
		const { dir } = await setupActivityRecord({
			contents: `${completeLines.join('\n')}\n{"kind":"level-end","id":"level-dra`,
		});

		const marks = await readActivityMarks({ dir });

		expect(marks).toStrictEqual([
			{
				kind: 'level-start',
				id: 'lo-150-planning-observability',
				level: 'plan',
				label: 'lo-150-planning-observability',
				at: '2026-09-17T08:00:00.000Z',
			},
			{
				kind: 'level-start',
				id: 'level-draft',
				parentId: 'lo-150-planning-observability',
				level: 'step',
				label: 'draft',
				at: '2026-09-17T08:00:01.000Z',
			},
			{
				kind: 'harness-process',
				levelId: 'level-draft',
				harness: 'claude',
				model: 'claude-opus-5',
				effort: 'high',
				spawn: 1,
				reemit: false,
				startedAt: '2026-09-17T08:00:02.000Z',
				endedAt: '2026-09-17T08:04:00.000Z',
				endReason: 'completed',
				usage: { inputTokens: 1200, outputTokens: 340 },
			},
		]);
	});

	test('a missing record file reads as no marks', async () => {
		const { dir } = await setupActivityRecord();

		const marks = await readActivityMarks({ dir });

		// a plan that predates the record has nothing to report, which is not a failure
		expect(marks).toStrictEqual([]);
	});
});
