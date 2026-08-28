/**
 * @jest-environment node
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { ConfigNotFoundError } from '@lightsout/engine';
import { getReader, type LightsoutReader } from '#src/lightsout/index.ts';

/** The config this arrangement writes, as text — what a test overriding it writes its own version of. */
const configText = JSON.stringify({
	harness: 'claude-code',
	gates: { check: 'true', test: 'true', 'test-coverage': false },
	'standards-packs': ['./house'],
	'standards-channels': ['react'],
	'standards-checks': { 'house-name-things-well': 'off' },
});

/** A house pack of two rules, one blocking by its own front matter and one taking the advisory default. */
const packFiles: Record<string, string> = {
	'house/lightsout-standards.json': JSON.stringify({ name: 'acme', formatVersion: 1, description: 'what this shop agrees on' }),
	'house/code/house/document.md': '---\nchannel: react\n---\n\n# House Style\n\nWhat this shop agrees on.\n',
	'house/code/house/05-house-loose-file/rule.md': '---\nsummary: a source file outside a module\nseverity: blocking\n---\n\nEvery file belongs to a module.\n',
	'house/code/house/10-house-name-things-well/rule.md': '---\nsummary: a name that hides what it does\n---\n\nNames are the cheapest documentation.\n',
};

/**
 * A repo of somebody's own: a config that states a harness, names a pack and
 * turns one of that pack's rules off, pointed at through `LIGHTSOUT_REPO`.
 *
 * A repo with its own pack rather than the default one, because what the ledger
 * has to get right is which pack declares each rule — a question only a repo
 * naming its own pack can answer wrongly.
 */
const setupConfigReader = async ({ config = configText }: { config?: string } = {}): Promise<{ reader: LightsoutReader; repoRoot: string }> => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'lightsout-reader-config-'));

	for (const [path, content] of Object.entries({ 'lightsout.config.json': config, ...packFiles })) {
		await mkdir(dirname(join(repoRoot, path)), { recursive: true });
		await writeFile(join(repoRoot, path), content, 'utf8');
	}

	process.env.LIGHTSOUT_REPO = repoRoot;

	return { reader: getReader(), repoRoot };
};

/**
 * A directory with no `lightsout.config.json` in it at all.
 *
 * A separate arrangement rather than a parameter, because the absence of the
 * file is a different fact from its contents: it is the one the page turns into
 * a 404 rather than into a message.
 */
const setupUnconfiguredRepo = async (): Promise<{ reader: LightsoutReader }> => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'lightsout-reader-unconfigured-'));

	process.env.LIGHTSOUT_REPO = repoRoot;

	return { reader: getReader() };
};

/** No repo above this directory at all — the public build, which is a page about a file that is not there. */
const setupPublicBuild = (): { reader: LightsoutReader } => {
	process.env.LIGHTSOUT_PUBLIC = '1';

	return { reader: getReader() };
};

afterEach(() => {
	delete process.env.LIGHTSOUT_REPO;
	delete process.env.LIGHTSOUT_PUBLIC;
});

describe('getReader config', () => {
	test('answers with the config file of the repo it was pointed at, at the path it was read from', async () => {
		const { reader, repoRoot } = await setupConfigReader();

		const view = await reader.getConfig();

		expect({ path: view.path, harness: view.harness, model: view.model, channels: view.channels }).toStrictEqual({
			path: join(repoRoot, 'lightsout.config.json'),
			harness: 'claude-code',
			model: null,
			channels: ['react'],
		});
	});

	test('groups every live key into the areas the page reads, in order', async () => {
		const { reader } = await setupConfigReader();

		const view = await reader.getConfig();

		expect(view.sections.map((section) => ({ title: section.title, keys: section.fields.map((field) => field.key) }))).toStrictEqual([
			{ title: 'Harness', keys: ['harness', 'model', 'effort', 'permissions', 'commands'] },
			{ title: 'Gates', keys: ['gates', 'package-gates', 'packages-dir', 'coverage-summary-path', 'executor-file-limit'] },
			{ title: 'Standards', keys: ['standards-packs', 'standards-channels', 'standards-checks'] },
			{ title: 'Agent commands', keys: ['agent-commands'] },
			{ title: 'Generated', keys: ['generated', 'vendored'] },
			{ title: 'Timeouts', keys: ['timeouts.agent-minutes', 'timeouts.supervisor-minutes'] },
			{ title: 'Ship', keys: ['ship'] },
		]);
	});

	test('says of each value whether the file set it or lightsout filled it in', async () => {
		const { reader } = await setupConfigReader();

		const view = await reader.getConfig();

		expect(view.sections.flatMap((section) => section.fields).map(({ key, value, fromConfig }) => ({ key, value, fromConfig }))).toEqual(
			expect.arrayContaining([
				{ key: 'gates', value: { check: 'true', test: 'true', 'test-coverage': false }, fromConfig: true },
				{ key: 'packages-dir', value: 'packages', fromConfig: false },
				{ key: 'coverage-summary-path', value: 'coverage/coverage-summary.json', fromConfig: false },
				{ key: 'executor-file-limit', value: 50, fromConfig: false },
				{ key: 'timeouts.agent-minutes', value: 60, fromConfig: false },
				{ key: 'timeouts.supervisor-minutes', value: 15, fromConfig: false },
				{ key: 'commands', value: null, fromConfig: false },
			]),
		);
	});

	test('gives every field the description its key carries, so the page states no wording of its own', async () => {
		const { reader } = await setupConfigReader();

		const view = await reader.getConfig();

		expect(view.sections.flatMap((section) => section.fields).every((field) => field.description.length > 0)).toBe(true);
	});

	test('carries the packs the config names, with the channels their own documents declare', async () => {
		const { reader, repoRoot } = await setupConfigReader();

		const view = await reader.getConfig();

		expect(view.packs).toStrictEqual([{ name: 'acme', rootPath: join(repoRoot, 'house'), isDefault: false, channels: ['react'] }]);
	});

	test('carries every loaded rule with the pack that declares it, its severity here, and who decided that', async () => {
		const { reader } = await setupConfigReader();

		const view = await reader.getConfig();

		expect(view.ruleStates).toStrictEqual([
			{ rule: 'house-loose-file', pack: 'acme', severity: 'blocking', fromConfig: false, settings: {} },
			{ rule: 'house-name-things-well', pack: 'acme', severity: 'off', fromConfig: true, settings: {} },
		]);
	});

	test('rejects with the typed not-found error for a repo holding no config file, which is the page’s 404', async () => {
		const { reader } = await setupUnconfiguredRepo();

		await expect(reader.getConfig()).rejects.toThrow(ConfigNotFoundError);
	});

	test('rejects with the parse failure itself for a config that will not parse, since that message is the actionable answer', async () => {
		const { reader } = await setupConfigReader({ config: '{ "gates": ' });

		await expect(reader.getConfig()).rejects.toThrow(/is not valid JSON/);
	});

	test('rejects with that same not-found error where no repo was found, so a deep link into the local zone 404s rather than 500s', async () => {
		const { reader } = setupPublicBuild();

		await expect(reader.getConfig()).rejects.toThrow(ConfigNotFoundError);
	});
});
