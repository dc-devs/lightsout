import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, test } from 'node:test';
import type { LightsoutConfig } from '@/contracts';
import { createRun, getRunDir, readRunManifest } from '@/runState';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

const config: LightsoutConfig = {
	harness: 'stub',
	scripts: { check: 'true', testUnit: 'true', testCoverage: false },
};

const setupRepo = () => {
	const cwd = setupConsumerRepo({ git: false });

	return { cwd };
};

describe('createRun', () => {
	test('opens a run at pending with nothing done yet', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		assert.equal(manifest.status, 'pending');
		assert.equal(manifest.currentStep, null);
		assert.deepEqual(manifest.steps, []);
		assert.deepEqual(manifest.changedFiles, []);
		assert.deepEqual(manifest.packages, []);
	});

	test('creates the run directory so later writes have somewhere to land', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		assert.ok(existsSync(getRunDir({ cwd, runId: manifest.runId })), 'the run directory exists before any step runs');
	});

	test('takes the id the caller already locked the run under', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, runId: 'pre-minted-run', plan: 'plan.md', driver: 'stub' });

		assert.equal(manifest.runId, 'pre-minted-run');
		assert.ok(existsSync(getRunDir({ cwd, runId: 'pre-minted-run' })), 'the directory is named for the locked id');
	});

	test('mints a fresh id for a caller that has none', async () => {
		const { cwd } = setupRepo();

		const first = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });
		const second = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		assert.match(first.runId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		assert.notEqual(first.runId, second.runId, 'two runs never share a directory');
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

		assert.equal(manifest.plan, 'plans/phase-2.md');
		assert.equal(manifest.overview, 'plans/overview.md');
		assert.equal(manifest.pipeline, 'refactor');
		assert.equal(manifest.harness, 'codex', 'the driver is persisted as the harness a resume must reuse');
	});

	test('leaves the optional routing fields unset when the caller omits them', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		assert.equal(manifest.pipeline, undefined);
		assert.equal(manifest.overview, undefined);
		assert.equal(manifest.config, undefined);
	});

	test('snapshots the resolved config as the settings that produced this run', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub', config });
		const read = await readRunManifest({ cwd, runId: manifest.runId });

		assert.deepEqual(read.config, { harness: 'stub', scripts: { check: 'true', testUnit: 'true', testCoverage: false } });
	});

	test('seeds the dirty paths that changed-file attribution subtracts', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub', baselineDirtyFiles: ['src/wip.js', 'notes.md'] });

		assert.deepEqual(manifest.baselineDirtyFiles, ['src/wip.js', 'notes.md']);
	});

	test('starts from an empty baseline when the repo was clean at run start', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		assert.deepEqual(manifest.baselineDirtyFiles, [], 'no baseline means every dirty path is the run doing');
	});

	test('stamps the manifest on disk, readable without the returned value', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });
		const read = await readRunManifest({ cwd, runId: manifest.runId });

		assert.equal(read.runId, manifest.runId);
		assert.match(read.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		assert.ok(read.updatedAt >= read.createdAt, `${read.updatedAt} should not precede ${read.createdAt}`);
	});
});
