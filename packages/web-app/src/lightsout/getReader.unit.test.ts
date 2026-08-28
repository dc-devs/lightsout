/**
 * @jest-environment node
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { RunStatus } from '@lightsout/engine/contracts';
import { getReader, type LightsoutReader } from '#src/lightsout/index.ts';

const runId = 'abcdef0123456789';

/** Every command the catalog names, in page order — spelled out here so a dropped command fails this suite rather than quietly agreeing with it. */
const commandIds = [
	'brainstorm',
	'plan',
	'auto-plan',
	'implement',
	'resume',
	'ship',
	'refactor',
	'test-coverage-to-threshold',
	'standards-check',
	'standards-validate',
	'standards-health',
	'status',
	'doctor',
	'friction',
	'improve',
	'voice',
];

/**
 * A repo with one readable run and one plan, pointed at through
 * LIGHTSOUT_REPO — the only seam a test has on the repo root, and using it also
 * proves the reader is built from the root as it reads at call time.
 */
const setupReader = async (): Promise<{ reader: LightsoutReader }> => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'lightsout-reader-'));
	const runDir = join(repoRoot, '.lightsout', 'runs', runId);

	await mkdir(runDir, { recursive: true });
	await mkdir(join(repoRoot, '.lightsout', 'plans'), { recursive: true });
	await writeFile(join(repoRoot, '.lightsout', 'plans', 'add-search.md'), '# Add search\n', 'utf8');
	await writeFile(
		join(runDir, 'manifest.json'),
		JSON.stringify({
			runId,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			plan: '.lightsout/plans/add-search.md',
			harness: 'claude-code',
			status: RunStatus.Passed,
			currentStep: null,
			steps: [{ id: 'implement', status: RunStatus.Passed, attempts: 1 }],
			changedFiles: ['src/a.ts'],
		}),
		'utf8',
	);

	process.env.LIGHTSOUT_REPO = repoRoot;

	return { reader: getReader() };
};

/**
 * A repo of somebody's own, on a house pack of two rules — one of them shipping
 * both sides of its proof.
 *
 * A separate arrangement rather than a parameter on the one above: the pack
 * questions are answered by a repo whose own config names a pack, which is what
 * proves the reader asks the engine about the root it was pointed at rather than
 * about the directory the suite happens to run from.
 */
const setupPackReader = async (): Promise<{ reader: LightsoutReader }> => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'lightsout-reader-packs-'));
	const files: Record<string, string> = {
		'lightsout.config.json': JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false }, 'standards-packs': ['./house'] }),
		'house/lightsout-standards.json': JSON.stringify({ name: 'acme', formatVersion: 1, description: 'what this shop agrees on' }),
		'house/code/house/document.md': '---\nchannel: react\n---\n\n# House Style\n\nWhat this shop agrees on.\n',
		'house/code/house/05-house-loose-file/rule.md':
			'---\nsummary: a source file outside a module\nchecked: false\nseverity: blocking\n---\n\nEvery file belongs to a module.\n',
		'house/code/house/05-house-loose-file/fixtures/pass/src/mod/index.ts': 'export const mod = 1;\n',
		'house/code/house/05-house-loose-file/fixtures/fail/src/loose.ts': 'export const loose = 1;\n',
		'house/code/house/10-house-name-things-well/rule.md': '---\nsummary: a name that hides what it does\n---\n\nNames are the cheapest documentation.\n',
	};

	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(repoRoot, path)), { recursive: true });
		await writeFile(join(repoRoot, path), content, 'utf8');
	}

	process.env.LIGHTSOUT_REPO = repoRoot;

	return { reader: getReader() };
};

/**
 * A repo found first, then the same process made public.
 *
 * A separate arrangement rather than a parameter, because what it arranges is a
 * sequence: the switch is read again on the next call, so nothing captured in
 * module scope can keep answering from a disk the build no longer serves.
 */
const setupPublicAfterRepo = async (): Promise<{ reader: LightsoutReader }> => {
	await setupReader();

	process.env.LIGHTSOUT_PUBLIC = '1';

	return { reader: getReader() };
};

