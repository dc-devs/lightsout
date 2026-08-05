import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DedupReport, Effort, Permissions } from '@/contracts';
import type { Driver, DriverInvocation } from '@/drivers';
import { runPlanDedup } from '@/plan';

/** A temp repo with the given existing source files and a single-file plan at <plansDir>/<name>.md. */
const setup = ({ existing, creates, name = 'p' }: { existing: string[]; creates: string[]; name?: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dedup-run-'));

	for (const rel of existing) {
		const abs = join(cwd, rel);

		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, 'export const x = 1;\n');
	}

	const plansDir = join(cwd, '.claude', 'plans');

	mkdirSync(plansDir, { recursive: true });

	const body = `# Plan\n\n## Files to Create\n\n${creates.map((path) => `### \`${path}\`\n\nnew.\n`).join('\n')}\n`;

	writeFileSync(join(plansDir, `${name}.md`), body);

	return { cwd, plansDir, name };
};

/** A dedup-judge stub returning a fixed verdict set, counting its invocations. */
const judgeDriver = (verdicts: unknown[], calls: { count: number }): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		calls.count += 1;

		assert.ok(prompt.includes('# Dedup input'), 'dedup invocation marker present');
		assert.ok(prompt.includes('## Detected name collisions'), 'detected-collisions section present');

		return { text: JSON.stringify({ verdicts }), exitCode: 0 };
	},
});

/** A dedup-judge stub that records every invocation it is handed, judging nothing a duplicate. */
const recordingJudgeDriver = (invocations: DriverInvocation[]): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		return { text: JSON.stringify({ verdicts: [] }), exitCode: 0 };
	},
});

test('plan dedup: a confirmed duplicate becomes a DedupFinding', async () => {
	const { cwd, plansDir, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const calls = { count: 0 };
	const verdict = { plannedSymbol: 'getUser', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchUser already does this' };
	const result = await runPlanDedup({ cwd, driver: judgeDriver([verdict], calls), name, plansDir });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.ok('dedup' in result);
	assert.equal(calls.count, 1, 'the judge was invoked once');
	assert.equal(result.dedup.findings.length, 1);
	assert.equal(result.dedup.findings[0]?.plannedSymbol, 'getUser');
	assert.equal(result.dedup.findings[0]?.recommendation, 'reuse');
	assert.ok(result.dedup.findings[0]?.collidesWith.some((collision) => collision.name === 'fetchUser'));

	const dedupPath = join(cwd, '.lightsout', 'plans', name, 'dedup.json');

	assert.ok(existsSync(dedupPath), 'dedup.json written');
	assert.doesNotThrow(() => DedupReport.parse(JSON.parse(readFileSync(dedupPath, 'utf8'))));
});

test('plan dedup: an isDuplicate:false verdict is dropped', async () => {
	const { cwd, plansDir, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const calls = { count: 0 };
	const verdict = { plannedSymbol: 'getUser', isDuplicate: false, recommendation: 'distinct', rationale: 'different concept' };
	const result = await runPlanDedup({ cwd, driver: judgeDriver([verdict], calls), name, plansDir });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.ok('dedup' in result);
	assert.equal(calls.count, 1);
	assert.deepEqual(result.dedup.findings, []);
});

test('plan dedup: no candidates → empty report and no agent call', async () => {
	const { cwd, plansDir, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/brandNewWidget.ts'] });
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => assert.fail('the judge must not be invoked when there are no candidates'),
	};
	const result = await runPlanDedup({ cwd, driver: failIfCalled, name, plansDir });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.ok('dedup' in result);
	assert.deepEqual(result.dedup.findings, []);

	const dedupPath = join(cwd, '.lightsout', 'plans', name, 'dedup.json');

	assert.ok(existsSync(dedupPath), 'dedup.json still written on the no-op path');
});

test('plan dedup: a missing deliverable fails with the plan workspace already created', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dedup-missing-'));
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => assert.fail('the judge must not be invoked when the deliverable does not resolve'),
	};
	const result = await runPlanDedup({ cwd, driver: failIfCalled, name: 'ghost', plansDir: join(cwd, '.claude', 'plans') });

	assert.equal(result.status, 'failed');
	assert.ok('error' in result && /no plan found for 'ghost'/.test(result.error), 'the resolve error propagates');
	assert.equal(result.workspaceDir, join(cwd, '.lightsout', 'plans', 'ghost'));
	assert.ok(existsSync(result.workspaceDir), 'the workspace is created before the resolve, so a failure still has somewhere to report from');
});

test('plan dedup: the resolved model, effort and permissions reach the harness', async () => {
	const { cwd, plansDir, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const invocations: DriverInvocation[] = [];
	const result = await runPlanDedup({
		cwd,
		driver: recordingJudgeDriver(invocations),
		name,
		plansDir,
		model: 'gpt-5.2',
		effort: Effort.XHigh,
		permissions: Permissions.FullAccess,
	});

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.deepEqual(
		invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions })),
		[{ model: 'gpt-5.2', effort: 'xhigh', permissions: 'full-access' }],
	);
});

test('plan dedup: an unset effort or permissions is forwarded absent — this role invents no default', async () => {
	const { cwd, plansDir, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const invocations: DriverInvocation[] = [];
	const result = await runPlanDedup({ cwd, driver: recordingJudgeDriver(invocations), name, plansDir });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.deepEqual(
		invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions })),
		[{ model: undefined, effort: undefined, permissions: undefined }],
	);
});

test('plan dedup: no deliverable on disk fails before any detection or judging', async () => {
	const { cwd, plansDir } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => assert.fail('the judge must not be invoked when the plan cannot be resolved'),
	};
	const result = await runPlanDedup({ cwd, driver: failIfCalled, name: 'ghost', plansDir });

	assert.equal(result.status, 'failed');
	assert.ok('error' in result && /no plan found for 'ghost'/.test(result.error ?? ''), `the resolve error propagates, got: ${result.error}`);
});

test('plan dedup: a rate-limited judge parks the run and writes no report', async () => {
	const { cwd, plansDir, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: '', exitCode: 1, rateLimited: true };
		},
	};
	const result = await runPlanDedup({ cwd, driver, name, plansDir });

	assert.equal(result.status, 'paused-rate-limit');
	assert.equal(calls, 1, 'a rate limit buys no re-emit retry');
	assert.ok('error' in result && (result.error ?? '').includes(`lightsout plan dedup --name ${name}`), `the error carries the re-run command, got: ${result.error}`);
	assert.ok(!existsSync(join(cwd, '.lightsout', 'plans', name, 'dedup.json')), 'a parked run leaves no findings behind');
});

test('plan dedup: a judge whose output never satisfies the contract fails and writes no report', async () => {
	const { cwd, plansDir, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: 'they all look distinct to me', exitCode: 0 };
		},
	};
	const result = await runPlanDedup({ cwd, driver, name, plansDir });

	assert.equal(result.status, 'failed');
	assert.equal(calls, 2, 'the rejected report bought exactly one re-emit retry');
	assert.ok('error' in result && /dedup judge failed/.test(result.error ?? ''), `the failure names the judging step, got: ${result.error}`);
	assert.ok(!existsSync(join(cwd, '.lightsout', 'plans', name, 'dedup.json')), 'no report is written for a failed judgment');
});
