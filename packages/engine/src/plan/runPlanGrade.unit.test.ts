import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { Effort, GradeReport, Permissions } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
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
const setup = ({ name, body = cleanPlanBody({ title: 'Graded Plan' }), gaps = [] }: { name: string; body?: string; gaps?: unknown[] }) => {
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
		driver: createGapCheckDriver({ gaps, invocations }),
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
			expect.stringMatching(/A \(0 structural, 0 gap\(s\)\)/),
		]),
	);
});
