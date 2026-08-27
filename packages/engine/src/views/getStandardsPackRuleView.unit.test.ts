/**
 * @jest-environment node
 */
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FixtureSide } from '#src/contracts/index.ts';
import { getStandardsPackRuleView, StandardsPackNotFoundError, StandardsPackRuleNotFoundError } from '#src/views/index.ts';

/** Write a set of folder-relative files, creating the folders they need. */
const writeTree = async ({ dir, files }: { dir: string; files: Record<string, string> }) => {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content, 'utf8');
	}
};

/**
 * This monorepo, as a repo the pages are served from — so the rule read here is
 * the authored one, fixtures and all, rather than the copy the plugin ships.
 */
const setupThisRepo = () => ({ cwd: join(__dirname, '..', '..', '..', '..') });

/**
 * A repo of somebody's own, on a house pack of two rules: one that argues its
 * case and ships a pass side holding a readable file next to a dangling symlink,
 * and one that states only a summary and ships no proof at all.
 */
const setupHouseRepo = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-pack-rule-'));
	const ruleFolder = 'house/code/house/05-house-loose-file';

	await writeTree({
		dir: cwd,
		files: {
			'lightsout.config.json': JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false }, 'standards-packs': ['./house'] }),
			'house/lightsout-standards.json': JSON.stringify({ name: 'acme', formatVersion: 1 }),
			'house/code/house/document.md': '# House Style\n',
			[`${ruleFolder}/rule.md`]: '---\nsummary: a source file outside a module\n---\n\nEvery file belongs to a module.\n',
			[`${ruleFolder}/fixtures/pass/present.ts`]: 'export const present = 1;\n',
			[`${ruleFolder}/fixtures/fail/loose.ts`]: 'export const loose = 1;\n',
			'house/code/house/10-house-name-things-well/rule.md': '---\nsummary: a name that hides what it does\n---\n',
		},
	});
	// A link to a file that was never there: the folder listing offers it like any
	// other entry, and only the read finds out.
	await symlink('./nowhere.ts', join(cwd, ruleFolder, 'fixtures', 'pass', 'missing.ts'));

	return { cwd };
};

describe('getStandardsPackRuleView', () => {
	test("carries the rule's own prose, which is what the page argues from", async () => {
		const { cwd } = setupThisRepo();

		const view = await getStandardsPackRuleView({ cwd, name: 'lightsout-defaults', rule: 'type-assertion' });

		expect(view.prose).toContain('Avoid `as` casts');
	});

	test('reads both sides of a proof as whole source trees, so a multi-file fixture arrives whole', async () => {
		const { cwd } = setupThisRepo();

		const view = await getStandardsPackRuleView({ cwd, name: 'lightsout-defaults', rule: 'type-assertion' });

		// the pass side is a payload reader plus the named-constant file it was
		// carved out into — a flat read would show the first and drop the carve-out
		// the fixture exists to demonstrate
		expect(view.fixtures.map((fixture) => [fixture.side, fixture.path])).toStrictEqual([
			[FixtureSide.Pass, 'src/payloads/common/constants/PayloadKind.ts'],
			[FixtureSide.Pass, 'src/payloads/readLabel.ts'],
			[FixtureSide.Fail, 'src/payloads/readLabel.ts'],
		]);
	});

	test('carries the text of each fixture file, not just its path', async () => {
		const { cwd } = setupThisRepo();

		const view = await getStandardsPackRuleView({ cwd, name: 'lightsout-defaults', rule: 'type-assertion' });
		const failing = view.fixtures.find((fixture) => fixture.side === FixtureSide.Fail);

		expect(failing?.text).toContain('as ');
	});

	test('counts the files on each side, so a listing row can say a rule has examples without reading them', async () => {
		const { cwd } = setupThisRepo();

		const view = await getStandardsPackRuleView({ cwd, name: 'lightsout-defaults', rule: 'type-assertion' });

		expect(view.fixtureCounts).toStrictEqual({ pass: 2, fail: 1 });
	});

	test('answers with no prose and no proof for a rule that states only a summary, since that is a rule as much as any other', async () => {
		const { cwd } = await setupHouseRepo();

		const view = await getStandardsPackRuleView({ cwd, name: 'acme', rule: 'house-name-things-well' });

		// a rule folder that ships neither a body nor a fixtures folder is a normal
		// state the page renders, not a read that failed
		expect({ prose: view.prose, fixtures: view.fixtures, fixtureCounts: view.fixtureCounts }).toStrictEqual({
			prose: '',
			fixtures: [],
			fixtureCounts: { pass: 0, fail: 0 },
		});
	});

	test('leaves out a fixture file it cannot read and carries the rest of that side, rather than losing the whole proof', async () => {
		const { cwd } = await setupHouseRepo();

		const view = await getStandardsPackRuleView({ cwd, name: 'acme', rule: 'house-loose-file' });

		expect(view.fixtures.map((fixture) => [fixture.side, fixture.path])).toStrictEqual([
			[FixtureSide.Pass, 'present.ts'],
			[FixtureSide.Fail, 'loose.ts'],
		]);
		// the count a listing row shows follows what could actually be read
		expect(view.fixtureCounts).toStrictEqual({ pass: 1, fail: 1 });
	});

	test('refuses a rule id the pack does not carry, naming the pack that was found', async () => {
		const { cwd } = setupThisRepo();

		await expect(getStandardsPackRuleView({ cwd, name: 'lightsout-defaults', rule: 'no-such-rule' })).rejects.toThrow(StandardsPackRuleNotFoundError);
	});

	test('refuses a pack name no pack this repo loads answers to', async () => {
		const { cwd } = setupThisRepo();

		await expect(getStandardsPackRuleView({ cwd, name: 'no-such-pack', rule: 'type-assertion' })).rejects.toThrow(StandardsPackNotFoundError);
	});
});
