import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { DedupReport, Effort, Permissions } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDedup } from '#src/plan/runPlanDedup.ts';
import { createDedupJudgeDriver } from '#tests/helpers/createDedupJudgeDriver.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { seedDedupPlan } from '#tests/helpers/seedDedupPlan.ts';

// The single-plan detect-judge-persist path: what a verdict becomes, what the
// no-candidate no-op writes, and what the caller's settings do to the spawn.

/** A confirmed duplication of the seeded `src/fetchUser.ts`. */
const duplicateVerdict = { plannedSymbol: 'getUser', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchUser already does this' };

/** A repo whose one planned symbol collides, the judge ruling on it, and the collectors the act writes into. */
const setup = ({ verdicts = [] }: { verdicts?: unknown[] } = {}) => {
	const { cwd, name, workspaceDir } = seedDedupPlan({ existing: ['src/fetchUser.ts'], creates: ['src/getUser.ts'] });
	const invocations: DriverInvocation[] = [];
	const messages: string[] = [];

	return {
		cwd,
		name,
		invocations,
		messages,
		dedupPath: join(workspaceDir, 'dedup.json'),
		driver: createDedupJudgeDriver({ invocations, verdicts }),
		onProgress: (message: string) => messages.push(message),
	};
};

/** The same repo, planning a symbol nothing collides with — so the judge must never be spawned at all. */
const setupNoCandidates = () => {
	const { cwd, name, workspaceDir } = seedDedupPlan({ existing: ['src/fetchUser.ts'], creates: ['src/brandNewWidget.ts'] });
	const messages: string[] = [];

	return {
		cwd,
		name,
		messages,
		dedupPath: join(workspaceDir, 'dedup.json'),
		driver: createUncalledDriver({ reason: 'the judge must not be invoked when there are no candidates' }),
		onProgress: (message: string) => messages.push(message),
	};
};

test('plan dedup: a confirmed duplicate becomes a DedupFinding', async () => {
	const { cwd, name, driver, invocations, dedupPath } = setup({ verdicts: [duplicateVerdict] });

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect('dedup' in result).toBeTruthy();
	expect(invocations.length).toBe(1);
	expect(invocations[0]?.prompt.includes('# Dedup input')).toBeTruthy();
	expect(invocations[0]?.prompt.includes('## Detected name collisions')).toBeTruthy();
	expect(result.dedup.findings.length).toBe(1);
	expect(result.dedup.findings[0]?.plannedSymbol).toBe('getUser');
	expect(result.dedup.findings[0]?.recommendation).toBe('reuse');
	expect(result.dedup.findings[0]?.collidesWith.some((collision) => collision.name === 'fetchUser')).toBeTruthy();
	expect(existsSync(dedupPath)).toBeTruthy();

	const persisted = DedupReport.parse(JSON.parse(readFileSync(dedupPath, 'utf8')));

	// the file on disk is what the ignition skill reads, so it carries the plan's
	// name and the confirmed duplication — not merely a schema-valid shape
	expect(persisted.planName).toBe('p');
	expect(persisted.findings.map(({ plannedSymbol, recommendation }) => ({ plannedSymbol, recommendation }))).toStrictEqual([
		{ plannedSymbol: 'getUser', recommendation: 'reuse' },
	]);
});

test('plan dedup: an isDuplicate:false verdict is dropped', async () => {
	const verdict = { plannedSymbol: 'getUser', isDuplicate: false, recommendation: 'distinct', rationale: 'different concept' };
	const { cwd, name, driver, invocations } = setup({ verdicts: [verdict] });

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect('dedup' in result).toBeTruthy();
	expect(invocations.length).toBe(1);
	expect(result.dedup.findings).toStrictEqual([]);
});

test('plan dedup: no candidates → empty report and no agent call', async () => {
	const { cwd, name, driver, dedupPath } = setupNoCandidates();

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect('dedup' in result).toBeTruthy();
	expect(result.dedup.findings).toStrictEqual([]);
	expect(existsSync(dedupPath)).toBeTruthy();

	const persisted = DedupReport.parse(JSON.parse(readFileSync(dedupPath, 'utf8')));

	// a clean result is a real report naming the plan with no findings, never an
	// empty or absent file the skill would have to special-case
	expect(persisted.planName).toBe('p');
	expect(persisted.findings).toStrictEqual([]);
});

test('plan dedup: the resolved model, effort and permissions reach the harness', async () => {
	const { cwd, name, driver, invocations } = setup();

	const result = await runPlanDedup({ cwd, driver, name, model: 'gpt-5.2', effort: Effort.XHigh, permissions: Permissions.FullAccess });

	expectStatus(result, 'complete');
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([
		{ model: 'gpt-5.2', effort: 'xhigh', permissions: 'full-access' },
	]);
});

test('plan dedup: an unset effort or permissions is forwarded absent — this role invents no default', async () => {
	const { cwd, name, driver, invocations } = setup();

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([
		{ model: undefined, effort: undefined, permissions: undefined },
	]);
});

test('plan dedup: an explicit timeoutMs reaches the judging harness', async () => {
	const { cwd, name, driver, invocations } = setup();

	const result = await runPlanDedup({ cwd, driver, name, timeoutMs: 90_000 });

	expectStatus(result, 'complete');
	// the caller's ceiling is what kills a hung judge, not this role's own
	expect(invocations.map(({ timeoutMs }) => timeoutMs)).toStrictEqual([90_000]);
});

test('plan dedup: an omitted timeoutMs falls back to the thirty-minute ceiling', async () => {
	const { cwd, name, driver, invocations } = setup();

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'complete');
	// a judging spawn is never left to run forever just because no ceiling was given
	expect(invocations.map(({ timeoutMs }) => timeoutMs)).toStrictEqual([30 * 60 * 1000]);
});

test('plan dedup: progress narrates the candidates detected and the duplications to review', async () => {
	const { cwd, name, driver, messages, onProgress } = setup({ verdicts: [duplicateVerdict] });

	const result = await runPlanDedup({ cwd, driver, name, onProgress });

	expectStatus(result, 'complete');
	// the human waiting on the judge sees what was detected and what came back,
	// got: ${messages.join(' | ')}
	expect(messages).toEqual([
		expect.stringMatching(/1 candidate\(s\) detected across 1 plan file\(s\), judging/),
		expect.stringMatching(/1 duplication\(s\) to review/),
	]);
});

test('plan dedup: the no-candidate path narrates that there is nothing to review', async () => {
	const { cwd, name, driver, messages, onProgress } = setupNoCandidates();

	const result = await runPlanDedup({ cwd, driver, name, onProgress });

	expectStatus(result, 'complete');
	// a silent no-op reads as a hang; the narration says the pass ran and found nothing
	expect(messages).toEqual([expect.stringMatching(/no prior-art candidates/)]);
});

test('plan dedup: a ruling records the collision as reviewed, whichever way it went', async () => {
	const distinctVerdict = { plannedSymbol: 'getUser', isDuplicate: false, recommendation: 'distinct', rationale: 'different concept' };
	const { cwd, name, driver, dedupPath } = setup({ verdicts: [distinctVerdict] });

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'complete');

	const persisted = DedupReport.parse(JSON.parse(readFileSync(dedupPath, 'utf8')));

	// a distinct ruling leaves no finding, so `reviewed` is the only record that
	// this collision was ever weighed — and the only thing that stops plan grade
	// nudging about it forever
	expect(persisted.findings).toStrictEqual([]);
	expect(persisted.reviewed).toStrictEqual([{ plannedSymbol: 'getUser', plannedPath: 'src/getUser.ts', phase: 'plan.md' }]);
});
