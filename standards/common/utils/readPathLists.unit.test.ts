import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { readPathLists } from './readPathLists.ts';

const setupFileListInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.FileList,
	cwd: '/repo',
	source: ['src/app.ts'],
	tests: ['src/app.unit.test.ts'],
	files: ['src/app.ts', 'src/app.unit.test.ts'],
	referenceFiles: [],
	dependencies: new Map<string, string[]>(),
	standardsPackages: [],
});

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

/** An input carrying no path lists — an arm the union permits but a run never hands a location rule. */
const setupCloneSpansInput = (): StandardsCheckInput => ({ kind: StandardsInputKind.CloneSpans, cwd: '/repo', source: ['src/app.ts'], spans: [] });

describe('readPathLists', () => {
	test('reads the paths from a file-list input', () => {
		expect(readPathLists({ input: setupFileListInput() })).toStrictEqual({ files: ['src/app.ts', 'src/app.unit.test.ts'], tests: ['src/app.unit.test.ts'], standardsPackages: [] });
	});

	test('reads them from a file-text input too, since both kinds carry them', () => {
		expect(readPathLists({ input: setupFileTextInput() })).toStrictEqual({ files: ['src/app.ts', 'src/app.unit.test.ts'], tests: ['src/app.unit.test.ts'], standardsPackages: [] });
	});

	test('yields empty lists for a kind that carries none, rather than refusing', () => {
		expect(readPathLists({ input: setupCloneSpansInput() })).toStrictEqual({ files: [], tests: [], standardsPackages: [] });
	});
});
