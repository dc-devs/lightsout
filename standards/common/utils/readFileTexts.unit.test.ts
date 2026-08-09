import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { readFileTexts } from './readFileTexts.ts';

/** The file-text input as the engine builds it: what is in scope, what may reference it, and the text of both. */
const setupFileTextInput = ({
	files = ['src/feature/getLabel.ts', 'src/feature/getLabel.unit.test.ts'],
	tests = ['src/feature/getLabel.unit.test.ts'],
	referenceFiles = ['src/app/runApp.ts'],
	contents = [
		['src/feature/getLabel.ts', 'export const getLabel = () => "label";'],
		['src/feature/getLabel.unit.test.ts', 'describe("getLabel", () => {});'],
		['src/app/runApp.ts', 'import { getLabel } from "../feature/getLabel";'],
	] as Array<[string, string]>,
}: {
	files?: string[];
	tests?: string[];
	referenceFiles?: string[];
	contents?: Array<[string, string]>;
} = {}): StandardsCheckInput => ({
	kind: StandardsInputKind.FileText,
	cwd: '/repo',
	source: files,
	tests,
	files,
	referenceFiles,
	contents: new Map(contents),
});

/**
 * Any input a rule that did NOT declare `file-text` would receive. The engine
 * never hands one of these to a rule that reads file text, so this stands in
 * for the arm the union permits but a run cannot produce.
 */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/feature/getLabel.ts'],
	spans: [],
});

describe('readFileTexts', () => {
	test('hands back the scope, the tests within it, the reference files and the text of every one', () => {
		const input = setupFileTextInput();

		const texts = readFileTexts({ input });

		expect(texts).toStrictEqual({
			files: ['src/feature/getLabel.ts', 'src/feature/getLabel.unit.test.ts'],
			tests: ['src/feature/getLabel.unit.test.ts'],
			referenceFiles: ['src/app/runApp.ts'],
			contents: new Map([
				['src/feature/getLabel.ts', 'export const getLabel = () => "label";'],
				['src/feature/getLabel.unit.test.ts', 'describe("getLabel", () => {});'],
				['src/app/runApp.ts', 'import { getLabel } from "../feature/getLabel";'],
			]),
		});
	});

	test('an empty scope reads back as empty rather than as missing', () => {
		const input = setupFileTextInput({ files: [], tests: [], referenceFiles: [], contents: [] });

		const texts = readFileTexts({ input });

		expect(texts).toStrictEqual({ files: [], tests: [], referenceFiles: [], contents: new Map() });
	});

	test('an input of any other kind yields an empty scope rather than refusing', () => {
		const texts = readFileTexts({ input: setupOtherKindInput() });

		expect(texts).toStrictEqual({ files: [], tests: [], referenceFiles: [], contents: new Map() });
	});
});
