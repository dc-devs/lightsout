import { describe, expect, test } from '@jest/globals';
import { SprawlLane } from '#src/features/sprawl/common/constants/SprawlLane.ts';
import type { SprawlDataset } from '#src/features/sprawl/common/contracts/SprawlDataset.ts';
import type { SprawlLaneDelta } from '#src/features/sprawl/common/contracts/SprawlLaneDelta.ts';
import { buildSprawlLaneStates } from '#src/features/sprawl/common/rendering/buildSprawlLaneStates.ts';

const emptyDelta: SprawlLaneDelta = { files: [], folders: [], removedFiles: [], removedFolders: [], overCap: 0 };

/**
 * Three frames that add, change and remove a file and a folder — the whole
 * grammar of a delta in one fixture, so the replay is pinned against something
 * hand-written rather than against a dataset that changes every time this
 * repository's history grows.
 */
const setupDataset = (): SprawlDataset => ({
	headSha: 'ccc',
	caps: { file: 250, tsxFile: 300, function: 80, testFile: 400, folderCensus: 20 },
	droppedCommits: 0,
	frames: [
		{
			sha: 'aaa',
			at: '2026-01-01T00:00:00Z',
			subject: 'first',
			isRefactorMarker: false,
			with: { ...emptyDelta, files: [{ path: 'src/a.ts', lines: 10 }], folders: [{ path: 'src', entries: 1 }], overCap: 0 },
			without: emptyDelta,
		},
		{
			sha: 'bbb',
			at: '2026-01-02T00:00:00Z',
			subject: 'second',
			isRefactorMarker: true,
			with: {
				...emptyDelta,
				files: [
					{ path: 'src/a.ts', lines: 40 },
					{ path: 'src/b.ts', lines: 0 },
				],
				folders: [
					{ path: 'src', entries: 2 },
					{ path: 'src/deep', entries: 3 },
				],
				overCap: 1,
			},
			without: emptyDelta,
		},
		{
			sha: 'ccc',
			at: '2026-01-03T00:00:00Z',
			subject: 'third',
			isRefactorMarker: false,
			with: { ...emptyDelta, removedFiles: ['src/a.ts'], removedFolders: ['src/deep'], overCap: 2 },
			without: emptyDelta,
		},
	],
});

describe('buildSprawlLaneStates', () => {
	test('carries the first frame through as the full state', () => {
		const [first] = buildSprawlLaneStates({ dataset: setupDataset(), lane: SprawlLane.With });

		expect([...first.files]).toStrictEqual([['src/a.ts', 10]]);
		expect([...first.folders]).toStrictEqual([['src', 1]]);
	});

	test('applies a changed line count and keeps the file that did not change', () => {
		const [, second] = buildSprawlLaneStates({ dataset: setupDataset(), lane: SprawlLane.With });

		expect(second.files.get('src/a.ts')).toBe(40);
		expect(second.folders.get('src')).toBe(2);
	});

	test('keeps a measured zero, because an emptied file is still a file with a bar', () => {
		const [, second] = buildSprawlLaneStates({ dataset: setupDataset(), lane: SprawlLane.With });

		expect(second.files.has('src/b.ts')).toBe(true);
		expect(second.files.get('src/b.ts')).toBe(0);
	});

	test('drops what the removal lists name, and leaves the rest standing', () => {
		const [, , third] = buildSprawlLaneStates({ dataset: setupDataset(), lane: SprawlLane.With });

		expect([...third.files.keys()]).toStrictEqual(['src/b.ts']);
		expect([...third.folders.keys()]).toStrictEqual(['src']);
	});

	test('carries each frame its own over-cap count', () => {
		const states = buildSprawlLaneStates({ dataset: setupDataset(), lane: SprawlLane.With });

		expect(states.map((state) => state.overCap)).toStrictEqual([0, 1, 2]);
	});

	test('replays the other lane from its own deltas rather than the first one it was asked for', () => {
		const dataset = setupDataset();

		buildSprawlLaneStates({ dataset, lane: SprawlLane.With });

		expect(buildSprawlLaneStates({ dataset, lane: SprawlLane.Without }).at(-1)?.files.size).toBe(0);
	});

	test('replays a dataset once and hands back the same states, because the frames cannot change at run time', () => {
		const dataset = setupDataset();

		expect(buildSprawlLaneStates({ dataset, lane: SprawlLane.With })).toBe(buildSprawlLaneStates({ dataset, lane: SprawlLane.With }));
	});
});
