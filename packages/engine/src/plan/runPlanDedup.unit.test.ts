import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { DedupReport, Effort, Permissions } from '@lightsout/contracts';
import type { Driver, DriverInvocation } from '@lightsout/drivers';
import { runPlanDedup } from '../index';

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
