import { expect, test } from '@jest/globals';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { runCli } from '#tests/helpers/runCli.ts';
import { seedConfiguredCwd } from '#tests/helpers/seedConfiguredCwd.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';
import { seedRunFixture } from '#tests/helpers/seedRunFixture.ts';

test('cli: status in a fresh dir reports no runs and exits 0', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	expect(stdout).toBe('no runs found\n');
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: status lists each run with its status, plan, and last update', async () => {
	const { cwd, runId, updatedAt } = await seedRunFixture({ status: 'failed' });

	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	expect(stdout).toBe(`${runId}  failed  plan: plans/demo.md  updated: ${updatedAt}\n`);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: status reports a running run with no live process as a resumable crash', async () => {
	const { cwd } = await seedRunFixture({ status: 'running' });

	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	expect(stdout).toMatch(/^run-fixture {2}running \(no live process — crashed\? resume with --run run-fixture\) {2}plan: plans\/demo\.md {2}updated: /);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: status leaves a running run alone while the lock names a live process', async () => {
	const { cwd } = await seedRunFixture({ status: 'running', lock: { pid: process.pid, runId: 'run-fixture' } });

	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	expect(stdout).toMatch(/^run-fixture {2}running {2}plan: plans\/demo\.md {2}updated: /);
	// a live lock for this very run is proof it is not a crash leftover
	expect(stdout.includes('no live process')).toBeFalsy();
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: status skips a run whose manifest cannot be read and still lists the rest', async () => {
	const { cwd } = await seedRunFixture({ status: 'failed', extraManifests: [{ runId: 'corrupt-run', body: 'not json at all' }] });

	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	// an unreadable manifest is skipped, never guessed at
	expect(stdout.includes('corrupt-run')).toBeFalsy();
	expect(stdout).toMatch(/^run-fixture {2}failed {2}plan: plans\/demo\.md/m);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: status lists runs filed under a ticket and under a command alike', async () => {
	const cwd = await seedConfiguredCwd();
	// one run of a plan on a ticket, and two runs belonging to no plan at all:
	// three different folders on disk, one listing to the reader
	await seedRunDir({
		cwd,
		manifest: { runId: 'run-a-ticket', planName: 'lo-9-add-search/001-indexing', plan: 'plans/add-search/plan.md', updatedAt: '2026-01-01T00:00:00.000Z' },
	});
	await seedRunDir({ cwd, manifest: { runId: 'run-b-refactor', pipeline: 'refactor', plan: 'worklist.json', updatedAt: '2026-01-02T00:00:00.000Z' } });
	await seedRunDir({ cwd, manifest: { runId: 'run-c-coverage', pipeline: 'coverage', plan: 'worklist.json', updatedAt: '2026-01-03T00:00:00.000Z' } });

	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	expect(stdout).toBe(
		[
			'run-a-ticket  passed  plan: plans/add-search/plan.md  updated: 2026-01-01T00:00:00.000Z',
			'run-b-refactor  passed  plan: worklist.json  updated: 2026-01-02T00:00:00.000Z',
			'run-c-coverage  passed  plan: worklist.json  updated: 2026-01-03T00:00:00.000Z',
			'',
		].join('\n'),
	);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});
