import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import ts from 'typescript';
import { type StandardsCheckFunction, StandardsInputKind, StandardsSeverity } from '#src/contracts/index.ts';
import { checkFixtureTree } from '#src/standardsCheck/common/utils/checkFixtureTree.ts';
import type { LoadedStandardsRule } from '#src/standardsPacks/index.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

/** A check that objects to any file named `banned.ts` — small enough to reason about, real enough to fail. */
const bansTheBannedFile: StandardsCheckFunction = ({ input }) =>
	(input.kind === StandardsInputKind.FileList ? input.files : [])
		.filter((file) => file.endsWith('banned.ts'))
		.map((path) => ({
			siteKey: `banned:${path}`,
			files: [{ path }],
			detail: 'a file the rule bans',
		}));

/** A check that reports the split it was handed rather than judging anything — the only way to assert what reached it. */
const reportsWhatItWasHanded: StandardsCheckFunction = ({ input }) =>
	input.kind === StandardsInputKind.FileList
		? [
				{
					siteKey: 'handed',
					files: [],
					detail: `source=${input.source.join('|')} tests=${input.tests.join('|')} packs=${input.standardsPacks.length}`,
				},
			]
		: [];

/** The same ban, asked of the files the engine could type rather than of the path list. */
const bansTheBannedTypedFile: StandardsCheckFunction = ({ input }) =>
	(input.kind === StandardsInputKind.TypeChecker ? [...input.typedFiles.keys()] : [])
		.filter((path) => path.endsWith('banned.ts'))
		.map((path) => ({
			siteKey: `banned:${path}`,
			files: [{ path }],
			detail: 'a file the rule bans',
		}));

/** A tree of source files under `src/`, run against as if it were a whole repo. */
const setupTree = ({ files }: { files: string[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-fixture-tree-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });

	for (const name of files) {
		writeFileSync(join(cwd, 'src', name), 'export const value = 1;\n');
	}

	return { cwd };
};

const rule: LoadedStandardsRule = {
	id: 'no-banned-file',
	set: 'code',
	documentPath: 'code/style-guide/structure/module-api',
	summary: 'a rule',
	prose: 'the argument for the rule',
	channel: 'base',
	checked: true,
	defaultSeverity: StandardsSeverity.Advisory,
	defaultSettings: {},
	fixturesPath: '/packages/acme/code/style-guide/structure/module-api/05-no-banned-file/fixtures',
};

describe('checkFixtureTree', () => {
	test('hands back what the check flagged in the tree it was pointed at', async () => {
		const { cwd } = setupTree({ files: ['allowed.ts', 'banned.ts'] });

		const found = await checkFixtureTree({ cwd, rule, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile, label: 'fixtures/pass/' });

		expect(found).toStrictEqual([{ siteKey: 'banned:src/banned.ts', files: [{ path: 'src/banned.ts' }], detail: 'a file the rule bans' }]);
	});

	test('a type-checker tree with no tsconfig throws a message naming the label it was given, not the folder it read', async () => {
		const { cwd } = setupTree({ files: ['banned.ts'] });

		const error = await getRejectionError({
			promise: checkFixtureTree({
				cwd,
				rule,
				inputKind: StandardsInputKind.TypeChecker,
				run: bansTheBannedTypedFile,
				label: 'fixtures/framework-owned/nestjs/',
				compiler: ts,
			}),
		});

		// the temp folder the tree actually lives in never appears — the caller
		// names it, because only the caller knows what it is to the reader
		expect(error.message).toBe(
			"no tsconfig.json in fixtures/framework-owned/nestjs/, so none of its 1 file(s) could be typed — a type-checker rule's fixtures need one",
		);
	});

	test('a tree holding no files at all is silence rather than a tsconfig the author forgot', async () => {
		const { cwd } = setupTree({ files: [] });

		const found = await checkFixtureTree({
			cwd,
			rule,
			inputKind: StandardsInputKind.TypeChecker,
			run: bansTheBannedTypedFile,
			label: 'fixtures/pass/',
			compiler: ts,
		});

		expect(found).toStrictEqual([]);
	});

	test('splits test files out of source and declares no pack — the tree is a miniature repo of its own', async () => {
		const { cwd } = setupTree({ files: ['allowed.ts', 'allowed.unit.test.ts'] });

		const found = await checkFixtureTree({ cwd, rule, inputKind: StandardsInputKind.FileList, run: reportsWhatItWasHanded, label: 'fixtures/pass/' });

		expect(found).toStrictEqual([{ siteKey: 'handed', files: [], detail: 'source=src/allowed.ts tests=src/allowed.unit.test.ts packs=0' }]);
	});
});
