import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effort, GradeReport, Permissions } from '@lightsout/contracts';
import type { Driver, DriverInvocation } from '@lightsout/drivers';
import { runPlanGrade } from '../index';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';

/** Write a single-file plan deliverable at <plansDir>/<name>.md. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.claude', 'plans');

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${name}.md`), body);

	return dir;
};

/** A structurally clean single plan whose paths resolve against setupConsumerRepo. */
const cleanPlan = () => `# Graded Plan

## Global Constraints

- None

## Prerequisites

- None

## Files to Create

### \`src/new-thing.ts\`

A new module exporting \`newThing\`.

## Files to Modify

### \`src/index.js\`

Re-export \`newThing\`.

## Patterns to Mirror

- \`src/index.js\` — mirror its single-export shape.

## Prior Art

- \`newThing\` — searched newThing, found none (new).

## Scope Boundaries

**Do:**
- Add \`newThing\`.

**Do NOT:**
- Touch anything else.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None — standalone plan.
`;

/**
 * A gap-check stub keyed off the gap-check marker, returning a fixed gap set.
 * `onInvoke` sees the whole invocation the driver was handed.
 */
const gapDriver = (gaps: unknown[], onInvoke?: (invocation: DriverInvocation) => void): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		onInvoke?.(invocation);

		assert.ok(invocation.prompt.includes('# Gap-check input'), 'gap-check invocation marker present');

		return { text: JSON.stringify({ gaps }), exitCode: 0 };
	},
});

test('plan grade: a clean plan with no gaps passes as grade A', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'clean', body: cleanPlan() });
	const result = await runPlanGrade({ cwd, driver: gapDriver([]), name: 'clean', plansDir });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.ok('grade' in result);
	assert.equal(result.grade.grade, 'A');
	assert.equal(result.grade.passed, true);

	const gradePath = join(cwd, '.lightsout', 'plans', 'clean', 'grade.json');

	assert.ok(existsSync(gradePath), 'grade.json written');
	assert.doesNotThrow(() => GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8'))));
});

test('plan grade: a gap-returning stub fails the plan with the gaps recorded', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'gappy', body: cleanPlan() });
	const gap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: ['throw', 'null'] };
	const result = await runPlanGrade({ cwd, driver: gapDriver([gap]), name: 'gappy', plansDir });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.ok('grade' in result);
	assert.equal(result.grade.passed, false);
	assert.equal(result.grade.grade, 'below-A');
	assert.equal(result.grade.gaps.length, 1);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(join(cwd, '.lightsout', 'plans', 'gappy', 'grade.json'), 'utf8')));

	assert.equal(recorded.gaps[0]?.area, 'omitted-decision');
});

test('plan grade: a structural defect gates independently of the gap agent', async () => {
	const cwd = setupConsumerRepo();
	// A planted TBD — the code structural re-check must fire even when the gap
	// agent reports NONE.
	const plansDir = writePlan({ cwd, name: 'planted', body: cleanPlan().replace('A new module', 'TBD — a new module') });
	const result = await runPlanGrade({ cwd, driver: gapDriver([]), name: 'planted', plansDir });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.ok('grade' in result);
	assert.ok(result.grade.structural.length > 0, 'structural finding present despite an empty gap set');
	assert.equal(result.grade.passed, false);
});

test('plan grade: the resolved model, effort and permissions reach the gap-check driver', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'threaded', body: cleanPlan() });
	const invocations: DriverInvocation[] = [];
	const driver = gapDriver([], (invocation) => invocations.push(invocation));
	const result = await runPlanGrade({
		cwd,
		driver,
		name: 'threaded',
		plansDir,
		model: 'gpt-5.2',
		effort: Effort.High,
		permissions: Permissions.FullAccess,
	});

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.deepEqual(
		invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions })),
		[{ model: 'gpt-5.2', effort: 'high', permissions: 'full-access' }],
	);
});

test('plan grade: an omitted effort and permissions stay absent so the harness default stands', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'defaulted', body: cleanPlan() });
	const invocations: DriverInvocation[] = [];
	const driver = gapDriver([], (invocation) => invocations.push(invocation));
	const result = await runPlanGrade({ cwd, driver, name: 'defaulted', plansDir });

	assert.equal(result.status, 'complete', 'error' in result ? result.error : undefined);
	assert.deepEqual(
		invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions })),
		[{ model: undefined, effort: undefined, permissions: undefined }],
	);
});
