/**
 * @jest-environment node
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { getReader, type LightsoutReader } from '#src/lightsout/index.ts';

/** What the shared test setup pointed the default pack at, so an arrangement that moves it can put it back. */
const defaultStandardsPath = process.env.LIGHTSOUT_DEFAULT_STANDARDS;

/**
 * A shipped pack: the shape the bundler writes, with `built: true` and no
 * fixture folders, standing in for the copy `plugin/standards/` carries on a
 * consumer's machine.
 *
 * Reached through `LIGHTSOUT_DEFAULT_STANDARDS`, which is how the engine lets a
 * caller say which pack is the default — the shared test setup points it at this
 * monorepo's authored folder, and this is the one arrangement that needs it
 * pointed somewhere else.
 */
const setupStrippedDefaultRepo = async (): Promise<{ reader: LightsoutReader }> => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'lightsout-reader-built-'));
	const files: Record<string, string> = {
		'lightsout-standards.json': JSON.stringify({ name: 'lightsout-defaults', formatVersion: 1, built: true }),
		'code/house/document.md': '---\nchannel: base\n---\n\n# Shipped\n',
		'code/house/05-shipped-rule/rule.md': '---\nsummary: a rule shipped without its proof\n---\n\nThe bundler strips fixtures.\n',
	};

	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(repoRoot, path)), { recursive: true });
		await writeFile(join(repoRoot, path), content, 'utf8');
	}

	const consumerRoot = await mkdtemp(join(tmpdir(), 'lightsout-reader-consumer-'));

	process.env.LIGHTSOUT_REPO = consumerRoot;
	process.env.LIGHTSOUT_DEFAULT_STANDARDS = repoRoot;

	return { reader: getReader() };
};

afterEach(() => {
	delete process.env.LIGHTSOUT_REPO;
	// Restored rather than deleted: the shared setup file points this at the
	// authored pack once per worker, and a test that removed it would leave every
	// later file in this worker resolving the default somewhere else.
	process.env.LIGHTSOUT_DEFAULT_STANDARDS = defaultStandardsPath;
});

describe('getReader where the engine finds only a stripped default pack', () => {
	test('serves the app’s own copy of the default pack where the engine finds only the stripped one, so a rule still has its examples', async () => {
		const { reader } = await setupStrippedDefaultRepo();

		const packs = await reader.listPacks();

		expect(packs.map((pack) => ({ name: pack.name, built: pack.built, withFixtures: pack.totals.withFixtures > 0 }))).toStrictEqual([
			{ name: 'lightsout-defaults', built: false, withFixtures: true },
		]);
	});

	test('serves that same copy for the pack page', async () => {
		const { reader } = await setupStrippedDefaultRepo();

		const view = await reader.getPack({ name: 'lightsout-defaults' });

		expect(view.rules.some((rule) => rule.fixtureCounts.pass > 0)).toBe(true);
	});

	test('serves that same copy for a rule page, which is the page the substitution exists for', async () => {
		const { reader } = await setupStrippedDefaultRepo();

		const rule = await reader.getPackRule({ name: 'lightsout-defaults', rule: 'type-assertion' });

		expect(rule.fixtures.length).toBeGreaterThan(0);
	});
});
