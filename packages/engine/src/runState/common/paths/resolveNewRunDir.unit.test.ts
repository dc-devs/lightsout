import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import { resolveNewRunDir } from '#src/runState/common/paths/resolveNewRunDir.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

/**
 * An empty temp directory outside any repository, so the state directory is
 * `cwd`'s own `.lightsout` and every answer below is a path this file can spell
 * from the outside rather than one borrowed from the helper under test.
 */
const setupStateDir = async () => {
	const cwd = await freshCwd();

	return { cwd, stateDir: join(cwd, '.lightsout') };
};

describe('resolveNewRunDir', () => {
	test('files a new run under the ticket folder its plan address names', async () => {
		const { cwd, stateDir } = await setupStateDir();

		const runDir = await resolveNewRunDir({
			cwd,
			planName: 'lo-155-ticket-scoped-state-layout/003-run-directories',
			runId: 'be7bc314-1845-44c0-bb6c-a8c2becb7f92',
		});

		expect(runDir).toBe(join(stateDir, 'work-orders', 'lo-155-ticket-scoped-state-layout', 'runs', 'be7bc314-1845-44c0-bb6c-a8c2becb7f92'));
	});

	test("files a new run under a legacy plan name's own folder", async () => {
		const { cwd, stateDir } = await setupStateDir();

		// a plan shaped before its ticket existed carries a bare slug, not an address
		const runDir = await resolveNewRunDir({ cwd, planName: 'ticket-scoped-state-layout', runId: 'run-a' });

		expect(runDir).toBe(join(stateDir, 'work-orders', 'ticket-scoped-state-layout', 'runs', 'run-a'));
	});

	test('files a run belonging to no plan under the command that owns it, with a coordinator beside the runs it sequences', async () => {
		const { cwd, stateDir } = await setupStateDir();

		const runDirs = await Promise.all(
			[PipelineKind.Implement, PipelineKind.Phases, PipelineKind.Direct, PipelineKind.Refactor, PipelineKind.Coverage, PipelineKind.Queue].map(
				async (pipeline) => [pipeline, await resolveNewRunDir({ cwd, pipeline, runId: 'run-a' })] as const,
			),
		);

		expect(Object.fromEntries(runDirs)).toStrictEqual({
			implement: join(stateDir, 'implement', 'runs', 'run-a'),
			phases: join(stateDir, 'implement', 'runs', 'run-a'),
			direct: join(stateDir, 'direct', 'runs', 'run-a'),
			refactor: join(stateDir, 'refactor', 'runs', 'run-a'),
			coverage: join(stateDir, 'coverage', 'runs', 'run-a'),
			queue: join(stateDir, 'queue', 'runs', 'run-a'),
		});
	});

	test('reads an absent pipeline as implement', async () => {
		const { cwd, stateDir } = await setupStateDir();

		const runDir = await resolveNewRunDir({ cwd, runId: 'run-a' });

		expect(runDir).toBe(join(stateDir, 'implement', 'runs', 'run-a'));
	});

	test('files a direct run of a ticket under the ticket it builds', async () => {
		const { cwd, stateDir } = await setupStateDir();

		const runDir = await resolveNewRunDir({ cwd, workOrderName: 'lo-160-search-basics', pipeline: PipelineKind.Direct, runId: 'run-a' });

		expect(runDir).toBe(join(stateDir, 'work-orders', 'lo-160-search-basics', 'runs', 'run-a'));
		expect(runDir).not.toContain(join('direct', 'runs'));
	});

	test('files a ticketless direct run under the direct command', async () => {
		const { cwd, stateDir } = await setupStateDir();

		const runDir = await resolveNewRunDir({ cwd, pipeline: PipelineKind.Direct, runId: 'run-a' });

		expect(runDir).toBe(join(stateDir, 'direct', 'runs', 'run-a'));
	});

	test('prefers the plan name when a ticket branch is given too', async () => {
		const { cwd, stateDir } = await setupStateDir();

		const runDir = await resolveNewRunDir({
			cwd,
			planName: 'lo-155-ticket-scoped-state-layout/003-run-directories',
			workOrderName: 'lo-160-search-basics',
			runId: 'run-a',
		});

		expect(runDir).toBe(join(stateDir, 'work-orders', 'lo-155-ticket-scoped-state-layout', 'runs', 'run-a'));
	});

	test('names the directory without creating it', async () => {
		const { cwd, stateDir } = await setupStateDir();

		const runDir = await resolveNewRunDir({
			cwd,
			planName: 'lo-155-ticket-scoped-state-layout/003-run-directories',
			runId: 'run-a',
		});

		expect({ runDir, runDirOnDisk: existsSync(runDir), stateDirOnDisk: existsSync(stateDir) }).toStrictEqual({
			runDir: join(stateDir, 'work-orders', 'lo-155-ticket-scoped-state-layout', 'runs', 'run-a'),
			runDirOnDisk: false,
			stateDirOnDisk: false,
		});
	});
});
