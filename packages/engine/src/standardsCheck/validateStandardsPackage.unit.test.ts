import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type StandardsCheckRun, StandardsInputKind, StandardsSeverity } from '@/contracts';
import { validateStandardsPackage } from '@/standardsCheck';
import type { LoadedStandardsPackage, LoadedStandardsRule } from '@/standardsPackages';

/** A check that objects to any file named `banned.ts` — small enough to reason about, real enough to fail. */
const bansTheBannedFile: StandardsCheckRun = ({ input }) =>
	(input.kind === StandardsInputKind.FileList ? input.files : [])
		.filter((file) => file.endsWith('banned.ts'))
		.map((path) => ({
			siteKey: `banned:${path}`,
			files: [{ path }],
			detail: 'a file the rule bans',
		}));

/**
 * A rule folder's fixture pair on disk. Each side is a miniature repo the check
 * runs against as if it were the whole thing.
 */
const setupFixtures = ({ pass, fail }: { pass: string[]; fail: string[] }) => {
	const fixturesPath = join(mkdtempSync(join(tmpdir(), 'lightsout-validate-')), 'fixtures');

	for (const [side, files] of [
		['pass', pass],
		['fail', fail],
	] as const) {
		mkdirSync(join(fixturesPath, side, 'src'), { recursive: true });

		for (const name of files) {
			writeFileSync(join(fixturesPath, side, 'src', name), 'export const value = 1;\n');
		}
	}

	return { fixturesPath };
};

/** A rule folder that ships no fixtures at all — the directory is never created. */
const setupWithoutFixtures = () => ({ fixturesPath: join(mkdtempSync(join(tmpdir(), 'lightsout-validate-')), 'fixtures') });

const rule = (overrides: Partial<LoadedStandardsRule> & { id: string; fixturesPath: string }): LoadedStandardsRule => ({
	set: 'code',
	documentPath: 'code/style-guide/structure/module-api',
	summary: 'a rule',
	prose: 'the argument for the rule',
	channel: 'base',
	checked: overrides.run !== undefined,
	defaultSeverity: StandardsSeverity.Advisory,
	defaultSettings: {},
	...overrides,
});

const validate = ({ rules }: { rules: LoadedStandardsRule[] }) => {
	const pkg: LoadedStandardsPackage = { name: 'acme', formatVersion: 1, rootPath: '/packages/acme', documents: [], rules };

	return validateStandardsPackage({ pkg });
};

describe('validateStandardsPackage', () => {
	test('a check that flags its fail fixture and leaves its pass fixture alone reports no problem', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });

		const { problems, notes } = await validate({
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		expect(problems).toStrictEqual([]);
		expect(notes).toStrictEqual([]);
	});

	test('a fail fixture the check does not flag is a check that catches nothing', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['also-allowed.ts'] });

		const { problems } = await validate({
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		expect(problems).toStrictEqual(['no-banned-file: the fail fixture produced no finding — the check does not catch what the rule describes']);
	});

	test('a pass fixture the check flags is a check that cries wolf', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['banned.ts'], fail: ['banned.ts'] });

		const { problems } = await validate({
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		expect(problems).toStrictEqual(['no-banned-file: the pass fixture produced 1 finding(s) — the check flags code the rule allows']);
	});

	test('a rule shipping no fixtures is a problem here — the requirement authoring enforces, not loading', async () => {
		const { fixturesPath } = setupWithoutFixtures();

		const { problems } = await validate({
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		expect(problems).toStrictEqual([
			'no-banned-file: fixtures/fail/ is missing or empty — every rule ships a fixture pair',
			'no-banned-file: fixtures/pass/ is missing or empty — every rule ships a fixture pair',
		]);
	});

	test('a judgment-only rule must still ship the fixtures its accuracy is measured against', async () => {
		const { fixturesPath } = setupWithoutFixtures();

		const { problems, notes } = await validate({ rules: [rule({ id: 'premature-abstraction', fixturesPath })] });

		expect(problems).toStrictEqual([
			'premature-abstraction: fixtures/fail/ is missing or empty — every rule ships a fixture pair',
			'premature-abstraction: fixtures/pass/ is missing or empty — every rule ships a fixture pair',
		]);
		// the missing pair is the whole story — no judgment-only note on top of it
		expect(notes).toStrictEqual([]);
	});

	test('a judgment-only rule is a note, never a problem — its fixtures measure the review agent instead', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });

		const { problems, notes } = await validate({ rules: [rule({ id: 'premature-abstraction', fixturesPath })] });

		expect(problems).toStrictEqual([]);
		expect(notes).toStrictEqual(['premature-abstraction: judgment-only — fixtures reserved for agent accuracy']);
	});

	test('a check that throws on a fixture is reported as a problem against that rule, not raised', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const throwingRun: StandardsCheckRun = () => {
			throw new Error('cannot parse that');
		};

		const { problems } = await validate({ rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: throwingRun })] });

		expect(problems).toStrictEqual([
			'no-banned-file: the fail fixture could not be checked — standards rule "no-banned-file" threw while checking: cannot parse that',
			'no-banned-file: the pass fixture could not be checked — standards rule "no-banned-file" threw while checking: cannot parse that',
		]);
	});

	test('validates a rule that needs parsed trees with the engine own typescript', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const bansTheBannedTree: StandardsCheckRun = ({ input }) =>
			(input.kind === StandardsInputKind.SyntaxTree ? [...input.trees.keys()] : [])
				.filter((path) => path.endsWith('banned.ts'))
				.map((path) => ({
					siteKey: `banned:${path}`,
					files: [{ path }],
					detail: 'a file the rule bans',
				}));

		const { problems, notes } = await validate({
			rules: [rule({ id: 'dead-export', fixturesPath, inputKind: StandardsInputKind.SyntaxTree, run: bansTheBannedTree })],
		});

		// the fixtures live in the engine's own repo, so the compiler is right there
		expect(problems).toStrictEqual([]);
		expect(notes).toStrictEqual([]);
	});

	test('validates every rule in the package, whatever channel it sits on', async () => {
		const first = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const second = setupFixtures({ pass: ['allowed.ts'], fail: ['also-allowed.ts'] });

		const { problems } = await validate({
			rules: [
				rule({ id: 'base-rule', fixturesPath: first.fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile }),
				rule({ id: 'react-rule', channel: 'react', fixturesPath: second.fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile }),
			],
		});

		// authoring covers every channel, whatever the machine doing it runs
		expect(problems).toStrictEqual(['react-rule: the fail fixture produced no finding — the check does not catch what the rule describes']);
	});
});
