import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { DedupReport } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDedup } from '#src/plan/runPlanDedup.ts';
import { createOffContractDriver } from '#tests/helpers/createOffContractDriver.ts';
import { createRateLimitedDriver } from '#tests/helpers/createRateLimitedDriver.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { seedDedupPlan } from '#tests/helpers/seedDedupPlan.ts';

// What the run does when it cannot resolve a plan, and what it still persists
// when the judge it did spawn never comes back with a contract.

/** The prose an off-contract judge returns instead of a judgment. */
const offContractText = 'they all look distinct to me';

/** A repo whose one planned symbol collides, plus the collector the act writes into. */
const setup = () => {
	const { cwd, name, workspaceDir } = seedDedupPlan({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const invocations: DriverInvocation[] = [];

	return { cwd, name, workspaceDir, invocations, dedupPath: join(workspaceDir, 'dedup.json') };
};

/**
 * The same plan, with a directory squatting on the path each rejected payload
 * wants to be written to, so saving that evidence fails with `EISDIR`.
 */
const setupUnwritableEvidence = () => {
	const seeded = setup();

	// one per attempt: the first judgment and its single re-emit retry, under the
	// per-plan-file step the fan-out names each judge's evidence with
	mkdirSync(join(seeded.workspaceDir, 'dedup-plan-rejected-1.txt'));
	mkdirSync(join(seeded.workspaceDir, 'dedup-plan-rejected-2.txt'));

	return seeded;
};

test('plan dedup: a missing deliverable fails with the plan workspace already created', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dedup-missing-'));
	const driver = createUncalledDriver({ reason: 'the judge must not be invoked when the deliverable does not resolve' });

	const result = await runPlanDedup({ cwd, driver, name: 'ghost' });

	expectStatus(result, 'failed');
	// the resolve error propagates
	expect('error' in result && /no plan found for 'ghost'/.test(result.error)).toBeTruthy();
	expect(result.workspaceDir).toBe(join(cwd, '.lightsout', 'plans', 'ghost'));
	// the workspace is created before the resolve, so a failure still has
	// somewhere to report from
	expect(existsSync(result.workspaceDir)).toBeTruthy();
});

test('plan dedup: no deliverable on disk fails before any detection or judging', async () => {
	const { cwd } = setup();
	const driver = createUncalledDriver({ reason: 'the judge must not be invoked when the plan cannot be resolved' });

	const result = await runPlanDedup({ cwd, driver, name: 'ghost' });

	expectStatus(result, 'failed');
	// the resolve error propagates, got: ${result.error}
	expect('error' in result && /no plan found for 'ghost'/.test(result.error ?? '')).toBeTruthy();
});

test('plan dedup: a rate-limited judge parks the run and writes an incomplete report rather than discarding the scan', async () => {
	const { cwd, name, invocations, dedupPath } = setup();
	const driver = createRateLimitedDriver({ invocations });

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'paused-rate-limit');
	// a rate limit buys no re-emit retry
	expect(invocations.length).toBe(1);
	// the error carries the re-run command, got: ${result.error}
	expect('error' in result && (result.error ?? '').includes(`lightsout plan dedup --name ${name}`)).toBeTruthy();
	// the report IS written, marked incomplete — an empty findings list from a
	// parked scan must never read as "no duplication found"
	expect(existsSync(dedupPath)).toBeTruthy();

	const persisted = DedupReport.parse(JSON.parse(readFileSync(dedupPath, 'utf8')));

	expect(persisted.findings).toStrictEqual([]);
	expect(persisted.complete).toBe(false);
	expect(persisted.incompleteReason ?? '').toMatch(/plan\.md: rate limited or overloaded/);
});

test('plan dedup: a judge whose output never satisfies the contract fails, keeping the scan marked incomplete', async () => {
	const { cwd, name, invocations, dedupPath } = setup();
	const driver = createOffContractDriver({ text: offContractText, invocations });

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'failed');
	// the rejected report bought exactly one re-emit retry
	expect(invocations.length).toBe(2);
	// the failure names the plan file whose judge died, got: ${result.error}
	expect('error' in result && /dedup judge failed for plan\.md/.test(result.error ?? '')).toBeTruthy();

	const persisted = DedupReport.parse(JSON.parse(readFileSync(dedupPath, 'utf8')));

	// what finished is kept, marked incomplete
	expect(persisted.complete).toBe(false);
});

test('plan dedup: evidence that cannot be saved never replaces the judging failure it was recording', async () => {
	const { cwd, name, invocations, dedupPath } = setupUnwritableEvidence();
	const driver = createOffContractDriver({ text: offContractText, invocations });

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'failed');
	// saving the rejected payload is best-effort: a failed write is swallowed, so
	// the step still buys its re-emit retry and reports why judging failed rather
	// than rejecting with the filesystem error
	expect(invocations.length).toBe(2);
	expect('error' in result && /dedup judge failed/.test(result.error ?? '')).toBeTruthy();

	const persisted = DedupReport.parse(JSON.parse(readFileSync(dedupPath, 'utf8')));

	expect(persisted.complete).toBe(false);
});
