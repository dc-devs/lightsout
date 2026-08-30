import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readJsonlRecords } from '#src/common/utils/readJsonlRecords.ts';
import { Effort, GradeReport, Permissions } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { gradeHistoryPath } from '#src/plan/gradeHistoryPath.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { advisoryPlanBody, plantAdvisoryTouchedFiles } from '#tests/helpers/advisoryPlan.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// The single-plan verdict: what the deterministic half and the gap-check fan-out
// together grade a plan, and what the caller's settings do to the spawns.

/** One decision-level gap, as a checker reports it. */
const omittedDecisionGap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: ['throw', 'null'] };

/** A consumer repo with one graded plan on disk, the checker stub reading it, and the collectors the act writes into. */
const setup = ({
	name,
	body = cleanPlanBody({ title: 'Graded Plan' }),
	gaps = [],
	verdict,
}: {
	name: string;
	body?: string;
	gaps?: unknown[];
	verdict?: unknown;
}) => {
	const cwd = setupConsumerRepo();
	const dir = writePlanDeliverable({ cwd, name, body });
	const invocations: DriverInvocation[] = [];
	const messages: string[] = [];

	return {
		cwd,
		name,
		invocations,
		messages,
		gradePath: join(dir, 'grade.json'),
		driver: createGapCheckDriver({ gaps, verdict, invocations }),
		onProgress: (message: string) => messages.push(message),
	};
};

/** The same repo, planning a mostly-mechanical edit across 50 planted modules — the advisory size note and nothing blocking. */
const setupAdvisory = () => {
	const seeded = setup({ name: 'noted', body: advisoryPlanBody({ title: 'Graded Plan' }) });

	plantAdvisoryTouchedFiles({ cwd: seeded.cwd });

	return seeded;
};

/** The same repo, with an existing export the plan's created symbol still name-collides with. */
const setupPriorArtCollision = () => {
	const seeded = setup({ name: 'colliding' });

	// The plan creates `src/new-thing.ts`; an existing `thingNew` export is its
	// word-order twin — the same tier-0 name key, and not a mere casing pair —
	// so the detector still sees prior art.
	writeFileSync(join(seeded.cwd, 'src', 'thingNew.ts'), 'export const thingNew = 1;\n');

	return seeded;
};

/** The same repo, where the surface lens' finding is judged settled and the other two lenses' findings are ruled a human's to answer. */
const setupMixedVerdicts = () => {
	const seeded = setup({ name: 'mixed' });
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			seeded.invocations.push(invocation);

			if (!invocation.prompt.includes('# Gap-judge input')) {
				return { text: JSON.stringify({ gaps: [omittedDecisionGap] }), exitCode: 0 };
			}

			const settled = invocation.prompt.includes('- lens: surface');

			return {
				text: JSON.stringify(
					settled
						? { outcome: 'agent-can-decide', agentDecision: 'return null', safeBecause: 'every sibling in this module already does' }
						: { outcome: 'needs-a-human', humanDecision: 'what the plan should do here' },
				),
				exitCode: 0,
			};
		},
	};

	return { ...seeded, driver };
};

test('plan grade: a clean plan with no gaps passes as grade A', async () => {
	const { cwd, name, driver, gradePath } = setup({ name: 'clean' });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	expect(result.grade.grade).toBe('A');
	expect(result.grade.passed).toBe(true);
	expect(existsSync(gradePath)).toBeTruthy();

	const persisted = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	// the verdict on disk is the verdict returned, not merely a well-shaped file
	expect(persisted).toEqual(expect.objectContaining({ planName: 'clean', grade: 'A', passed: true, structural: [], gaps: [] }));
	// and it states what it covered, so a clean bill can be told from a pass that
	// never looked
	expect(persisted.phasesChecked).toStrictEqual(['plan.md']);
	expect(persisted.lenses).toStrictEqual(['surface', 'wiring', 'decisions']);
	expect(persisted.complete).toBe(true);
});

