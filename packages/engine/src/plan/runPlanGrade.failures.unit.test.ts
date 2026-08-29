import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readJsonlRecords } from '#src/common/utils/readJsonlRecords.ts';
import { GradeReport } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { gradeHistoryPath } from '#src/plan/gradeHistoryPath.ts';
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

test('plan grade: a judge that never satisfies its contract leaves its finding unjudged and blocking, while the pass stays complete', async () => {
	const { cwd, name, gradePath } = setupSingle({ name: 'unjudged' });
	// Every reader returns the gap; every judge answers off-contract.
	const driver = createFailingSpawnDriver({
		failsWhen: (invocation) => invocation.prompt.includes('# Gap-judge input'),
		failureText: 'this one looks fine to me',
		text: JSON.stringify({ gaps: [omittedDecisionGap] }),
	});

	const result = await runPlanGrade({ cwd, driver, name });

	// a failed judge means one finding went unweighed, not that a phase went
	// unread — the pass finished
	expectStatus(result, 'complete');

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	expect(recorded.complete).toBe(true);
	expect(recorded.phasesChecked).toStrictEqual(['plan.md']);
	// and failing closed is what keeps it out of a clean bill
	expect(recorded.grade).toBe('below-A');
	expect(recorded.gaps.map(({ outcome }) => outcome)).toStrictEqual(['unjudged', 'unjudged', 'unjudged']);
	expect(recorded.gaps[0]?.unjudgedReason ?? '').not.toBe('');
});

test('plan grade: a rate-limited judge parks the run with the verdict still written', async () => {
	const { cwd, name, invocations, gradePath } = setupSingle({ name: 'judge-walled' });
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return invocation.prompt.includes('# Gap-judge input')
				? { text: '', exitCode: 1, rateLimited: true }
				: { text: JSON.stringify({ gaps: [omittedDecisionGap] }), exitCode: 0 };
		},
	};

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'paused-rate-limit');
	// the error carries the re-run command, got: ${result.error}
	expect('error' in result && (result.error ?? '').includes('lightsout plan grade --name judge-walled')).toBeTruthy();
	expect(existsSync(gradePath)).toBeTruthy();

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	// the readers all returned, so the pass is complete; the findings nobody
	// weighed are what keeps it below the bar
	expect(recorded.complete).toBe(true);
	expect(recorded.grade).toBe('below-A');
	expect(recorded.gaps.every(({ outcome }) => outcome === 'unjudged')).toBe(true);
});

test('plan grade: a reader fan-out that hit the wall spawns no judge at all', async () => {
	const { cwd, name, invocations, gradePath } = setupSingle({ name: 'no-judges' });
	const driver = createRateLimitedDriver({ invocations });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'paused-rate-limit');
	// three readers and nothing else: a wall met by launching another twenty
	// spawns into it is still a wall
	expect(invocations.length).toBe(3);
	expect(invocations.some(({ prompt }) => prompt.includes('# Gap-judge input'))).toBe(false);
	expect(existsSync(gradePath)).toBeTruthy();
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

test('plan grade: a judge wall stops new judges launching, and the findings nobody reached still come back saying so', async () => {
	// Five phase files times three lenses, each reader returning one gap: fifteen
	// findings against the same twelve-slot ceiling, so the tail cannot all start.
	const { cwd, name, invocations, gradePath } = setupPhased({ name: 'judge-walled-tail', files: fivePhaseFiles() });
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return invocation.prompt.includes('# Gap-judge input')
				? { text: '', exitCode: 1, rateLimited: true }
				: { text: JSON.stringify({ gaps: [omittedDecisionGap] }), exitCode: 0 };
		},
	};

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'paused-rate-limit');
	// fifteen readers returned, and the twelve judges that filled the slots ran
	expect(invocations.filter(({ prompt }) => prompt.includes('# Gap-judge input')).length).toBe(12);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	// every finding comes back whatever its judge did — a finding that vanished
	// between the readers and the report would read as a plan with less wrong
	expect(recorded.gaps.length).toBe(15);
	expect(recorded.gaps.every(({ outcome }) => outcome === 'unjudged')).toBe(true);
	// and the two ways a judge can go missing are told apart on the record
	expect(recorded.gaps.filter(({ unjudgedReason }) => unjudgedReason === 'the judge was rate limited or overloaded').length).toBe(12);
	expect(recorded.gaps.filter(({ unjudgedReason }) => unjudgedReason === 'no judge ran — the fan-out stopped before this finding was judged').length).toBe(3);
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

test('plan grade: a reader wall leaves the findings its siblings did return unjudged, saying no judge was spawned', async () => {
	const { cwd, name, invocations, gradePath } = setupPhased({ name: 'wall-with-findings' });
	// Phase 2's readers hit the wall; phase 1's three all return the gap, so there
	// are findings on the table when the wall is met.
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return invocation.prompt.includes('src/other-thing.ts')
				? { text: '', exitCode: 1, rateLimited: true }
				: { text: JSON.stringify({ gaps: [omittedDecisionGap] }), exitCode: 0 };
		},
	};

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'paused-rate-limit');
	// six readers and nothing after them: findings in hand are no reason to launch
	// another three spawns into a wall that does not clear in two minutes
	expect(invocations.length).toBe(6);
	expect(invocations.some(({ prompt }) => prompt.includes('# Gap-judge input'))).toBe(false);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	// what phase 1's readers found is kept, and every one of it says plainly why
	// nobody weighed it rather than reading as a plan a judge waved through
	expect(recorded.gaps.length).toBe(3);
	expect(recorded.gaps.every(({ outcome }) => outcome === 'unjudged')).toBe(true);
	expect(recorded.gaps.map(({ unjudgedReason }) => unjudgedReason)).toStrictEqual([
		'the reader fan-out hit the rate-limit wall, so no judge was spawned',
		'the reader fan-out hit the rate-limit wall, so no judge was spawned',
		'the reader fan-out hit the rate-limit wall, so no judge was spawned',
	]);
	// and the dead readers still keep the pass off a clean bill
	expect(recorded.complete).toBe(false);
	expect(recorded.grade).toBe('below-A');
});

test('plan grade: a pass that did not finish is appended to the grade history beside the ones that did', async () => {
	const { cwd, name, invocations } = setupSingle({ name: 'parked-history' });
	const driver = createRateLimitedDriver({ invocations });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'paused-rate-limit');

	const history = await readJsonlRecords({ path: gradeHistoryPath({ cwd, name }), schema: GradeReport });

	// a pass the wall ground to a halt is still part of how the plan got its
	// grade — recording only the passes that finished would hide the re-runs
	expect(history.length).toBe(1);
	expect(history[0]?.complete).toBe(false);
	expect(history[0]?.incompleteReason ?? '').toMatch(/plan\.md\/surface: rate limited or overloaded/);
});