/** No repo above this directory at all — the public build, whichever checkout the server happens to be started from. */
const setupPublicBuild = (): { reader: LightsoutReader } => {
	process.env.LIGHTSOUT_PUBLIC = '1';

	return { reader: getReader() };
};

afterEach(() => {
	delete process.env.LIGHTSOUT_REPO;
	delete process.env.LIGHTSOUT_PUBLIC;
});

describe('getReader', () => {
	test('lists the runs of the repo it was pointed at', async () => {
		const { reader } = await setupReader();

		const runs = await reader.listRuns();

		expect(runs.map((run) => run.runId)).toStrictEqual([runId]);
	});

	test("returns one run's whole evidence, keyed by the id it was asked for", async () => {
		const { reader } = await setupReader();

		const view = await reader.getRun({ runId });

		expect(view.listing.runId).toBe(runId);
	});

	test('rejects an unknown run id rather than resolving to nothing', async () => {
		const { reader } = await setupReader();

		await expect(reader.getRun({ runId: 'no-such-run' })).rejects.toThrow(/no-such-run/);
	});

	test('reads a plan from inside the repo as markdown', async () => {
		const { reader } = await setupReader();

		const plan = await reader.getPlan({ path: '.lightsout/plans/add-search.md' });

		expect(plan).toStrictEqual({ path: '.lightsout/plans/add-search.md', kind: 'markdown', text: '# Add search\n' });
	});

	test('refuses a plan path that escapes the repo root', async () => {
		const { reader } = await setupReader();

		await expect(reader.getPlan({ path: '../elsewhere/secret.md' })).rejects.toThrow(/outside the repo root/);
	});

	test('reads the standards view of a repo that has never run a check', async () => {
		const { reader } = await setupReader();

		const standards = await reader.getStandards();

		expect(standards.findings).toStrictEqual([]);
	});

	test('lists the standards packs the repo it was pointed at loads, with the path a config entry would carry', async () => {
		const { reader } = await setupPackReader();

		const packs = await reader.listPacks();

		expect(packs).toEqual([
			expect.objectContaining({
				name: 'acme',
				description: 'what this shop agrees on',
				isDefault: false,
				built: false,
				path: 'house',
				channels: ['react'],
				totals: { rules: 2, checked: 0, judgment: 2, documents: 1, withFixtures: 1 },
			}),
		]);
	});

	test('lists a pack without its rules, so the packs page stays light', async () => {
		const { reader } = await setupPackReader();

		const packs = await reader.listPacks();

		expect(Object.keys(packs[0] ?? {}).sort()).toStrictEqual(['built', 'channels', 'description', 'isDefault', 'name', 'path', 'rootPath', 'totals']);
	});

	test('falls back to the default pack for a repo whose config names none', async () => {
		const { reader } = await setupReader();

		const packs = await reader.listPacks();

		expect(packs.map((pack) => ({ name: pack.name, isDefault: pack.isDefault }))).toStrictEqual([{ name: 'lightsout-defaults', isDefault: true }]);
	});

	test('returns one pack as its page shows it: every document a group and every rule a row', async () => {
		const { reader } = await setupPackReader();

		const view = await reader.getPack({ name: 'acme' });

		expect({
			documents: view.documents.map((document) => ({ path: document.path, channel: document.channel, ruleIds: document.ruleIds })),
			rules: view.rules.map((rule) => ({ id: rule.id, checked: rule.checked, fixtureCounts: rule.fixtureCounts })),
		}).toStrictEqual({
			documents: [{ path: 'code/house', channel: 'react', ruleIds: ['house-loose-file', 'house-name-things-well'] }],
			rules: [
				{ id: 'house-loose-file', checked: false, fixtureCounts: { pass: 1, fail: 1 } },
				{ id: 'house-name-things-well', checked: false, fixtureCounts: { pass: 0, fail: 0 } },
			],
		});
	});

	test('rejects a pack name no pack this repo loads answers to', async () => {
		const { reader } = await setupPackReader();

		await expect(reader.getPack({ name: 'no-such-pack' })).rejects.toThrow(/no-such-pack/);
	});

	test('returns one rule whole — its prose and the text of both sides of its proof', async () => {
		const { reader } = await setupPackReader();

		const view = await reader.getPackRule({ name: 'acme', rule: 'house-loose-file' });

		expect({
			id: view.id,
			prose: view.prose,
			fixtures: view.fixtures,
		}).toEqual({
			id: 'house-loose-file',
			prose: expect.stringContaining('Every file belongs to a module.'),
			fixtures: [
				{ side: 'pass', path: 'src/mod/index.ts', text: 'export const mod = 1;\n' },
				{ side: 'fail', path: 'src/loose.ts', text: 'export const loose = 1;\n' },
			],
		});
	});

	test('rejects a rule id the named pack does not carry', async () => {
		const { reader } = await setupPackReader();

		await expect(reader.getPackRule({ name: 'acme', rule: 'no-such-rule' })).rejects.toThrow(/no-such-rule/);
	});

	test('rejects a rule of a pack name no pack this repo loads answers to', async () => {
		const { reader } = await setupPackReader();

		await expect(reader.getPackRule({ name: 'no-such-pack', rule: 'house-loose-file' })).rejects.toThrow(/no-such-pack/);
	});

	test('reads a repo’s own packs live rather than substituting anything, since only the shipped default is stripped', async () => {
		const { reader } = await setupPackReader();

		const packs = await reader.listPacks();

		expect(packs.map((pack) => pack.name)).toStrictEqual(['acme']);
	});

	test('reads the default pack live where the engine finds the authored folder, rather than serving a snapshot that may be older than the pack', async () => {
		const { reader } = await setupReader();

		const packs = await reader.listPacks();

		// The committed snapshot carries the repo-relative
		// `packages/standards-typescript`; a live read carries this machine's
		// absolute path, so the two are told apart without naming either.
		expect(packs.map((pack) => ({ name: pack.name, readFromThisMachine: isAbsolute(pack.rootPath) }))).toStrictEqual([
			{ name: 'lightsout-defaults', readFromThisMachine: true },
		]);
	});

	test('serves that same live pack for its own page, so the pack list and the pack page cannot disagree', async () => {
		const { reader } = await setupReader();

		const view = await reader.getPack({ name: 'lightsout-defaults' });

		expect({ name: view.name, readFromThisMachine: isAbsolute(view.rootPath) }).toStrictEqual({ name: 'lightsout-defaults', readFromThisMachine: true });
	});

	test('answers the whole command catalog for the repo it was pointed at, since the catalog is engine source rather than repo state', async () => {
		const { reader } = await setupReader();

		const commands = await reader.listCommands();

		expect(commands.map((command) => command.id)).toStrictEqual(commandIds);
	});

	test('is built from the repo root as it reads at call time, so a process made public stops answering from the disk it had found', async () => {
		const { reader } = await setupPublicAfterRepo();

		const runs = await reader.listRuns();

		expect({ count: runs.length, holdsTheRepoRun: runs.some((run) => run.runId === runId) }).toStrictEqual({ count: 3, holdsTheRepoRun: false });
	});
});

describe('getReader with no repo found', () => {
	test('serves the frozen demo runs, so the public build has a runs list at all', async () => {
		const { reader } = setupPublicBuild();

		const runs = await reader.listRuns();

		expect(runs).toHaveLength(3);
	});

	test('serves the bundled default pack, read from no disk', async () => {
		const { reader } = setupPublicBuild();

		const packs = await reader.listPacks();

		expect(packs.map((pack) => pack.name)).toStrictEqual(['lightsout-defaults']);
	});

	test('answers the standards view with its empty form rather than failing a deep link into the local zone', async () => {
		const { reader } = setupPublicBuild();

		const standards = await reader.getStandards();

		expect(standards.notes).toStrictEqual(['No repository was found — this is the public build, which serves no standards check.']);
	});

	test('serves that same command catalog with no repo found, so the public build’s command pages read the same list the local one does', async () => {
		const { reader } = setupPublicBuild();

		const commands = await reader.listCommands();

		expect(commands.map((command) => command.id)).toStrictEqual(commandIds);
	});
});
