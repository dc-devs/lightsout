import { expect, test } from '@jest/globals';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effort, GradeReport, Permissions } from '@/contracts';
import type { Driver, DriverInvocation } from '@/drivers';
import { runPlanGrade } from '@/plan';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { expectStatus } from '@tests/helpers/expectStatus';

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

		// gap-check invocation marker present
		expect(invocation.prompt.includes('# Gap-check input')).toBeTruthy();

		return { text: JSON.stringify({ gaps }), exitCode: 0 };
	},
});

test('plan grade: a clean plan with no gaps passes as grade A', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'clean', body: cleanPlan() });
	const result = await runPlanGrade({ cwd, driver: gapDriver([]), name: 'clean', plansDir });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	expect(result.grade.grade).toBe('A');
	expect(result.grade.passed).toBe(true);

	const gradePath = join(cwd, '.lightsout', 'plans', 'clean', 'grade.json');

	// grade.json written
	expect(existsSync(gradePath)).toBeTruthy();
	expect(() => GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')))).not.toThrow();
});

test('plan grade: a gap-returning stub fails the plan with the gaps recorded', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'gappy', body: cleanPlan() });
	const gap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: ['throw', 'null'] };
	const result = await runPlanGrade({ cwd, driver: gapDriver([gap]), name: 'gappy', plansDir });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	expect(result.grade.passed).toBe(false);
	expect(result.grade.grade).toBe('below-A');
	expect(result.grade.gaps.length).toBe(1);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(join(cwd, '.lightsout', 'plans', 'gappy', 'grade.json'), 'utf8')));

	expect(recorded.gaps[0]?.area).toBe('omitted-decision');
});

test('plan grade: a structural defect gates independently of the gap agent', async () => {
	const cwd = setupConsumerRepo();
	// A planted TBD — the code structural re-check must fire even when the gap
	// agent reports NONE.
	const plansDir = writePlan({ cwd, name: 'planted', body: cleanPlan().replace('A new module', 'TBD — a new module') });
	const result = await runPlanGrade({ cwd, driver: gapDriver([]), name: 'planted', plansDir });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	// structural finding present despite an empty gap set
	expect(result.grade.structural.length > 0).toBeTruthy();
	expect(result.grade.passed).toBe(false);
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

	expectStatus(result, 'complete');
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([{ model: 'gpt-5.2', effort: 'high', permissions: 'full-access' }]);
});

test('plan grade: an omitted effort and permissions stay absent so the harness default stands', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'defaulted', body: cleanPlan() });
	const invocations: DriverInvocation[] = [];
	const driver = gapDriver([], (invocation) => invocations.push(invocation));
	const result = await runPlanGrade({ cwd, driver, name: 'defaulted', plansDir });

	expectStatus(result, 'complete');
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([{ model: undefined, effort: undefined, permissions: undefined }]);
});

test('plan grade: no deliverable on disk fails before any agent is spawned', async () => {
	const cwd = setupConsumerRepo();
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('the gap-check must not be invoked when the plan cannot be resolved');
		},
	};
	const result = await runPlanGrade({ cwd, driver: failIfCalled, name: 'ghost', plansDir: join(cwd, '.claude', 'plans') });

	expectStatus(result, 'failed');
	// the resolve error propagates, got: ${result.error}
	expect('error' in result && /no plan found for 'ghost'/.test(result.error ?? '')).toBeTruthy();
});

test('plan grade: a rate-limited gap-check parks the run and writes no verdict', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'parked', body: cleanPlan() });
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: '', exitCode: 1, rateLimited: true };
		},
	};
	const result = await runPlanGrade({ cwd, driver, name: 'parked', plansDir });

	expectStatus(result, 'paused-rate-limit');
	// a rate limit buys no re-emit retry
	expect(calls).toBe(1);
	// the error carries the re-run command, got: ${result.error}
	expect('error' in result && (result.error ?? '').includes('lightsout plan grade --name parked')).toBeTruthy();
	// a parked run leaves no verdict behind
	expect(existsSync(join(cwd, '.lightsout', 'plans', 'parked', 'grade.json'))).toBeFalsy();
});

test('plan grade: a gap-check that never satisfies the contract fails, naming the plan file', async () => {
	const cwd = setupConsumerRepo();
	const plansDir = writePlan({ cwd, name: 'malformed', body: cleanPlan() });
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: 'the plan looks fine to me', exitCode: 0 };
		},
	};
	const result = await runPlanGrade({ cwd, driver, name: 'malformed', plansDir });

	expectStatus(result, 'failed');
	// the rejected report bought exactly one re-emit retry
	expect(calls).toBe(2);
	// the failure names the plan file it was checking, got: ${result.error}
	expect('error' in result && (result.error ?? '').includes('malformed.md')).toBeTruthy();
	// no verdict is written for a failed gap-check
	expect(existsSync(join(cwd, '.lightsout', 'plans', 'malformed', 'grade.json'))).toBeFalsy();
});

test('plan grade: a planned symbol still colliding with an existing export is narrated, never gated', async () => {
	const cwd = setupConsumerRepo();

	// The plan creates `src/new-thing.ts`; an existing `thingNew` export is its
	// word-order twin — the same tier-0 name key, and not a mere casing pair —
	// so the detector still sees prior art.
	writeFileSync(join(cwd, 'src', 'thingNew.ts'), 'export const thingNew = 1;\n');

	const plansDir = writePlan({ cwd, name: 'colliding', body: cleanPlan() });
	const messages: string[] = [];
	const result = await runPlanGrade({ cwd, driver: gapDriver([]), name: 'colliding', plansDir, onProgress: (message) => messages.push(message) });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	// a raw name collision is advisory — the Dedup Review phase enforces, not
	// grade
	expect(result.grade.grade).toBe('A');
	// the advisory points at the dedup command, got: ${messages.join(' | ')}
	expect(messages.some((message) => message.includes('lightsout plan dedup --name colliding'))).toBeTruthy();
});
