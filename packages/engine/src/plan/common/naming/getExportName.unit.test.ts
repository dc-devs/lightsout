import { describe, expect, test } from '@jest/globals';
import { getExportName } from '#src/plan/common/naming/getExportName.ts';

describe('getExportName', () => {
	test.each([
		{ path: 'src/a/getUser.ts', expected: 'getUser' },
		{ path: 'packages/x/src/Thing.tsx', expected: 'Thing' },
		{ path: 'index.mjs', expected: 'index' },
		{ path: 'src/a/legacy.cjs', expected: 'legacy' },
		{ path: 'src/a/Widget.jsx', expected: 'Widget' },
		{ path: 'src/a/plain.js', expected: 'plain' },
		{ path: 'src/a/schema.mts', expected: 'schema' },
		{ path: 'src/a/schema.cts', expected: 'schema' },
	])('reads $expected as the export $path implies', ({ path, expected }) => {
		const name = getExportName({ path });

		expect(name).toBe(expected);
	});

	test.each([
		{ path: 'src/a/getUser.unit.test.ts', expected: 'getUser.unit.test' },
		{ path: 'src/b/session-response.model.ts', expected: 'session-response.model' },
	])('strips only the trailing source extension, so $path implies $expected', ({ path, expected }) => {
		const name = getExportName({ path });

		expect(name).toBe(expected);
	});

	test.each([
		{ path: 'src/a/theme.css', expected: 'theme.css' },
		{ path: 'src/a/Button', expected: 'Button' },
	])('leaves $path alone, since $expected carries no module extension', ({ path, expected }) => {
		const name = getExportName({ path });

		expect(name).toBe(expected);
	});
});
