import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type StandardsCheckFunction, StandardsInputKind, StandardsSeverity } from '#src/contracts/index.ts';
import { validateStandardsPack } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPack, LoadedStandardsRule } from '#src/standardsPacks/index.ts';

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
 * A pack holding one rule that needs parsed trees and one that does not,
 * both pointed at a real fixture pair: the fail side holds the banned file, the
 * pass side does not.
 *
 * Given `frameworkOwned`, the pack also ships one framework-owned tree holding
 * the banned file — the invariant's own view of a machine with no compiler.
 */
const setupPack = ({ frameworkOwned = false }: { frameworkOwned?: boolean } = {}) => {
	const fixturesPath = join(mkdtempSync(join(tmpdir(), 'lightsout-validate-no-ts-')), 'fixtures');
	const frameworkOwnedFixturesPath = frameworkOwned ? join(mkdtempSync(join(tmpdir(), 'lightsout-validate-no-ts-')), 'fixtures', 'framework-owned') : undefined;

	if (frameworkOwnedFixturesPath !== undefined) {
		mkdirSync(join(frameworkOwnedFixturesPath, 'nestjs', 'src'), { recursive: true });
		writeFileSync(join(frameworkOwnedFixturesPath, 'nestjs', 'package.json'), '{ "name": "nestjs-tree" }\n');
		writeFileSync(join(frameworkOwnedFixturesPath, 'nestjs', 'src', 'banned.ts'), 'export const value = 1;\n');
	}

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

	const pack: LoadedStandardsPack = {
		name: 'acme',
		formatVersion: 1,
		rootPath: '/packages/acme',
		frameworkOwnedFixturesPath,
		documents: [],
		rules: [rule({ id: 'dead-export', inputKind: StandardsInputKind.SyntaxTree }), rule({ id: 'no-banned-file', inputKind: StandardsInputKind.FileList })],
	};

	return { pack };
};

describe('validateStandardsPack', () => {
	test('notes the rules it cannot parse fixtures for and still validates the rest', async () => {
		const { pack } = setupPack();

		const { problems, notes } = await validateStandardsPack({ pack });

		expect(notes).toStrictEqual([
			'dead-export: not validated — its syntax-tree input needs a typescript this install does not have',
			// the pack ships no framework-owned tree, which is recorded and never required
			'acme: no fixtures/framework-owned/ — no rule was held to the framework-owned invariant',
		]);
		// a missing compiler is this machine's shortcoming, not the pack's, so
		// the rule that needs none is still held to its fixtures
		expect(problems).toStrictEqual([]);
	});

	test('holds the rules it can run to the framework-owned invariant and passes silently over the ones it cannot', async () => {
		const { pack } = setupPack({ frameworkOwned: true });

		const { problems, notes } = await validateStandardsPack({ pack });

		// the syntax-tree rule is named once, by the per-rule loop, and not again
		// per framework — a machine with no compiler would otherwise say it twice
		expect(notes).toStrictEqual(['dead-export: not validated — its syntax-tree input needs a typescript this install does not have']);
		expect(problems).toStrictEqual([
			'no-banned-file: the nestjs framework-owned tree produced 1 finding(s) — a checked rule stays silent on code its framework owns (src/banned.ts)',
		]);
	});
});
