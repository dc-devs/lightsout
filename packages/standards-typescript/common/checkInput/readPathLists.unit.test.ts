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
	standardsPacks: [],
});

describe('readPathLists', () => {
	test('reads the paths from a file-list input', () => {
		const input = setupFileListInput({ source: ['src/app.ts'], tests: ['src/app.unit.test.ts'] });

		expect(readPathLists({ input })).toStrictEqual({
			files: ['src/app.ts', 'src/app.unit.test.ts'],
			tests: ['src/app.unit.test.ts'],
			standardsPacks: [],
		});
	});

	test('reads them from a file-text input too, since both kinds carry them', () => {
		expect(readPathLists({ input: setupFileTextInput() })).toStrictEqual({
			files: ['src/app.ts', 'src/app.unit.test.ts'],
			tests: ['src/app.unit.test.ts'],
			standardsPacks: [],
		});
	});

	test('carries the pack roots the input declares, rather than a fixed empty list', () => {
		const input = setupFileListInput({ source: ['standards/tests/unit-testing/10-rule/check.ts'], standardsPacks: ['standards'] });

		expect(readPathLists({ input })).toStrictEqual({
			files: ['standards/tests/unit-testing/10-rule/check.ts'],
			tests: [],
			standardsPacks: ['standards'],
		});
	});

	test('yields empty lists for a kind that carries none, rather than refusing', () => {
		expect(readPathLists({ input: setupCloneSpansInput() })).toStrictEqual({ files: [], tests: [], standardsPacks: [] });
	});
});
