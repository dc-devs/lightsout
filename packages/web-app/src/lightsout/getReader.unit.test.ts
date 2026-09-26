/**
 * @jest-environment node
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { RunStatus } from '@lightsout/engine/contracts';
import type { LightsoutReader } from '#src/lightsout/common/types/LightsoutReader.ts';
import { getReader } from '#src/lightsout/getReader.ts';

const runId = 'abcdef0123456789';

/** Every command the catalog names, in page order — spelled out here so a dropped command fails this suite rather than quietly agreeing with it. */
const commandIds = [
	'brainstorm',
	'plan',
	'auto-plan',
	'implement',
	'implement-direct',
	'resume',
	'ship',
	'queue',
	'work-order',
	'ticket-state',
	'self-check',
	'refactor',
	'test-coverage-to-threshold',
	'standards-check',
	'standards-validate',
	'standards-health',
	'status',
	'report',
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
	// A run started from a plan file outside any ticket folder belongs to no plan, so the implement command's own runs folder holds it.
	const runDir = join(repoRoot, '.lightsout', 'implement', 'runs', runId);

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
