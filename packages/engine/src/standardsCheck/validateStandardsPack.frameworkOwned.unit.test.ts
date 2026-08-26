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

/** The same ban, plus a file it cannot cope with — so the throw lands on the framework-owned tree alone and the rule's own pair stays clean. */
const bansTheBannedButChokes: StandardsCheckFunction = ({ input }) => {
	const files = input.kind === StandardsInputKind.FileList ? input.files : [];

	if (files.some((file) => file.endsWith('explodes.ts'))) {
		throw new Error('cannot parse that');
	}

	return files.filter((file) => file.endsWith('banned.ts')).map((path) => ({ siteKey: `banned:${path}`, files: [{ path }], detail: 'a file the rule bans' }));
};

/** A check that objects to every file it is handed — the way to watch one problem line name more paths than it has room for. */
const bansEveryFile: StandardsCheckFunction = ({ input }) =>
	(input.kind === StandardsInputKind.FileList ? input.files : []).map((path) => ({
		siteKey: `banned:${path}`,
		files: [{ path }],
		detail: 'a file the rule bans',
	}));

/** A check that objects to the shape of the tree rather than to any file in it — a finding with nowhere to point. */
const bansTheWholeTree: StandardsCheckFunction = ({ input }) =>
	input.kind === StandardsInputKind.FileList && input.files.length > 0 ? [{ siteKey: 'banned:tree', files: [], detail: 'a shape the rule bans' }] : [];

/**
 * A rule folder's fixture pair on disk. Each side is a miniature repo the check
 * runs against as if it were the whole thing; a side listing no files is a
 * populated pair all the same, which is what keeps the per-rule loop quiet
 * while the invariant is the thing under test.
 */
const setupFixtures = ({ pass, fail }: { pass: string[]; fail: string[] }) => {
	const fixturesPath = join(mkdtempSync(join(tmpdir(), 'lightsout-framework-owned-')), 'fixtures');

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
const setupWithoutFixtures = () => ({ fixturesPath: join(mkdtempSync(join(tmpdir(), 'lightsout-framework-owned-')), 'fixtures') });

/**
 * A pack's framework-owned trees on disk: one miniature repo per framework,
 * each declaring that framework in a manifest of its own, exactly as a real
 * package earns its carve-outs. Given no framework, the folder itself is never
 * written — a path the pack names and disk does not have.
 */
const setupFrameworkOwned = ({ frameworks }: { frameworks: Record<string, string[]> }) => {
	const frameworkOwnedFixturesPath = join(mkdtempSync(join(tmpdir(), 'lightsout-framework-owned-')), 'fixtures', 'framework-owned');

	for (const [framework, files] of Object.entries(frameworks)) {
		mkdirSync(join(frameworkOwnedFixturesPath, framework, 'src'), { recursive: true });
		writeFileSync(join(frameworkOwnedFixturesPath, framework, 'package.json'), `{ "name": "${framework}-tree" }\n`);

		for (const name of files) {
			writeFileSync(join(frameworkOwnedFixturesPath, framework, 'src', name), 'export const value = 1;\n');
		}
	}

	return { frameworkOwnedFixturesPath };
};

/** The framework-owned folder with a loose file in it and no framework beside it — a folder that exists and holds no tree. */
const setupUnpopulatedFrameworkOwned = () => {
	const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: {} });

	mkdirSync(frameworkOwnedFixturesPath, { recursive: true });
	writeFileSync(join(frameworkOwnedFixturesPath, 'README.md'), 'one folder per framework\n');

	return { frameworkOwnedFixturesPath };
};

/** What a pack holding no rule to the invariant is told — a note, whatever the reason there was no tree to hold it to. */
const noFrameworkOwnedNote = 'acme: no fixtures/framework-owned/ — no rule was held to the framework-owned invariant';

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

