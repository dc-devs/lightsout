import { describe, expect, test } from '@jest/globals';
import type { SprawlDataset } from '#src/features/sprawl/common/contracts/SprawlDataset.ts';
import type { SprawlLaneDelta } from '#src/features/sprawl/common/contracts/SprawlLaneDelta.ts';
import { getSprawlMaxLines } from '#src/features/sprawl/common/rendering/getSprawlMaxLines.ts';

const delta = ({ lines }: { lines: number }): SprawlLaneDelta => ({
	files: [{ path: 'src/a.ts', lines }],
	folders: [],
	removedFiles: [],
	removedFolders: [],
	overCap: 0,
});

/** Two frames whose peaks sit in different lanes, so a per-lane answer would show up as a wrong one. */
const setupDataset = ({ peaks = [10, 900, 40, 20] }: { peaks?: number[] } = {}): SprawlDataset => ({
	headSha: 'bbb',
	caps: { file: 250, tsxFile: 300, function: 80, testFile: 400, folderCensus: 20 },
	droppedCommits: 0,
	frames: [
		{
			sha: 'aaa',
			at: '2026-01-01T00:00:00Z',
			subject: 'first',
			isRefactorMarker: false,
			with: delta({ lines: peaks[0] }),
			without: delta({ lines: peaks[1] }),
		},
		{
			sha: 'bbb',
			at: '2026-01-02T00:00:00Z',
			subject: 'second',
			isRefactorMarker: false,
			with: delta({ lines: peaks[2] }),
			without: delta({ lines: peaks[3] }),
		},
	],
});

describe('getSprawlMaxLines', () => {
	test('takes the tallest file across both lanes, so the two charts share one scale', () => {
		expect(getSprawlMaxLines({ dataset: setupDataset() })).toBe(900);
	});

	test('reads every frame, not just the last one', () => {
		expect(getSprawlMaxLines({ dataset: setupDataset({ peaks: [700, 10, 20, 30] }) })).toBe(700);
	});

	test('answers zero for a history with nothing in it, rather than reaching into an empty list', () => {
		expect(getSprawlMaxLines({ dataset: { ...setupDataset(), frames: [] } })).toBe(0);
	});

	test('measures a dataset once, because the committed JSON cannot change at run time', () => {
		const dataset = setupDataset();

		expect(getSprawlMaxLines({ dataset })).toBe(getSprawlMaxLines({ dataset }));
	});
});
