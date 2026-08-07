import { expect, test } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DedupReport, Effort, Permissions } from '@/contracts';
import type { Driver, DriverInvocation } from '@/drivers';
import { runPlanDedup } from '@/plan';
import { expectStatus } from '@tests/helpers/expectStatus';

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

		// dedup invocation marker present
		expect(prompt.includes('# Dedup input')).toBeTruthy();
		// detected-collisions section present
		expect(prompt.includes('## Detected name collisions')).toBeTruthy();

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

	expectStatus(result, 'complete');
	expect('dedup' in result).toBeTruthy();
	// the judge was invoked once
	expect(calls.count).toBe(1);
	expect(result.dedup.findings.length).toBe(1);
	expect(result.dedup.findings[0]?.plannedSymbol).toBe('getUser');
	expect(result.dedup.findings[0]?.recommendation).toBe('reuse');
	expect(result.dedup.findings[0]?.collidesWith.some((collision) => collision.name === 'fetchUser')).toBeTruthy();

	const dedupPath = join(cwd, '.lightsout', 'plans', name, 'dedup.json');

	// dedup.json written
	expect(existsSync(dedupPath)).toBeTruthy();
	expect(() => DedupReport.parse(JSON.parse(readFileSync(dedupPath, 'utf8')))).not.toThrow();
});

test('plan dedup: an isDuplicate:false verdict is dropped', async () => {
	const { cwd, plansDir, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const calls = { count: 0 };
	const verdict = { plannedSymbol: 'getUser', isDuplicate: false, recommendation: 'distinct', rationale: 'different concept' };
	const result = await runPlanDedup({ cwd, driver: judgeDriver([verdict], calls), name, plansDir });

	expectStatus(result, 'complete');
	expect('dedup' in result).toBeTruthy();
	expect(calls.count).toBe(1);
	expect(result.dedup.findings).toStrictEqual([]);
});

test('plan dedup: no candidates → empty report and no agent call', async () => {
	const { cwd, plansDir, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/brandNewWidget.ts'] });
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('the judge must not be invoked when there are no candidates');
		},
	};
	const result = await runPlanDedup({ cwd, driver: failIfCalled, name, plansDir });

	expectStatus(result, 'complete');
	expect('dedup' in result).toBeTruthy();
	expect(result.dedup.findings).toStrictEqual([]);

	const dedupPath = join(cwd, '.lightsout', 'plans', name, 'dedup.json');

	// dedup.json still written on the no-op path
	expect(existsSync(dedupPath)).toBeTruthy();
});

test('plan dedup: a missing deliverable fails with the plan workspace already created', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dedup-missing-'));
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('the judge must not be invoked when the deliverable does not resolve');
		},
	};
	const result = await runPlanDedup({ cwd, driver: failIfCalled, name: 'ghost', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'failed');
	// the resolve error propagates
	expect('error' in result && /no plan found for 'ghost'/.test(result.error)).toBeTruthy();
	expect(result.workspaceDir).toBe(join(cwd, '.lightsout', 'plans', 'ghost'));
	// the workspace is created before the resolve, so a failure still has
	// somewhere to report from
	expect(existsSync(result.workspaceDir)).toBeTruthy();
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

	expectStatus(result, 'complete');
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([{ model: 'gpt-5.2', effort: 'xhigh', permissions: 'full-access' }]);
});

test('plan dedup: an unset effort or permissions is forwarded absent — this role invents no default', async () => {
	const { cwd, plansDir, name } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const invocations: DriverInvocation[] = [];
	const result = await runPlanDedup({ cwd, driver: recordingJudgeDriver(invocations), name, plansDir });

	expectStatus(result, 'complete');
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([{ model: undefined, effort: undefined, permissions: undefined }]);
});

test('plan dedup: no deliverable on disk fails before any detection or judging', async () => {
	const { cwd, plansDir } = setup({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('the judge must not be invoked when the plan cannot be resolved');
		},
	};
	const result = await runPlanDedup({ cwd, driver: failIfCalled, name: 'ghost', plansDir });

	expectStatus(result, 'failed');
	// the resolve error propagates, got: ${result.error}
	expect('error' in result && /no plan found for 'ghost'/.test(result.error ?? '')).toBeTruthy();
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

	expectStatus(result, 'paused-rate-limit');
	// a rate limit buys no re-emit retry
	expect(calls).toBe(1);
	// the error carries the re-run command, got: ${result.error}
	expect('error' in result && (result.error ?? '').includes(`lightsout plan dedup --name ${name}`)).toBeTruthy();
	// a parked run leaves no findings behind
	expect(existsSync(join(cwd, '.lightsout', 'plans', name, 'dedup.json'))).toBeFalsy();
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

	expectStatus(result, 'failed');
	// the rejected report bought exactly one re-emit retry
	expect(calls).toBe(2);
	// the failure names the judging step, got: ${result.error}
	expect('error' in result && /dedup judge failed/.test(result.error ?? '')).toBeTruthy();
	// no report is written for a failed judgment
	expect(existsSync(join(cwd, '.lightsout', 'plans', name, 'dedup.json'))).toBeFalsy();
});
