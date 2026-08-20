/**
 * @jest-environment node
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { RunStatus } from '@lightsout/engine/contracts';
import { getReader, type LightsoutReader } from '#src/lightsout/index.ts';

const runId = 'abcdef0123456789';

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

afterEach(() => {
	delete process.env.LIGHTSOUT_REPO;
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
});
