import { describe, expect, test } from '@jest/globals';
import type { StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupOtherKindInput } from '@lightsout/standards-testkit';
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
	standardsPacks = [],
}: {
	files?: string[];
	tests?: string[];
	referenceFiles?: string[];
	contents?: Array<[string, string]>;
	standardsPacks?: string[];
} = {}): StandardsCheckInput => ({
	kind: StandardsInputKind.FileText,
	cwd: '/repo',
	source: files,
	tests,
	files,
	referenceFiles,
	contents: new Map(contents),
	standardsPacks,
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
			standardsPacks: [],
		});
	});

	test('an empty scope reads back as empty rather than as missing', () => {
		const input = setupFileTextInput({ files: [], tests: [], referenceFiles: [], contents: [] });

		const texts = readFileTexts({ input });

		expect(texts).toStrictEqual({ files: [], tests: [], referenceFiles: [], contents: new Map(), standardsPacks: [] });
	});

	test('carries the pack roots the input declares, rather than a fixed empty list', () => {
		const input = setupFileTextInput({ standardsPacks: ['standards', 'vendor/acme-standards'] });

		const texts = readFileTexts({ input });

		expect(texts.standardsPacks).toStrictEqual(['standards', 'vendor/acme-standards']);
	});

	test('an input of any other kind yields an empty scope rather than refusing', () => {
		const texts = readFileTexts({ input: setupOtherKindInput() });

		expect(texts).toStrictEqual({ files: [], tests: [], referenceFiles: [], contents: new Map(), standardsPacks: [] });
	});
});
