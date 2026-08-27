/**
 * @jest-environment node
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { StandardsSet } from '#src/contracts/index.ts';
import { getStandardsPackView, listStandardsPacks, StandardsPackNotFoundError } from '#src/views/index.ts';

/** Write a set of repo-relative files, creating the folders they need. */
const writeTree = async ({ dir, files }: { dir: string; files: Record<string, string> }) => {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content, 'utf8');
	}
};

/**
 * This monorepo, as a repo the pages are served from.
 *
 * The pack pages read the AUTHORED default pack rather than the built copy,
 * because the built copy ships without the fixtures a rule argues from. Anchored
 * on this file rather than on the working directory, which depends on where the
 * runner was invoked from.
 */
const setupThisRepo = () => ({ cwd: join(__dirname, '..', '..', '..', '..') });

/** A repo of somebody's own, on a house pack: one checked rule with both fixture sides, one judgment-only rule. */
const setupHouseRepo = async ({ name = 'acme' }: { name?: string } = {}) => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-packs-repo-'));

	await writeTree({
		dir: cwd,
		files: {
			'lightsout.config.json': JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false }, 'standards-packs': ['./house'] }),
			'house/lightsout-standards.json': JSON.stringify({ name, formatVersion: 1, description: 'what this shop agrees on' }),
			'house/code/house/document.md': '---\nchannel: react\n---\n\n# House Style\n\nWhat this shop agrees on.\n',
			'house/code/house/05-house-loose-file/rule.md':
				'---\nsummary: a source file outside a module\nchecked: false\nseverity: blocking\n---\n\nEvery file belongs to a module.\n',
			'house/code/house/05-house-loose-file/fixtures/pass/src/mod/index.ts': 'export const mod = 1;\n',
			'house/code/house/05-house-loose-file/fixtures/fail/src/loose.ts': 'export const loose = 1;\n',
			'house/code/house/10-house-name-things-well/rule.md': '---\nsummary: a name that hides what it does\n---\n\nNames are the cheapest documentation.\n',
		},
	});

	return { cwd };
};

describe('getStandardsPackView', () => {
	test('reads the authored default pack this repo ships, with the counts its folders actually hold', async () => {
		const { cwd } = setupThisRepo();

		const view = await getStandardsPackView({ cwd, name: 'lightsout-defaults' });

		// recount before changing these — the pack moves, and the numbers are the
		// only place the page's claim about it is pinned. Every rule ships both
		// sides of its proof, judgment-only ones included, which is why
		// `withFixtures` matches `rules` rather than `checked`.
		expect(view.totals).toStrictEqual({ rules: 111, checked: 52, judgment: 59, documents: 24, withFixtures: 111 });
	});

	test('says the default pack is the one a run loads when the config names none', async () => {
		const { cwd } = setupThisRepo();

		const view = await getStandardsPackView({ cwd, name: 'lightsout-defaults' });

		expect({ isDefault: view.isDefault, built: view.built }).toStrictEqual({ isDefault: true, built: false });
	});

	test('lists every rule as a row and every document as a group, with no prose or fixture text on either', async () => {
		const { cwd } = setupThisRepo();

		const view = await getStandardsPackView({ cwd, name: 'lightsout-defaults' });
		const rule = view.rules.find((entry) => entry.id === 'type-assertion');

		expect(view.rules).toHaveLength(view.totals.rules);
		expect(view.documents).toHaveLength(view.totals.documents);
		// the row carries what a listing needs and nothing that would make the
		// payload heavy — `prose` and `fixtures` arrive per rule
		expect(rule).toStrictEqual({
			id: 'type-assertion',
			set: StandardsSet.Code,
			documentPath: 'code/style-guide/typescript/type-assertions',
			summary: 'an `as` cast in source code, where narrowing would prove the type instead',
			channel: 'base',
			checked: true,
			defaultSeverity: 'blocking',
			defaultSettings: {},
			fixtureCounts: { pass: 2, fail: 1 },
		});
	});

	test('names the channels the pack offers, so a reader sees which rules only some repos run', async () => {
		const { cwd } = setupThisRepo();

		const view = await getStandardsPackView({ cwd, name: 'lightsout-defaults' });

		expect(view.channels).toStrictEqual(['base', 'nestjs', 'react', 'tanstack']);
	});

	test("groups the rules under the document that argues for them, carrying that document's intro and channel", async () => {
		const { cwd } = await setupHouseRepo();

		const view = await getStandardsPackView({ cwd, name: 'acme' });

		// the group header a reader opens is this intro, and the channel is what says
		// the whole group sits out on a repo that does not run react
		expect(view.documents).toStrictEqual([
			{
				set: StandardsSet.Code,
				path: 'code/house',
				channel: 'react',
				intro: '# House Style\n\nWhat this shop agrees on.',
				ruleIds: ['house-loose-file', 'house-name-things-well'],
			},
		]);
	});

	test("reads a repo's own configured pack, and says where a standards-packs entry would point", async () => {
		const { cwd } = await setupHouseRepo();

		const view = await getStandardsPackView({ cwd, name: 'acme' });

		expect({ path: view.path, isDefault: view.isDefault, description: view.description }).toStrictEqual({
			path: 'house',
			isDefault: false,
			description: 'what this shop agrees on',
		});
	});

	test('counts a rule as having examples only when both sides of its proof are there', async () => {
		const { cwd } = await setupHouseRepo();

		const view = await getStandardsPackView({ cwd, name: 'acme' });

		expect(view.totals).toStrictEqual({ rules: 2, checked: 0, judgment: 2, documents: 1, withFixtures: 1 });
	});

	test('refuses a name no pack this repo loads answers to, rather than resolving to nothing', async () => {
		const { cwd } = await setupHouseRepo();

		await expect(getStandardsPackView({ cwd, name: 'no-such-pack' })).rejects.toThrow(StandardsPackNotFoundError);
	});
});

describe('listStandardsPacks', () => {
	test('lists the packs a repo loads without their rules, so the packs page stays light', async () => {
		const { cwd } = await setupHouseRepo();

		const packs = await listStandardsPacks({ cwd });

		expect(packs.map((pack) => pack.name)).toStrictEqual(['acme']);
		expect(Object.keys(packs[0] ?? {}).sort()).toStrictEqual(['built', 'channels', 'description', 'isDefault', 'name', 'path', 'rootPath', 'totals']);
	});

	test('lists nothing for a repo that switched standards off, rather than falling back to the default pack', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'lightsout-packs-none-'));

		await writeTree({
			dir: cwd,
			files: { 'lightsout.config.json': JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false }, 'standards-packs': false }) },
		});

		expect(await listStandardsPacks({ cwd })).toStrictEqual([]);
	});

	test('skips a pack it cannot read and lists the ones it could, so one broken root never blanks the page', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'lightsout-packs-broken-'));

		await writeTree({
			dir: cwd,
			files: {
				'lightsout.config.json': JSON.stringify({
					gates: { check: 'true', test: 'true', 'test-coverage': false },
					'standards-packs': ['./missing', './house'],
				}),
				'house/lightsout-standards.json': JSON.stringify({ name: 'acme', formatVersion: 1 }),
				'house/code/house/document.md': '# House Style\n',
				'house/code/house/05-house-loose-file/rule.md': '---\nsummary: a source file outside a module\n---\n',
			},
		});

		expect((await listStandardsPacks({ cwd })).map((pack) => pack.name)).toStrictEqual(['acme']);
	});
});
