import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { Driver } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { dirtyPlanBody } from '#tests/helpers/dirtyPlanBody.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Every way a draft run can end badly: the harness refusing to answer, the
// spawn itself dying, and a report that claims work it never did.

test('plan draft: a rate-limited author parks the run before any repair', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'parked-author' });

	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: '', exitCode: 1, rateLimited: true };
		},
	};
	const result = await runPlanDraft({ cwd, driver, name: 'parked-author' });

	expectStatus(result, 'paused-rate-limit');
	// no re-emit retry and no repair after a rate limit
	expect(calls).toBe(1);
	// the error names the rate limit
	expect('error' in result && /rate limit/.test(result.error)).toBeTruthy();
});

test('plan draft: a parked repair surfaces as this run\u2019s own paused-rate-limit result', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'parked-repair' });

	const driver = createDraftDriver({ bodies: [dirtyPlanBody()], repair: () => ({ text: '', exitCode: 1, rateLimited: true }) });
	const result = await runPlanDraft({ cwd, driver, name: 'parked-repair' });

	expectStatus(result, 'paused-rate-limit');
	// the draft survives on disk for the re-run to overwrite
	expect(existsSync(join(cwd, '.lightsout', 'plans', 'parked-repair', 'plan.md'))).toBeTruthy();
});

test('plan draft: a repair invocation failure surfaces as this run\u2019s own failed result', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'repair-spawn-fail' });

	const driver = createDraftDriver({
		bodies: [dirtyPlanBody()],
		repair: () => {
			throw new Error('spawn failed');
		},
	});
	const result = await runPlanDraft({ cwd, driver, name: 'repair-spawn-fail' });

	expectStatus(result, 'failed');
	// the driver error reaches the caller
	expect('error' in result && /spawn failed/.test(result.error)).toBeTruthy();
});

test('plan draft: an author invocation failure returns failed with the driver error', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'author-spawn-fail' });

	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('spawn failed');
		},
	};
	const result = await runPlanDraft({ cwd, driver, name: 'author-spawn-fail' });

	expectStatus(result, 'failed');
	// the driver error reaches the caller
	expect('error' in result && /spawn failed/.test(result.error)).toBeTruthy();
});

test('plan draft: a drafted report listing no files returns failed', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'no-files' });

	const driver: Driver = {
		name: 'stub',
		invoke: async () => ({
			text: JSON.stringify({ status: 'drafted', filesWritten: [], decisionsApplied: 0, assumptions: [], discrepancies: [] }),
			exitCode: 0,
		}),
	};
	const result = await runPlanDraft({ cwd, driver, name: 'no-files' });

	expectStatus(result, 'failed');
	expect('error' in result && /no files written/.test(result.error)).toBeTruthy();
});

test('plan draft: a drafted report naming an unwritten file returns failed', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'ghost-file' });

	const ghostPath = join(cwd, '.lightsout', 'plans', 'ghost-file', 'plan.md');
	const driver: Driver = {
		name: 'stub',
		// Reports the file as written without ever writing it.
		invoke: async () => ({
			text: JSON.stringify({
				status: 'drafted',
				filesWritten: [{ path: ghostPath, variant: 'single', scope: 'single' }],
				decisionsApplied: 0,
				assumptions: [],
				discrepancies: [],
			}),
			exitCode: 0,
		}),
	};
	const result = await runPlanDraft({ cwd, driver, name: 'ghost-file' });

	expectStatus(result, 'failed');
	// the error names the missing file
	expect('error' in result && /not written/.test(result.error) && result.error.includes(ghostPath)).toBeTruthy();
});