const validate = ({ rules, built, frameworkOwnedFixturesPath }: { rules: LoadedStandardsRule[]; built?: true; frameworkOwnedFixturesPath?: string }) => {
	const pack: LoadedStandardsPack = { name: 'acme', formatVersion: 1, built, rootPath: '/packages/acme', frameworkOwnedFixturesPath, documents: [], rules };

	return validateStandardsPack({ pack });
};

describe('validateStandardsPack', () => {
	test('a checked rule silent on every framework-owned tree adds neither a problem nor a note', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: { 'tanstack-start': ['allowed.ts'] } });

		const { problems, notes } = await validate({
			frameworkOwnedFixturesPath,
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		expect(problems).toStrictEqual([]);
		expect(notes).toStrictEqual([]);
	});

	test('a checked rule that fires on a framework-owned tree is a problem naming the rule, the framework and the file', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: { nestjs: ['banned.ts'] } });

		const { problems } = await validate({
			frameworkOwnedFixturesPath,
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		expect(problems).toStrictEqual([
			'no-banned-file: the nestjs framework-owned tree produced 1 finding(s) — a checked rule stays silent on code its framework owns (src/banned.ts)',
		]);
	});

	test('a rule firing on one framework-owned tree names only that one', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: { nestjs: ['banned.ts'], 'tanstack-start': ['allowed.ts'] } });

		const { problems, notes } = await validate({
			frameworkOwnedFixturesPath,
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		// both trees were checked — the silent one simply had nothing to say
		expect(problems).toStrictEqual([
			'no-banned-file: the nestjs framework-owned tree produced 1 finding(s) — a checked rule stays silent on code its framework owns (src/banned.ts)',
		]);
		expect(notes).toStrictEqual([]);
	});

	test('the trees are checked in name order, whatever order they were written in', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: { nestjs: ['banned.ts'], angular: ['banned.ts'] } });

		const { problems } = await validate({
			frameworkOwnedFixturesPath,
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		// written nestjs-first and reported angular-first: the list reads the same
		// way twice running, whatever order the filesystem hands its entries back
		expect(problems).toStrictEqual([
			'no-banned-file: the angular framework-owned tree produced 1 finding(s) — a checked rule stays silent on code its framework owns (src/banned.ts)',
			'no-banned-file: the nestjs framework-owned tree produced 1 finding(s) — a checked rule stays silent on code its framework owns (src/banned.ts)',
		]);
	});

	test('a problem names three offending files and says there are more, rather than running the whole list', async () => {
		const { fixturesPath } = setupFixtures({ pass: [], fail: ['banned.ts'] });
		const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: { nestjs: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] } });

		const { problems } = await validate({
			frameworkOwnedFixturesPath,
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansEveryFile })],
		});

		// the count is the whole truth; the paths are enough to go looking with
		expect(problems).toStrictEqual([
			'no-banned-file: the nestjs framework-owned tree produced 4 finding(s) — a checked rule stays silent on code its framework owns (src/a.ts, src/b.ts, src/c.ts, …)',
		]);
	});

	test('a finding that names no file contributes nothing to the paths a problem lists', async () => {
		const { fixturesPath } = setupFixtures({ pass: [], fail: ['banned.ts'] });
		const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: { nestjs: ['allowed.ts'] } });

		const { problems } = await validate({
			frameworkOwnedFixturesPath,
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheWholeTree })],
		});

		// a finding pointing at the tree rather than a file still counts, and the
		// empty list is what says the rule would not name one
		expect(problems).toStrictEqual([
			'no-banned-file: the nestjs framework-owned tree produced 1 finding(s) — a checked rule stays silent on code its framework owns ()',
		]);
	});

	test('a check that throws on a framework-owned tree is reported against that rule, not raised', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: { nestjs: ['explodes.ts'] } });

		const { problems, notes } = await validate({
			frameworkOwnedFixturesPath,
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedButChokes })],
		});

		// the rule's own pair went through cleanly, so the tree is the only thing
		// the author has to go looking at
		expect(problems).toStrictEqual([
			'no-banned-file: the nestjs framework-owned tree could not be checked — standards rule "no-banned-file" threw while checking: cannot parse that',
		]);
		expect(notes).toStrictEqual([]);
	});

	test('a pack shipping no framework-owned tree is told so, and its per-rule verdicts are untouched', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['banned.ts'], fail: ['banned.ts'] });

		const { problems, notes } = await validate({
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		expect(problems).toStrictEqual(['no-banned-file: the pass fixture produced 1 finding(s) — the check flags code the rule allows']);
		expect(notes).toStrictEqual([noFrameworkOwnedNote]);
	});

	test('a framework-owned folder the pack names but disk does not have is the same note, never a fault', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: {} });

		const { problems, notes } = await validate({
			frameworkOwnedFixturesPath,
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		// an unreadable folder is a pack that holds nothing to the invariant, which
		// is exactly what a pack with no folder at all is
		expect(problems).toStrictEqual([]);
		expect(notes).toStrictEqual([noFrameworkOwnedNote]);
	});

	test('a framework-owned folder holding no tree of its own is the same note', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const { frameworkOwnedFixturesPath } = setupUnpopulatedFrameworkOwned();

		const { problems, notes } = await validate({
			frameworkOwnedFixturesPath,
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		// a loose file beside the frameworks is not one: a framework is a folder
		expect(problems).toStrictEqual([]);
		expect(notes).toStrictEqual([noFrameworkOwnedNote]);
	});

	test('a judgment-only rule is skipped by the invariant rather than reported against it', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: { nestjs: ['banned.ts'] } });

		const { problems, notes } = await validate({ frameworkOwnedFixturesPath, rules: [rule({ id: 'premature-abstraction', fixturesPath })] });

		// there is no check to hold to silence, and the judgment-only note already said so once
		expect(problems).toStrictEqual([]);
		expect(notes).toStrictEqual(['premature-abstraction: judgment-only — fixtures reserved for agent accuracy']);
	});

	test('a rule shipping a check but declaring no input kind is skipped too — there is no input to run it against', async () => {
		const { fixturesPath } = setupFixtures({ pass: ['allowed.ts'], fail: ['banned.ts'] });
		const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: { nestjs: ['banned.ts'] } });

		const { problems, notes } = await validate({
			frameworkOwnedFixturesPath,
			rules: [rule({ id: 'premature-abstraction', fixturesPath, run: bansTheBannedFile })],
		});

		expect(problems).toStrictEqual([]);
		expect(notes).toStrictEqual(['premature-abstraction: judgment-only — fixtures reserved for agent accuracy']);
	});

	test('a rule owing its author a fixture pair still owes framework-owned code silence', async () => {
		const { fixturesPath } = setupWithoutFixtures();
		const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: { nestjs: ['banned.ts'] } });

		const { problems } = await validate({
			frameworkOwnedFixturesPath,
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		// the per-rule loop gave up on this rule; the invariant is not gated on it
		expect(problems).toStrictEqual([
			'no-banned-file: fixtures/fail/ is missing or empty — every rule ships a fixture pair',
			'no-banned-file: fixtures/pass/ is missing or empty — every rule ships a fixture pair',
			'no-banned-file: the nestjs framework-owned tree produced 1 finding(s) — a checked rule stays silent on code its framework owns (src/banned.ts)',
		]);
	});

	test('a built pack is still one problem about the pack, framework-owned trees included', async () => {
		const { fixturesPath } = setupWithoutFixtures();
		const { frameworkOwnedFixturesPath } = setupFrameworkOwned({ frameworks: { nestjs: ['banned.ts'] } });

		const { problems, notes } = await validate({
			built: true,
			frameworkOwnedFixturesPath,
			rules: [rule({ id: 'no-banned-file', fixturesPath, inputKind: StandardsInputKind.FileList, run: bansTheBannedFile })],
		});

		expect(problems).toStrictEqual([
			'acme is a built pack — its fixtures were left behind when it was built, so there is nothing here to validate. Point --pack at the authored source.',
		]);
		expect(notes).toStrictEqual([]);
	});
});
