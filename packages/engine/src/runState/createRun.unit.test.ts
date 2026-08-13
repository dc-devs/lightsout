import { existsSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import type { LightsoutConfig } from '@/contracts';
import { createRun, getRunDir, readRunManifest } from '@/runState';

const config: LightsoutConfig = {
	harness: 'stub',
	gates: { check: 'true', test: 'true', testCoverage: false },
};

const setupRepo = () => {
	const cwd = setupConsumerRepo({ git: false });

	return { cwd };
};

describe('createRun', () => {
	test('opens a run at pending with nothing done yet', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		expect(manifest.status).toBe('pending');
		expect(manifest.currentStep).toBe(null);
		expect(manifest.steps).toStrictEqual([]);
		expect(manifest.changedFiles).toStrictEqual([]);
		expect(manifest.packages).toStrictEqual([]);
	});

	test('opens the test-subject bookkeeping empty before any write-tests step runs', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		// asserted on the return value, not a read-back — the schema defaults would mask a missing write
		expect(manifest.testSubjects).toStrictEqual([]);
		expect(manifest.unreachableChangedFiles).toStrictEqual([]);
	});

	test('creates the run directory so later writes have somewhere to land', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		// the run directory exists before any step runs
		expect(existsSync(getRunDir({ cwd, runId: manifest.runId }))).toBeTruthy();
	});

	test('takes the id the caller already locked the run under', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, runId: 'pre-minted-run', plan: 'plan.md', driver: 'stub' });

		expect(manifest.runId).toBe('pre-minted-run');
		// the directory is named for the locked id
		expect(existsSync(getRunDir({ cwd, runId: 'pre-minted-run' }))).toBeTruthy();
	});

	test('mints a fresh id for a caller that has none', async () => {
		const { cwd } = setupRepo();

		const first = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });
		const second = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		expect(first.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		// two runs never share a directory
		expect(first.runId).not.toBe(second.runId);
	});

	test('records the plan, overview, pipeline, and driver as the run permanent identity', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({
			cwd,
			plan: 'plans/phase-2.md',
			overview: 'plans/overview.md',
			pipeline: 'refactor',
			driver: 'codex',
		});

		expect(manifest.plan).toBe('plans/phase-2.md');
		expect(manifest.overview).toBe('plans/overview.md');
		expect(manifest.pipeline).toBe('refactor');
		// the driver is persisted as the harness a resume must reuse
		expect(manifest.harness).toBe('codex');
	});

	test('leaves the optional routing fields unset when the caller omits them', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		expect(manifest.pipeline).toBe(undefined);
		expect(manifest.overview).toBe(undefined);
		expect(manifest.config).toBe(undefined);
	});

	test('snapshots the resolved config as the settings that produced this run', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub', config });
		const read = await readRunManifest({ cwd, runId: manifest.runId });

		expect(read.config).toStrictEqual({ harness: 'stub', gates: { check: 'true', test: 'true', testCoverage: false } });
	});

	test('seeds the dirty paths that changed-file attribution subtracts', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub', baselineDirtyFiles: ['src/wip.js', 'notes.md'] });

		expect(manifest.baselineDirtyFiles).toStrictEqual(['src/wip.js', 'notes.md']);
	});

	test('starts from an empty baseline when the repo was clean at run start', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		// no baseline means every dirty path is the run doing
		expect(manifest.baselineDirtyFiles).toStrictEqual([]);
	});

	test('stamps the manifest on disk, readable without the returned value', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });
		const read = await readRunManifest({ cwd, runId: manifest.runId });

		expect(read.runId).toBe(manifest.runId);
		expect(read.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		// ${read.updatedAt} should not precede ${read.createdAt}
		expect(read.updatedAt >= read.createdAt).toBeTruthy();
	});
});
