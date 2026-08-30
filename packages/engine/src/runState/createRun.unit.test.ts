import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { createRun, getRunDir, readRunManifest } from '#src/runState/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const config: LightsoutConfig = {
	harness: 'stub',
	gates: { check: 'true', test: 'true', 'test-coverage': false },
};

const setupRepo = () => {
	const cwd = setupConsumerRepo({ git: false });

	return { cwd };
};

/** A repo with a git history, checked out on a branch of a known name. */
const setupBranchedRepo = ({ branch }: { branch: string }) => {
	const cwd = setupConsumerRepo();

	execSync(`git checkout -q -b ${branch}`, { cwd });

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

	test('records an absolute plan path relative to the repo — the same plan however the caller named it', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: join(cwd, 'plans', 'demo', 'plan.md'), driver: 'stub' });

		// every reader joins the record onto the repo; an absolute record would be
		// joined too, and read back as a missing plan
		expect(manifest.plan).toBe(join('plans', 'demo', 'plan.md'));
	});

	test('records an absolute overview path relative to the repo the same way', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plans/demo/phase1.md', overview: join(cwd, 'plans', 'demo', 'overview.md'), driver: 'stub' });

		expect(manifest.overview).toBe(join('plans', 'demo', 'overview.md'));
	});

	test('keeps a relative plan path exactly as the caller named it', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: join('plans', 'demo', 'plan.md'), driver: 'stub' });

		expect(manifest.plan).toBe(join('plans', 'demo', 'plan.md'));
	});

	test('records the ticket a run was built from, so a queue or direct run names its ticket rather than only its plan', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'ticket.md', pipeline: 'direct', ticketRef: 'LO-70', driver: 'stub' });
		const read = await readRunManifest({ cwd, runId: manifest.runId });

		expect(manifest.ticketRef).toBe('LO-70');
		// stamped on disk too — the resume and status readers only ever see the file
		expect(read.ticketRef).toBe('LO-70');
	});

	test('records the branch the checkout is on, which is the key a ship result is filed under', async () => {
		const { cwd } = setupBranchedRepo({ branch: 'lo-52-progress-view' });

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });
		const read = await readRunManifest({ cwd, runId: manifest.runId });

		expect(manifest.branch).toBe('lo-52-progress-view');
		// stamped on disk too — a run that records no branch cannot find its own ship result
		expect(read.branch).toBe('lo-52-progress-view');
	});

	test('records no branch where git has none to name', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		// outside a worktree there is nothing to push to, so absence is the answer
		expect(manifest.branch).toBe(undefined);
	});

	test.each([
		{ label: 'a run resolved to ship carries the stamp the progress view draws a ship row from', willShip: true, expected: true },
		{ label: 'a run whose caller resolved no ship intent carries nothing', willShip: undefined, expected: undefined },
	])('$label', async ({ willShip, expected }) => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub', willShip });
		const read = await readRunManifest({ cwd, runId: manifest.runId });

		expect(read.willShip).toBe(expected);
	});

	test('leaves the optional routing fields unset when the caller omits them', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		expect(manifest.pipeline).toBe(undefined);
		expect(manifest.overview).toBe(undefined);
		expect(manifest.config).toBe(undefined);
		// a run started from a plan builds no one ticket
		expect(manifest.ticketRef).toBe(undefined);
	});

	test('snapshots the resolved config as the settings that produced this run', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub', config });
		const read = await readRunManifest({ cwd, runId: manifest.runId });

		expect(read.config).toStrictEqual({ harness: 'stub', gates: { check: 'true', test: 'true', 'test-coverage': false } });
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