test('plan grade: findings every judge rules the implementing agent can settle grade A, and are still recorded', async () => {
	const { cwd, name, driver, gradePath } = setup({
		name: 'noted-gaps',
		gaps: [omittedDecisionGap],
		verdict: { outcome: 'agent-can-decide', agentDecision: 'return null', safeBecause: 'every sibling in this module already does' },
	});

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	// the whole point of judging: three findings nobody has to answer are not the
	// same as three blockers
	expect(result.grade.grade).toBe('A');
	expect(result.grade.passed).toBe(true);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	// and they are on the record whatever the verdict says
	expect(recorded.gaps.length).toBe(3);
	expect(recorded.gaps.map(({ outcome }) => outcome)).toStrictEqual(['agent-can-decide', 'agent-can-decide', 'agent-can-decide']);
	expect(recorded.gaps[0]?.agentDecision).toBe('return null');
});

test('plan grade: a judge that dismisses a finding by citing a file that is not there leaves it unjudged, so it still blocks', async () => {
	const { cwd, name, driver } = setup({
		name: 'ghost-citation',
		gaps: [omittedDecisionGap],
		verdict: { outcome: 'already-answered', answerAt: 'src/nowhere.ts:answer' },
	});

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	// a citation is the only thing that makes a dismissal checkable — one pointing
	// nowhere is not a considered answer
	expect(result.grade.grade).toBe('below-A');
	expect(result.grade.gaps[0]?.outcome).toBe('unjudged');
	expect(result.grade.gaps[0]?.unjudgedReason).toBe('the judge cited src/nowhere.ts:answer, which is not on disk');
});

test('plan grade: a gap-returning stub fails the plan with the gaps recorded', async () => {
	const { cwd, name, driver, gradePath } = setup({ name: 'gappy', gaps: [omittedDecisionGap] });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	expect(result.grade.passed).toBe(false);
	expect(result.grade.grade).toBe('below-A');
	// one gap per lens: three checkers read the same plan, and every one of them
	// reported it
	expect(result.grade.gaps.length).toBe(3);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	expect(recorded.gaps[0]?.area).toBe('omitted-decision');
	// the default stub judge says a human must settle it, which is what blocks
	expect(recorded.gaps[0]?.outcome).toBe('needs-a-human');
	expect(recorded.gaps[0]?.humanDecision).toBe('what the plan should do here');
});

test('plan grade: every lens that finds the same gap contributes it, and the engine stamps each with the phase and lens that found it', async () => {
	const { cwd, name, driver } = setup({ name: 'union', gaps: [{ ...omittedDecisionGap, options: [] }] });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	// the union, not a vote: three lenses agreeing reads as three labelled gaps
	// rather than as one, because merging them needs a similarity judgment the
	// engine is not allowed to make silently
	expect(result.grade.gaps.map(({ phase, lens }) => `${phase}/${lens}`)).toStrictEqual(['plan.md/surface', 'plan.md/wiring', 'plan.md/decisions']);
});

test('plan grade: an advisory structural finding is persisted with the rest but never decides the verdict', async () => {
	const { cwd, name, driver, gradePath } = setupAdvisory();

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	// a mostly-mechanical plan is legal work: the note belongs in grade.json, and
	// nowhere near the verdict
	expect(result.grade.grade).toBe('A');
	expect(result.grade.passed).toBe(true);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	expect(recorded.structural.map(({ check, severity }) => ({ check, severity }))).toStrictEqual([{ check: 'scope-within-guardrail', severity: 'advisory' }]);
});

test('plan grade: a structural defect gates independently of the gap agent', async () => {
	// A planted TBD — the code structural re-check must fire even when the gap
	// agent reports NONE.
	const { cwd, name, driver } = setup({ name: 'planted', body: cleanPlanBody({ title: 'Graded Plan' }).replace('A new module', 'TBD — a new module') });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	expect(result.grade.structural.length > 0).toBeTruthy();
	expect(result.grade.passed).toBe(false);
});

test('plan grade: the resolved model, effort and permissions reach the gap-check driver', async () => {
	const { cwd, name, driver, invocations } = setup({ name: 'threaded' });

	const result = await runPlanGrade({ cwd, driver, name, model: 'gpt-5.2', effort: Effort.High, permissions: Permissions.FullAccess });

	expectStatus(result, 'complete');
	// every checker in the fan-out is spawned with the same resolved settings
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([
		{ model: 'gpt-5.2', effort: 'high', permissions: 'full-access' },
		{ model: 'gpt-5.2', effort: 'high', permissions: 'full-access' },
		{ model: 'gpt-5.2', effort: 'high', permissions: 'full-access' },
	]);
});

