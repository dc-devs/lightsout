import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { DedupReport } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDedup } from '#src/plan/runPlanDedup.ts';
import { createDedupJudgeDriver } from '#tests/helpers/createDedupJudgeDriver.ts';
import { createFailingSpawnDriver } from '#tests/helpers/createFailingSpawnDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { overviewMarker } from '#tests/helpers/overviewMarker.ts';
import { seedPhasedDedupPlan } from '#tests/helpers/seedPhasedDedupPlan.ts';

// The per-plan-file fan-out: one judge per phase, each given only its own file,
// and what survives when one of them dies.

/** A phased repo, the judge stub ruling on it, and the collector the act writes into. */
const setup = ({ existing, phases, verdicts = [] }: { existing: string[]; phases: string[][]; verdicts?: unknown[] }) => {
	const { cwd, name, workspaceDir } = seedPhasedDedupPlan({ existing, phases });
	const invocations: DriverInvocation[] = [];

	return { cwd, name, invocations, dedupPath: join(workspaceDir, 'dedup.json'), driver: createDedupJudgeDriver({ invocations, verdicts }) };
};

test('plan dedup: a phased plan is judged one agent per plan file, each given only its own file and its own collisions', async () => {
	const verdicts = [
		{ plannedSymbol: 'getUser', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchUser already does this' },
		{ plannedSymbol: 'getOrder', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchOrder already does this' },
	];
	const { cwd, name, driver, invocations, dedupPath } = setup({
		existing: ['src/fetchUser.ts', 'src/fetchOrder.ts'],
		phases: [['src/getUser.ts'], ['src/getOrder.ts']],
		verdicts,
	});

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'complete');
	// one judge per plan file — gluing every phase into one prompt is the
	// single-agent-whole-plan shape this fan-out replaces
	expect(invocations.length).toBe(2);
	// and each judge sees exactly one file's collisions
	expect(invocations.map(({ prompt }) => [prompt.includes('getUser'), prompt.includes('getOrder')])).toStrictEqual([
		[true, false],
		[false, true],
	]);
	// both phases' planned symbols came back as findings, in plan-file order
	expect(result.dedup.findings.map(({ plannedSymbol, phase }) => [plannedSymbol, phase])).toStrictEqual([
		['getUser', 'phase1-part.md'],
		['getOrder', 'phase2-part.md'],
	]);
	// the overview rides every system prompt as context, never the text under judgment
	expect(invocations.every(({ systemPrompt }) => (systemPrompt ?? '').includes(overviewMarker))).toBeTruthy();
	expect(invocations.some(({ prompt }) => prompt.includes(overviewMarker))).toBeFalsy();
	// the report lands in the plan's own folder, beside the phases it judged
	expect(result.dedupPath).toBe(dedupPath);
});

test('plan dedup: a plan file with no collisions spawns no judge, while its sibling still gets one', async () => {
	const verdicts = [{ plannedSymbol: 'getUser', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchUser already does this' }];
	const { cwd, name, driver, invocations } = setup({
		existing: ['src/fetchUser.ts'],
		phases: [['src/getUser.ts'], ['src/brandNewWidget.ts']],
		verdicts,
	});

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'complete');
	// the no-candidates-no-agent rule is now per plan file rather than per plan
	expect(invocations.length).toBe(1);
	expect(invocations[0]?.prompt.includes('getUser')).toBeTruthy();
	expect(invocations[0]?.prompt.includes('brandNewWidget')).toBeFalsy();
	expect(result.dedup.findings.map(({ plannedSymbol, phase }) => [plannedSymbol, phase])).toStrictEqual([['getUser', 'phase1-part.md']]);
	// nothing failed, so the scan speaks for the whole plan
	expect(result.dedup.complete).toBe(true);
});

test('plan dedup: one failed judge never discards what the other plan files returned', async () => {
	const { cwd, name, dedupPath } = setup({ existing: ['src/fetchUser.ts', 'src/fetchOrder.ts'], phases: [['src/getUser.ts'], ['src/getOrder.ts']] });
	const verdict = { plannedSymbol: 'getOrder', isDuplicate: true, recommendation: 'reuse', rationale: 'fetchOrder already does this' };
	// Only phase 1's judge never satisfies the contract — and neither does its
	// re-emit retry, whose prompt carries the rejected text back rather than the
	// plan file that earned it.
	const stumped = 'phase 1 has me stumped';
	const driver = createFailingSpawnDriver({
		failsWhen: ({ prompt }) => prompt.includes('getUser') || prompt.includes(stumped),
		failureText: stumped,
		text: JSON.stringify({ verdicts: [verdict] }),
	});

	const result = await runPlanDedup({ cwd, driver, name });

	expectStatus(result, 'failed');
	// the failure names only the plan file whose judge died, got: ${result.error}
	expect('error' in result && (result.error ?? '')).toMatch(/dedup judge failed for phase1-part\.md:/);
	expect('error' in result && (result.error ?? '')).not.toMatch(/phase2-part\.md/);

	const persisted = DedupReport.parse(JSON.parse(readFileSync(dedupPath, 'utf8')));

	// the surviving judge's finding is kept — a partial scan is persisted rather
	// than thrown away, and marked for what it is
	expect(persisted.findings.map(({ plannedSymbol, phase }) => [plannedSymbol, phase])).toStrictEqual([['getOrder', 'phase2-part.md']]);
	expect(persisted.complete).toBe(false);
	expect(persisted.incompleteReason ?? '').toMatch(/^phase1-part\.md: /);
});
