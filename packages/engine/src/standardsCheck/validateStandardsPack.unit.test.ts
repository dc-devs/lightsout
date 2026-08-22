import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type StandardsCheckFunction, StandardsInputKind, StandardsSeverity } from '#src/contracts/index.ts';
import { validateStandardsPack } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPack, LoadedStandardsRule } from '#src/standardsPacks/index.ts';

/** A check that objects to any file named `banned.ts` — small enough to reason about, real enough to fail. */
const bansTheBannedFile: StandardsCheckFunction = ({ input }) =>
	(input.kind === StandardsInputKind.FileList ? input.files : [])
		.filter((file) => file.endsWith('banned.ts'))
		.map((path) => ({
			siteKey: `banned:${path}`,
			files: [{ path }],
			detail: 'a file the rule bans',
		}));

/** The same ban, asked of the files the engine could type rather than of the path list. */
const bansTheBannedTypedFile: StandardsCheckFunction = ({ input }) =>
	(input.kind === StandardsInputKind.TypeChecker ? [...input.typedFiles.keys()] : [])
		.filter((path) => path.endsWith('banned.ts'))
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

/**
 * A fixture pair whose sides each carry a tsconfig of their own. A type-checker
 * rule needs one on the side it is run against: a fixture side is a miniature
 * repo, and a program has nothing to type its files with otherwise.
 */
const setupTypedFixtures = ({ pass, fail }: { pass: string[]; fail: string[] }) => {
	const { fixturesPath } = setupFixtures({ pass, fail });

	for (const side of ['pass', 'fail'] as const) {
		writeFileSync(join(fixturesPath, side, 'tsconfig.json'), '{ "compilerOptions": { "strict": true, "noEmit": true }, "include": ["src"] }\n');
	}

	return { fixturesPath };
};

/** A rule folder that ships no fixtures at all — the directory is never created. */
const setupWithoutFixtures = () => ({ fixturesPath: join(mkdtempSync(join(tmpdir(), 'lightsout-validate-')), 'fixtures') });

/**
 * A rule folder whose fail side is a directory holding nothing. A side that was
 * never created cannot show this: the pair is demanded of an empty folder too.
 */
const setupEmptyFailFixture = () => {
	const fixturesPath = join(mkdtempSync(join(tmpdir(), 'lightsout-validate-')), 'fixtures');

	mkdirSync(join(fixturesPath, 'pass', 'src'), { recursive: true });
	writeFileSync(join(fixturesPath, 'pass', 'src', 'allowed.ts'), 'export const value = 1;\n');
	mkdirSync(join(fixturesPath, 'fail'), { recursive: true });

	return { fixturesPath };
};

/** A fixture pair for each of two rules: one whose check catches what its rule describes, one whose check catches nothing. */
const setupTwoRuleFixtures = () => ({
	catching: setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] }).fixturesPath,
	blind: setupFixtures({ pass: ['allowed.ts'], fail: ['also-allowed.ts'] }).fixturesPath,
});

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

const validate = ({ rules, built }: { rules: LoadedStandardsRule[]; built?: true }) => {
	const pack: LoadedStandardsPack = { name: 'acme', formatVersion: 1, built, rootPath: '/packages/acme', documents: [], rules };

	return validateStandardsPack({ pack });
};

describe('validateStandardsPack', () => {
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

	test('a built pack is one problem about the pack, not a missing pair charged to every rule it holds', async () => {
		const { fixturesPath } = setupWithoutFixtures();

		const { problems, notes } = await validate({
			built: true,
			rules: [
				rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile }),
				rule({ id: 'premature-abstraction', fixturesPath }),
			],
		});

		// two rules, both stripped, and neither named: the build took the fixtures,
		// so there is nothing here either author could have done differently
		expect(problems).toStrictEqual([
			'acme is a built pack — its fixtures were left behind when it was built, so there is nothing here to validate. Point --pack at the authored source.',
		]);
		expect(notes).toStrictEqual([]);
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

	test('a fixture side that exists but holds nothing is missing all the same', async () => {
		const { fixturesPath } = setupEmptyFailFixture();

		const { problems, notes } = await validate({
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		// only the empty side is named — the populated one is a pair member already
		expect(problems).toStrictEqual(['no-banned-file: fixtures/fail/ is missing or empty — every rule ships a fixture pair']);
		expect(notes).toStrictEqual([]);
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

	test('a rule shipping a check but declaring no input kind is judgment-only — there is no input to run it against', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });

		const { problems, notes } = await validate({ rules: [rule({ id: 'premature-abstraction', fixturesPath, run: bansTheBannedFile })] });

		expect(problems).toStrictEqual([]);
		expect(notes).toStrictEqual(['premature-abstraction: judgment-only — fixtures reserved for agent accuracy']);
	});

	test('a check that throws on a fixture is reported as a problem against that rule, not raised', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const throwingRun: StandardsCheckFunction = () => {
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
		const bansTheBannedTree: StandardsCheckFunction = ({ input }) =>
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

	test('validates a rule that needs a type checker against fixture sides that carry a tsconfig', async () => {
		const { fixturesPath } = setupTypedFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });

		const { problems, notes } = await validate({
			rules: [rule({ id: 'discriminant-const-object', fixturesPath, inputKind: StandardsInputKind.TypeChecker, run: bansTheBannedTypedFile })],
		});

		expect(problems).toStrictEqual([]);
		expect(notes).toStrictEqual([]);
	});

	test('a type-checker fixture side with no tsconfig is named as such, not reported as a check that catches nothing', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });

		const { problems } = await validate({
			rules: [rule({ id: 'discriminant-const-object', fixturesPath, inputKind: StandardsInputKind.TypeChecker, run: bansTheBannedTypedFile })],
		});

		// a side the engine could type nothing in hands the check nothing, and the
		// silence that follows would otherwise send the author to the check
		expect(problems).toStrictEqual([
			"discriminant-const-object: the fail fixture could not be checked — no tsconfig.json in fixtures/fail/, so none of its 1 file(s) could be typed — a type-checker rule's fixtures need one",
			"discriminant-const-object: the pass fixture could not be checked — no tsconfig.json in fixtures/pass/, so none of its 1 file(s) could be typed — a type-checker rule's fixtures need one",
		]);
	});

	test('validates every rule in the pack, whatever channel it sits on', async () => {
		const { catching, blind } = setupTwoRuleFixtures();

		const { problems } = await validate({
			rules: [
				rule({ id: 'base-rule', fixturesPath: catching, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile }),
				rule({ id: 'react-rule', channel: 'react', fixturesPath: blind, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile }),
			],
		});

		// authoring covers every channel, whatever the machine doing it runs
		expect(problems).toStrictEqual(['react-rule: the fail fixture produced no finding — the check does not catch what the rule describes']);
	});
});
