import { describe, expect, test } from '@jest/globals';
import { getSprawlDataset } from '#src/features/sprawl/index.ts';

/**
 * The committed `assets/sprawl-dataset.json` is parsed here rather than in a
 * throwaway command, so the file the site ships is validated by the suite that
 * gates every change. A dataset that stopped matching its schema would
 * otherwise only be discovered by a blank chart.
 */
describe('getSprawlDataset', () => {
	test('parses the committed dataset and finds a history in it', () => {
		expect(getSprawlDataset().frames.length).toBeGreaterThan(0);
	});

	test('stamps the dataset with the commit it was built at, which is the last frame', () => {
		const dataset = getSprawlDataset();

		expect(dataset.headSha).toBe(dataset.frames[dataset.frames.length - 1].sha);
	});

	test('carries the caps the pages state, read from the pack rather than typed in', () => {
		const { caps } = getSprawlDataset();

		// Named one at a time rather than swept, so a cap that went missing fails
		// here instead of leaving a hole in the sentence that states it.
		const named = { file: caps.file, tsxFile: caps.tsxFile, function: caps.function, testFile: caps.testFile, folderCensus: caps.folderCensus };

		expect(Object.entries(named).filter(([, cap]) => cap <= 0)).toStrictEqual([]);
	});

	test('opens on a full state, which is what the replay of every later delta stands on', () => {
		const [first] = getSprawlDataset().frames;
		const removals = [first.with.removedFiles, first.with.removedFolders, first.without.removedFiles, first.without.removedFolders];

		expect(removals).toStrictEqual([[], [], [], []]);
	});

	test('parses once, because the bundled JSON cannot change while the app runs', () => {
		expect(getSprawlDataset()).toBe(getSprawlDataset());
	});
});
