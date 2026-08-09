import { expect, describe, test } from '@jest/globals';
import { buildLineSites } from './buildLineSites.ts';

/** The one file and the spans a check found in it — the whole arrangement this builder takes. */
const setupSites = ({
	file = 'src/alpha.unit.test.ts',
	spans = [
		{ startLine: 3, endLine: 5 },
		{ startLine: 11, endLine: 11 },
	],
}: { file?: string; spans?: Array<{ startLine: number; endLine: number }> } = {}) => ({ file, spans });

describe('buildLineSites', () => {
	test('gives every span the one file path and keeps the reported order', () => {
		const { file, spans } = setupSites();

		const sites = buildLineSites({ file, spans });

		expect(sites).toStrictEqual([
			{ path: 'src/alpha.unit.test.ts', startLine: 3, endLine: 5 },
			{ path: 'src/alpha.unit.test.ts', startLine: 11, endLine: 11 },
		]);
	});

	test('a file with no spans reports no sites', () => {
		const { file } = setupSites();

		const sites = buildLineSites({ file, spans: [] });

		expect(sites).toStrictEqual([]);
	});
});
