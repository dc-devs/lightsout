import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { createRun, readRunManifest, resolveRunDir } from '#src/runState/index.ts';
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
		// nothing is mapped until the ledger step writes the plan's acceptance tests
		expect(manifest.acceptanceTests).toStrictEqual([]);
	});

	test('opens the commit list empty, before the run has committed anything', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		// asserted on the return value, not a read-back — the schema default would mask a missing write
		expect(manifest.commits).toStrictEqual([]);
	});

	test('creates the run directory so later writes have somewhere to land', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		// the run directory exists before any step runs
		expect(existsSync(await resolveRunDir({ cwd, runId: manifest.runId }))).toBeTruthy();
	});

	test('takes the id the caller already locked the run under', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, runId: 'pre-minted-run', plan: 'plan.md', driver: 'stub' });

		expect(manifest.runId).toBe('pre-minted-run');
		// the directory is named for the locked id
		expect(existsSync(await resolveRunDir({ cwd, runId: 'pre-minted-run' }))).toBeTruthy();
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

	test('records the plan a run belongs to, and records none for a plan path outside the plans directory', async () => {
		const { cwd } = setupRepo();

		const inPlan = await createRun({
			cwd,
			plan: join('.lightsout', 'work-orders', 'lo-155-recorded-plan-name', 'plans', '001-recorded-plan-name', 'plan.md'),
			driver: 'stub',
		});
		const outsidePlan = await createRun({ cwd, plan: 'refactor-work-list.md', pipeline: 'refactor', driver: 'stub' });
		const read = await readRunManifest({ cwd, runId: inPlan.runId });

		expect(inPlan.planName).toBe('lo-155-recorded-plan-name/001-recorded-plan-name');
		// stamped on disk too — the plan views match on the name the manifest carries, not on the returned value
		expect(read.planName).toBe('lo-155-recorded-plan-name/001-recorded-plan-name');
		// a refactor run points its plan at a work-list it generated inside its own run folder, so it claims no plan
		expect(outsidePlan.planName).toBe(undefined);
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

	test('records the checkout the run works in as the manifest workspace', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });
		const read = await readRunManifest({ cwd, runId: manifest.runId });

		expect(manifest.workspace).toBe(resolve(cwd));
		// absolute, because a later reader standing in another checkout has nothing to join it onto
		expect(isAbsolute(read.workspace ?? '')).toBeTruthy();
		// stamped on disk too — the returned value alone would not tell a resume where the work happened
		expect(read.workspace).toBe(resolve(cwd));
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

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub', baselineDirtyFiles: ['src/wip.js', 'brainstorm-notes.md'] });

		expect(manifest.baselineDirtyFiles).toStrictEqual(['src/wip.js', 'brainstorm-notes.md']);
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

	test('creates the run directory under its plan ticket and makes it findable by id at once', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({
			cwd,
			plan: join('.lightsout', 'work-orders', 'lo-155-run-directories', 'plans', '001-run-directories', 'plan.md'),
			driver: 'stub',
		});
		const runDir = await resolveRunDir({ cwd, runId: manifest.runId });

		// the run of a plan is filed under the ticket that plan belongs to
		expect(runDir).toBe(join(cwd, '.lightsout', 'work-orders', 'lo-155-run-directories', 'runs', manifest.runId));
		// and it is on disk, answered by id in the same process the run was made in
		expect(existsSync(runDir)).toBeTruthy();
	});

	test('creates a plan-less run directory under its own command', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'refactor-work-list.md', pipeline: 'refactor', driver: 'stub' });

		// a refactor run points its plan at a work-list it generated, so it claims no plan
		expect(manifest.planName).toBe(undefined);
		// with no plan to file it under, the command that owns it holds it
		expect(existsSync(join(cwd, '.lightsout', 'refactor', 'runs', manifest.runId))).toBeTruthy();
	});

	test('files a direct run of a ticket under the ticket, from the branch it already resolved', async () => {
		const { cwd } = setupBranchedRepo({ branch: 'lo-155-direct-ticket' });

		const manifest = await createRun({ cwd, plan: 'ticket.md', pipeline: 'direct', ticketRef: 'LO-155', driver: 'stub' });

		// the branch a direct run is built on IS its ticket folder's name
		expect(existsSync(join(cwd, '.lightsout', 'work-orders', 'lo-155-direct-ticket', 'runs', manifest.runId, 'manifest.json'))).toBeTruthy();
		// the direct command's own folder is only for a run with no ticket to file under
		expect(existsSync(join(cwd, '.lightsout', 'direct', 'runs', manifest.runId))).toBeFalsy();
	});

	test('records the new directory before writing the manifest, so the first write resolves', async () => {
		const { cwd } = setupRepo();

		const manifest = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });
		const read = await readRunManifest({ cwd, runId: manifest.runId });

		// the manifest write resolves the run's directory by id, so a directory
		// recorded after the write would fail every run at creation
		expect(read.runId).toBe(manifest.runId);
		expect(read.plan).toBe('plan.md');
	});
});
