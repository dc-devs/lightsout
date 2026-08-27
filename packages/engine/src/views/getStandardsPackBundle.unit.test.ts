/**
 * @jest-environment node
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { FixtureSide } from '#src/contracts/index.ts';
import { getStandardsPackBundle, StandardsPackNotFoundError } from '#src/views/index.ts';

/** Write a set of repo-relative files, creating the folders they need. */
const writeTree = async ({ dir, files }: { dir: string; files: Record<string, string> }) => {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content, 'utf8');
	}
};

/**
 * A house pack whose folders are deliberately out of order: the `tests/`
 * document sorts after the `code/` one by path but is walked in the same pass,
 * and the two rules' ids run backwards against their folder names.
 *
 * The point of the arrangement is that a reader of the committed
 * `assets/default-pack.json` can tell what decided the order.
 */
const setupHouseRepo = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-pack-bundle-'));

	await writeTree({
		dir: cwd,
		files: {
			'lightsout.config.json': JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false }, 'standards-packs': ['./house'] }),
			'house/lightsout-standards.json': JSON.stringify({ name: 'acme', formatVersion: 1 }),
			'house/code/house/document.md': '---\nchannel: base\n---\n\n# House Style\n',
			'house/code/house/05-zebra-last/rule.md': '---\nsummary: named to sort last\n---\n\nA rule whose id starts with z.\n',
			'house/code/house/05-zebra-last/fixtures/pass/src/b.ts': 'export const b = 1;\n',
			'house/code/house/05-zebra-last/fixtures/pass/src/a.ts': 'export const a = 1;\n',
			'house/code/house/05-zebra-last/fixtures/fail/src/loose.ts': 'export const loose = 1;\n',
			'house/code/house/10-alpha-first/rule.md': '---\nsummary: named to sort first\n---\n\nA rule whose id starts with a.\n',
			'house/tests/house/document.md': '---\nchannel: base\n---\n\n# House Tests\n',
			'house/tests/house/05-test-rule/rule.md': '---\nsummary: something about tests\n---\n\nTests are code.\n',
		},
	});

	return { cwd };
};

/**
 * This monorepo, whose config names no standards pack — so the pack read from it
 * is the authored default one, fixtures and all, which is the read
 * `assets/default-pack.json` is built from. Anchored on this file rather than on
 * the working directory, which depends on where the runner was invoked from.
 */
const setupThisRepo = () => ({ cwd: join(__dirname, '..', '..', '..', '..') });

describe('getStandardsPackBundle', () => {
	test('reads the pack whole — every rule with its prose and the text of its fixtures', async () => {
		const { cwd } = await setupHouseRepo();

		const bundle = await getStandardsPackBundle({ cwd, name: 'acme' });
		const rule = bundle.rules.find((entry) => entry.id === 'zebra-last');

		expect(rule?.prose).toContain('A rule whose id starts with z.');
		expect(rule?.fixtures.map((fixture) => fixture.text)).toContain('export const loose = 1;\n');
	});

	test('states the order of its documents rather than leaving it to whichever filesystem it ran on', async () => {
		const { cwd } = await setupHouseRepo();

		const bundle = await getStandardsPackBundle({ cwd, name: 'acme' });

		expect(bundle.documents.map((document) => document.path)).toStrictEqual(['code/house', 'tests/house']);
	});

	test('states the order of its rules as their ids, not as their folders were walked', async () => {
		const { cwd } = await setupHouseRepo();

		const bundle = await getStandardsPackBundle({ cwd, name: 'acme' });

		expect(bundle.rules.map((rule) => rule.id)).toStrictEqual(['alpha-first', 'test-rule', 'zebra-last']);
	});

	test('keeps a rule’s proof in reading order — what the rule wants first, what it catches second', async () => {
		const { cwd } = await setupHouseRepo();

		const bundle = await getStandardsPackBundle({ cwd, name: 'acme' });
		const rule = bundle.rules.find((entry) => entry.id === 'zebra-last');

		expect(rule?.fixtures.map((fixture) => [fixture.side, fixture.path])).toStrictEqual([
			[FixtureSide.Pass, 'src/a.ts'],
			[FixtureSide.Pass, 'src/b.ts'],
			[FixtureSide.Fail, 'src/loose.ts'],
		]);
	});

	test('reads the authored default pack a repo loads when its config names none, carrying the proof the shipped copy leaves out', async () => {
		const { cwd } = setupThisRepo();

		const bundle = await getStandardsPackBundle({ cwd, name: 'lightsout-defaults' });
		const rule = bundle.rules.find((entry) => entry.id === 'type-assertion');

		// the read `assets/default-pack.json` is built from. The copy the engine
		// ships is `built` and carries no fixtures at all, so a bundle that came
		// back with an empty proof would commit a pack the public build cannot
		// argue from — while still parsing and still passing every other test here.
		expect({ built: bundle.built, fixtures: rule?.fixtures.map((fixture) => [fixture.side, fixture.path]) }).toStrictEqual({
			built: false,
			fixtures: [
				[FixtureSide.Pass, 'src/payloads/common/constants/PayloadKind.ts'],
				[FixtureSide.Pass, 'src/payloads/readLabel.ts'],
				[FixtureSide.Fail, 'src/payloads/readLabel.ts'],
			],
		});
	});

	test('rejects a name no pack this repo loads answers to', async () => {
		const { cwd } = await setupHouseRepo();

		await expect(getStandardsPackBundle({ cwd, name: 'no-such-pack' })).rejects.toThrow(StandardsPackNotFoundError);
	});
});
