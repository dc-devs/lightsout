import { describe, expect, test } from '@jest/globals';
import { getExportName } from './getExportName.ts';

describe('getExportName', () => {
	test.each([
		{ path: 'src/feature/getLabel.ts', expected: 'getLabel' },
		{ path: 'src/components/Badge.tsx', expected: 'Badge' },
		{ path: 'src/feature/index.ts', expected: 'index' },
		{ path: 'src/scripts/buildBundle.js', expected: 'buildBundle' },
		{ path: 'src/scripts/renderPage.jsx', expected: 'renderPage' },
		{ path: 'src/scripts/loadConfig.mjs', expected: 'loadConfig' },
		{ path: 'src/scripts/loadConfig.cjs', expected: 'loadConfig' },
		{ path: 'src/scripts/readEnv.mts', expected: 'readEnv' },
		{ path: 'src/scripts/readEnv.cts', expected: 'readEnv' },
	])('reads $expected as the export $path implies', ({ path, expected }) => {
		const name = getExportName({ path });

		expect(name).toBe(expected);
	});

	test.each([
		{ path: 'src/feature/getLabel.unit.test.ts', expected: 'getLabel.unit.test' },
		{ path: 'src/common/types/Config.d.ts', expected: 'Config.d' },
	])('strips only the final extension, so $path implies $expected', ({ path, expected }) => {
		const name = getExportName({ path });

		expect(name).toBe(expected);
	});

	test.each([
		{ path: 'docs/notes.md', expected: 'notes.md' },
		{ path: 'LICENSE', expected: 'LICENSE' },
	])('leaves $path alone, since $expected carries no module extension', ({ path, expected }) => {
		const name = getExportName({ path });

		expect(name).toBe(expected);
	});
});
