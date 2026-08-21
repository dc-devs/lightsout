import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type StandardsCheckFunction, StandardsInputKind, StandardsSeverity } from '#src/contracts/index.ts';
import { validateStandardsPackage } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPackage, LoadedStandardsRule } from '#src/standardsPackages/index.ts';

// Mocked Imports
// -------------------------
// The plugin installed on its own, with no typescript beside it. The engine
// reaches its own compiler through `createRequire`, so refusing that one lookup
// IS the condition under test — and nothing else in this suite resolves a
// module, so the rest of `node:module` is left as it is.
jest.mock('node:module', () => {
	const actual = jest.requireActual<typeof import('node:module')>('node:module');

	return {
		...actual,
		createRequire: () => (id: string) => {
			throw new Error(`Cannot find module '${id}'`);
		},
	};
});
// -------------------------

/** A check that objects to any file named `banned.ts` — small enough to reason about, real enough to fail. */
const bansTheBannedFile: StandardsCheckFunction = ({ input }) =>
	(input.kind === StandardsInputKind.FileList ? input.files : [])
		.filter((file) => file.endsWith('banned.ts'))
		.map((path) => ({
			siteKey: `banned:${path}`,
			files: [{ path }],
			detail: 'a file the rule bans',
		}));

/**
 * A package holding one rule that needs parsed trees and one that does not,
 * both pointed at a real fixture pair: the fail side holds the banned file, the
 * pass side does not.
 */
const setupPackage = () => {
	const fixturesPath = join(mkdtempSync(join(tmpdir(), 'lightsout-validate-no-ts-')), 'fixtures');

	for (const [side, name] of [
		['pass', 'allowed.ts'],
		['fail', 'banned.ts'],
	] as const) {
		mkdirSync(join(fixturesPath, side, 'src'), { recursive: true });
		writeFileSync(join(fixturesPath, side, 'src', name), 'export const value = 1;\n');
	}

	const rule = (overrides: Partial<LoadedStandardsRule> & { id: string }): LoadedStandardsRule => ({
		set: 'code',
		documentPath: 'code/style-guide/structure/module-api',
		summary: 'a rule',
		prose: 'the argument for the rule',
		channel: 'base',
		checked: true,
		defaultSeverity: StandardsSeverity.Advisory,
		defaultSettings: {},
		fixturesPath,
		run: bansTheBannedFile,
		...overrides,
	});

	const pkg: LoadedStandardsPackage = {
		name: 'acme',
		formatVersion: 1,
		rootPath: '/packages/acme',
		documents: [],
		rules: [rule({ id: 'dead-export', inputKind: StandardsInputKind.SyntaxTree }), rule({ id: 'no-banned-file', inputKind: StandardsInputKind.FileList })],
	};

	return { pkg };
};

describe('validateStandardsPackage', () => {
	test('notes the rules it cannot parse fixtures for and still validates the rest', async () => {
		const { pkg } = setupPackage();

		const { problems, notes } = await validateStandardsPackage({ pkg });

		expect(notes).toStrictEqual(['dead-export: not validated — its syntax-tree input needs a typescript this install does not have']);
		// a missing compiler is this machine's shortcoming, not the package's, so
		// the rule that needs none is still held to its fixtures
		expect(problems).toStrictEqual([]);
	});
});
