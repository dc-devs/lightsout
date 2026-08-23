import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { GradeReport } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { cleanOverviewBody } from '#tests/helpers/cleanOverviewBody.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createFailingSpawnDriver } from '#tests/helpers/createFailingSpawnDriver.ts';
import { createOffContractDriver } from '#tests/helpers/createOffContractDriver.ts';
import { createRateLimitedDriver } from '#tests/helpers/createRateLimitedDriver.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { gapCheckLensOf } from '#tests/helpers/gapCheckLensOf.ts';
import { secondPhaseBody } from '#tests/helpers/secondPhaseBody.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePhasedPlanDeliverable } from '#tests/helpers/writePhasedPlanDeliverable.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// What survives a checker that dies: the plan a run cannot resolve at all, and
// the partial verdict a rate limit or an off-contract answer still leaves behind.

/** One decision-level gap, as a checker reports it. */
const omittedDecisionGap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: [] };

/** The two-phase deliverable, and the five-phase one whose fifteen checkers overrun the twelve-slot ceiling. */
const twoPhaseFiles = () => ({
	'overview.md': cleanOverviewBody(),
	'phase1-core.md': cleanPlanBody({ title: 'Graded Plan' }),
	'phase2-extra.md': secondPhaseBody(),
});

const fivePhaseFiles = () => ({
	...twoPhaseFiles(),
	'phase3-more.md': cleanPlanBody({ title: 'Graded Plan' }),
	'phase4-yet.md': cleanPlanBody({ title: 'Graded Plan' }),
	'phase5-last.md': cleanPlanBody({ title: 'Graded Plan' }),
});

/** A consumer repo holding a phased plan, plus the collector the act writes into. */
const setupPhased = ({ name, files = twoPhaseFiles() }: { name: string; files?: Record<string, string> }) => {
	const cwd = setupConsumerRepo();
	const dir = writePhasedPlanDeliverable({ cwd, name, files });
	const invocations: DriverInvocation[] = [];

	return { cwd, name, invocations, gradePath: join(dir, 'grade.json') };
};

/** A consumer repo holding one clean single plan, plus the collector the act writes into. */
const setupSingle = ({ name }: { name: string }) => {
	const cwd = setupConsumerRepo();
	const dir = writePlanDeliverable({ cwd, name, body: cleanPlanBody({ title: 'Graded Plan' }) });
	const invocations: DriverInvocation[] = [];

	return { cwd, name, invocations, gradePath: join(dir, 'grade.json') };
};

test('plan grade: a phase whose one lens failed is not claimed as checked, though its other lenses keep their gaps', async () => {
	const { cwd, name, gradePath } = setupPhased({ name: 'partial' });
	// Only phase 1's wiring checker fails; every other checker returns the gap.
	const driver = createFailingSpawnDriver({
		failsWhen: (invocation) => gapCheckLensOf(invocation) === 'wiring' && !invocation.prompt.includes('src/other-thing.ts'),
		failureText: 'looks fine to me',
		text: JSON.stringify({ gaps: [omittedDecisionGap] }),
	});

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'failed');

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	// the phase with a dead lens is absent; the fully-checked one is claimed
	expect(recorded.phasesChecked).toStrictEqual(['phase2-extra.md']);
	// and the surviving checkers' findings are kept — one failure never discards
	// the other five
	expect(recorded.gaps.map(({ phase, lens }) => `${phase}/${lens}`)).toStrictEqual([
		'phase1-core.md/surface',
		'phase1-core.md/decisions',
		'phase2-extra.md/surface',
		'phase2-extra.md/wiring',
		'phase2-extra.md/decisions',
	]);
	expect(recorded.complete).toBe(false);
	expect(recorded.incompleteReason ?? '').toMatch(/phase1-core\.md\/wiring:/);
});

test('plan grade: no deliverable on disk fails before any agent is spawned', async () => {
	const cwd = setupConsumerRepo();
	const driver = createUncalledDriver({ reason: 'the gap-check must not be invoked when the plan cannot be resolved' });

	const result = await runPlanGrade({ cwd, driver, name: 'ghost' });

	expectStatus(result, 'failed');
	// the resolve error propagates, got: ${result.error}
	expect('error' in result && /no plan found for 'ghost'/.test(result.error ?? '')).toBeTruthy();
});