test('plan grade: an omitted effort and permissions stay absent so the harness default stands', async () => {
	const { cwd, name, driver, invocations } = setup({ name: 'defaulted' });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([
		{ model: undefined, effort: undefined, permissions: undefined },
		{ model: undefined, effort: undefined, permissions: undefined },
		{ model: undefined, effort: undefined, permissions: undefined },
	]);
});

test('plan grade: an explicit timeoutMs reaches the gap-check driver', async () => {
	const { cwd, name, driver, invocations } = setup({ name: 'bounded' });

	const result = await runPlanGrade({ cwd, driver, name, timeoutMs: 90_000 });

	expectStatus(result, 'complete');
	// the caller's ceiling is what kills a hung gap-check, not this role's own
	expect(invocations.map(({ timeoutMs }) => timeoutMs)).toStrictEqual([90_000, 90_000, 90_000]);
});

test('plan grade: a planned symbol still colliding with an existing export is narrated, never gated', async () => {
	const { cwd, name, driver, messages, onProgress } = setupPriorArtCollision();

	const result = await runPlanGrade({ cwd, driver, name, onProgress });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	// a raw name collision is advisory — the Dedup Review phase enforces, not
	// grade
	expect(result.grade.grade).toBe('A');
	// the advisory points at the dedup command, got: ${messages.join(' | ')}
	expect(messages.some((message) => message.includes('lightsout plan dedup --name colliding'))).toBeTruthy();
	// the run also narrates what it gap-checked and the verdict it reached, so a
	// clean pass is legible without opening grade.json
	expect(messages).toEqual(
		expect.arrayContaining([
			expect.stringMatching(/0 structural finding\(s\), gap-checking 1 of 1 plan file\(s\) × 3 lens\(es\)/),
			expect.stringMatching(/judged 0 finding\(s\), 0 blocking/),
			expect.stringMatching(/A \(0 structural, 0 gap\(s\), 0 blocking\)/),
		]),
	);
});

test('plan grade: a pass whose findings are judged both ways grades on the blocking ones alone, and narrates both counts', async () => {
	const { cwd, name, driver, messages, onProgress } = setupMixedVerdicts();

	const result = await runPlanGrade({ cwd, driver, name, onProgress });

	expectStatus(result, 'complete');
	// one lens' finding is settled and two are not: what is left to answer is two,
	// and one of them is enough to keep the plan below the bar
	expect(result.grade.gaps.map(({ outcome }) => outcome)).toStrictEqual(['agent-can-decide', 'needs-a-human', 'needs-a-human']);
	expect(result.grade.grade).toBe('below-A');
	expect(result.grade.passed).toBe(false);
	// and the run says how many findings there were AND how many a human still has
	// to answer, because the two numbers differing is the whole point of judging,
	// got: ${messages.join(' | ')}
	expect(messages).toEqual(
		expect.arrayContaining([
			expect.stringMatching(/judged 3 finding\(s\), 2 blocking/),
			expect.stringMatching(/below-A \(0 structural, 3 gap\(s\), 2 blocking\)/),
		]),
	);
});

test("plan grade: a completed pass is appended to the plan's grade history", async () => {
	const { cwd, name, driver } = setup({ name: 'recorded' });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');

	const history = await readJsonlRecords({ path: gradeHistoryPath({ cwd, name }), schema: GradeReport });

	expect(history.length).toBe(1);
	// the ledger line is the pass itself, not a summary of it
	expect(history[0]?.grade).toBe(result.grade.grade);
	expect(history[0]?.gradedAt).toBe(result.grade.gradedAt);
});

test('plan grade: a second pass leaves two history lines and one latest grade', async () => {
	const { cwd, name, driver, gradePath } = setup({ name: 're-graded' });

	await runPlanGrade({ cwd, driver, name });
	const second = await runPlanGrade({ cwd, driver, name });

	expectStatus(second, 'complete');

	const history = await readJsonlRecords({ path: gradeHistoryPath({ cwd, name }), schema: GradeReport });

	// re-grading a plan no longer throws the earlier pass away
	expect(history.length).toBe(2);
	// and grade.json still holds exactly one report — the latest pass
	const latest = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	expect(latest.gradedAt).toBe(second.grade.gradedAt);
	expect(latest.grade).toBe(second.grade.grade);
});
