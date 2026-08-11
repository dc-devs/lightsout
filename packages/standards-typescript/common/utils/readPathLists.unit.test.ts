import { describe, expect, test } from '@jest/globals';
import type { StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupCloneSpansInput, setupFileListInput } from '@lightsout/standards-testkit';
import { readPathLists } from './readPathLists.ts';

const setupFileTextInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.FileText,
	cwd: '/repo',
	source: ['src/app.ts'],
	tests: ['src/app.unit.test.ts'],
	files: ['src/app.ts', 'src/app.unit.test.ts'],
	referenceFiles: [],
	contents: new Map<string, string>(),
	standardsPackages: [],
});

describe('readPathLists', () => {
	test('reads the paths from a file-list input', () => {
		const input = setupFileListInput({ source: ['src/app.ts'], tests: ['src/app.unit.test.ts'] });

		expect(readPathLists({ input })).toStrictEqual({
			files: ['src/app.ts', 'src/app.unit.test.ts'],
			tests: ['src/app.unit.test.ts'],
			standardsPackages: [],
		});
	});

	test('reads them from a file-text input too, since both kinds carry them', () => {
		expect(readPathLists({ input: setupFileTextInput() })).toStrictEqual({
			files: ['src/app.ts', 'src/app.unit.test.ts'],
			tests: ['src/app.unit.test.ts'],
			standardsPackages: [],
		});
	});

	test('yields empty lists for a kind that carries none, rather than refusing', () => {
		expect(readPathLists({ input: setupCloneSpansInput() })).toStrictEqual({ files: [], tests: [], standardsPackages: [] });
	});
});