test('plan grade: a failed resolve still hands back a plan workspace that exists on disk', async () => {
	const cwd = setupConsumerRepo();
	const driver = createUncalledDriver({ reason: 'the gap-check must not be invoked when the plan cannot be resolved' });

	const result = await runPlanGrade({ cwd, driver, name: 'ghost-workspace' });

	expectStatus(result, 'failed');
	// the workspace is created before the deliverable is resolved, so a failure
	// names a folder a human can really go and look in
	expect(result.workspaceDir).toBe(join(cwd, '.lightsout', 'plans', 'ghost-workspace'));
	expect(existsSync(result.workspaceDir)).toBe(true);
});

test('plan grade: a rate-limited gap-check parks the run and writes an incomplete verdict rather than discarding the pass', async () => {
	const { cwd, name, invocations, gradePath } = setupSingle({ name: 'parked' });
	const driver = createRateLimitedDriver({ invocations });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'paused-rate-limit');
	// a rate limit buys no re-emit retry, one call per lens
	expect(invocations.length).toBe(3);
	// the error carries the re-run command, got: ${result.error}
	expect('error' in result && (result.error ?? '').includes('lightsout plan grade --name parked')).toBeTruthy();
	// what finished is persisted — discarding it would turn one unlucky checker
	// into a wasted pass of up to thirty
	expect(existsSync(gradePath)).toBeTruthy();

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	// and the record refuses to read as a clean bill: nothing was checked, and it
	// says so
	expect(recorded.complete).toBe(false);
	expect(recorded.passed).toBe(false);
	expect(recorded.grade).toBe('below-A');
	expect(recorded.phasesChecked).toStrictEqual([]);
	expect(recorded.incompleteReason ?? '').toMatch(/plan\.md\/surface: rate limited or overloaded/);
	// the runner still hands the caller the partial report it just wrote
	expect('gradePath' in result && result.gradePath).toBe(gradePath);
});

test('plan grade: a rate-limited checker stops new checkers launching, and the phases never started are absent rather than reported clean', async () => {
	// Five phase files — fifteen checkers against a twelve-slot ceiling, so the
	// tail cannot all start at once.
	const { cwd, name, invocations, gradePath } = setupPhased({ name: 'walled', files: fivePhaseFiles() });
	const driver = createRateLimitedDriver({ invocations });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'paused-rate-limit');
	// fifteen checkers were queued and the twelve that filled the slots ran: a
	// five-hour budget wall does not clear in two minutes, so meeting it by
	// launching the last three spawns into it only spends the re-run's budget
	expect(invocations.length).toBe(12);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	// nothing finished all three lenses, so nothing is claimed
	expect(recorded.phasesChecked).toStrictEqual([]);
	expect(recorded.complete).toBe(false);
	// the phase whose checkers never started is named nowhere — not as a failure,
	// and above all not as checked and clean
	expect(recorded.incompleteReason ?? '').not.toMatch(/phase5-last\.md/);
	expect(recorded.incompleteReason ?? '').toMatch(/phase1-core\.md\/surface: rate limited or overloaded/);
});

test('plan grade: a gap-check that never satisfies the contract fails, naming the plan file', async () => {
	const { cwd, name, invocations, gradePath } = setupSingle({ name: 'malformed' });
	const driver = createOffContractDriver({ text: 'the plan looks fine to me', invocations });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'failed');
	// each of the three checkers bought exactly one re-emit retry
	expect(invocations.length).toBe(6);
	// the failure names the plan file and the lens it was checking with, got: ${result.error}
	expect('error' in result && (result.error ?? '').includes('gap-check failed for plan.md/surface')).toBeTruthy();
	// a verdict IS written — marked incomplete, so the failure cannot read as a
	// plan with nothing wrong
	expect(existsSync(gradePath)).toBeTruthy();

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	expect(recorded.complete).toBe(false);
	expect(recorded.phasesChecked).toStrictEqual([]);
});
