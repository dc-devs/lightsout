import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { expectStatus } from '@tests/helpers/expectStatus';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { Effort, GradeReport, Permissions } from '@/contracts';
import type { Driver, DriverInvocation } from '@/drivers';
import { runPlanGrade } from '@/plan';

/** Write a single-file plan deliverable at `.lightsout/plans/<name>/plan.md`. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'plan.md'), body);
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
	writePlan({ cwd, name: 'clean', body: cleanPlan() });
	const result = await runPlanGrade({ cwd, driver: gapDriver([]), name: 'clean' });

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
	writePlan({ cwd, name: 'gappy', body: cleanPlan() });
	const gap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: ['throw', 'null'] };
	const result = await runPlanGrade({ cwd, driver: gapDriver([gap]), name: 'gappy' });

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
	writePlan({ cwd, name: 'planted', body: cleanPlan().replace('A new module', 'TBD — a new module') });
	const result = await runPlanGrade({ cwd, driver: gapDriver([]), name: 'planted' });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	// structural finding present despite an empty gap set
	expect(result.grade.structural.length > 0).toBeTruthy();
	expect(result.grade.passed).toBe(false);
});

/** The one line only the overview carries, so a prompt can be told apart from the phases it fronts. */
const overviewMarker = 'Phase 2 follows phase 1.';

/** A structurally clean overview — the overview variant's own required section set. */
const cleanOverview = () => `# Graded Plan — Overview

## Global Constraints

- None

## Phases

| # | File | Scope |
|---|------|-------|
| 1 | \`phase1-core.md\` | the core |
| 2 | \`phase2-extra.md\` | the rest |

## Cross-Phase Dependencies

- ${overviewMarker}
`;

/** The clean plan again, creating a different file — so each phase's gap-check prompt is identifiable. */
const secondPhasePlan = () =>
	cleanPlan()
		.replace(/new-thing/g, 'other-thing')
		.replace(/newThing/g, 'otherThing');

/** Write a phased deliverable — an overview plus its phase files — into `.lightsout/plans/<name>/`. */
const writePhasedPlan = ({ cwd, name, files }: { cwd: string; name: string; files: Record<string, string> }) => {
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });

	for (const [fileName, body] of Object.entries(files)) {
		writeFileSync(join(dir, fileName), body);
	}
};

test('plan grade: a phased plan gap-checks each phase in turn, with the overview as context rather than as a graded file', async () => {
	const cwd = setupConsumerRepo();
	writePhasedPlan({
		cwd,
		name: 'phased',
		files: { 'overview.md': cleanOverview(), 'phase1-core.md': cleanPlan(), 'phase2-extra.md': secondPhasePlan() },
	});
	const invocations: DriverInvocation[] = [];
	const result = await runPlanGrade({ cwd, driver: gapDriver([], (invocation) => invocations.push(invocation)), name: 'phased' });

	expectStatus(result, 'complete');
	// one gap-check per phase, in the folder's sorted order — the overview is never
	// checked standalone
	expect(invocations.map(({ prompt }) => (prompt.includes('src/other-thing.ts') ? 'phase2-extra.md' : 'phase1-core.md'))).toStrictEqual([
		'phase1-core.md',
		'phase2-extra.md',
	]);
	// the overview rides every system prompt as context, got: ${invocations.length} invocation(s)
	expect(invocations.every(({ systemPrompt }) => (systemPrompt ?? '').includes(overviewMarker))).toBeTruthy();
	// and never appears as the text under check
	expect(invocations.some(({ prompt }) => prompt.includes(overviewMarker))).toBeFalsy();
});

test('plan grade: a phased plan writes one verdict into the plan folder, covering the overview and every phase', async () => {
	const cwd = setupConsumerRepo();
	writePhasedPlan({
		cwd,
		name: 'phased-verdict',
		files: { 'overview.md': cleanOverview(), 'phase1-core.md': cleanPlan(), 'phase2-extra.md': secondPhasePlan() },
	});
	const result = await runPlanGrade({ cwd, driver: gapDriver([]), name: 'phased-verdict' });

	expectStatus(result, 'complete');
	expect('gradePath' in result).toBeTruthy();
	// the verdict lands beside the plan text it graded — one folder per plan
	expect(result.gradePath).toBe(join(cwd, '.lightsout', 'plans', 'phased-verdict', 'grade.json'));

	const recorded = GradeReport.parse(JSON.parse(readFileSync(result.gradePath, 'utf8')));

	// a clean phased deliverable grades A, the overview linted alongside its phases
	expect(recorded.grade).toBe('A');
	expect(recorded.structural).toStrictEqual([]);
});

test('plan grade: the resolved model, effort and permissions reach the gap-check driver', async () => {
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'threaded', body: cleanPlan() });
	const invocations: DriverInvocation[] = [];
	const driver = gapDriver([], (invocation) => invocations.push(invocation));
	const result = await runPlanGrade({
		cwd,
		driver,
		name: 'threaded',
		model: 'gpt-5.2',
		effort: Effort.High,
		permissions: Permissions.FullAccess,
	});

	expectStatus(result, 'complete');
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([
		{ model: 'gpt-5.2', effort: 'high', permissions: 'full-access' },
	]);
});

test('plan grade: an omitted effort and permissions stay absent so the harness default stands', async () => {
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'defaulted', body: cleanPlan() });
	const invocations: DriverInvocation[] = [];
	const driver = gapDriver([], (invocation) => invocations.push(invocation));
	const result = await runPlanGrade({ cwd, driver, name: 'defaulted' });

	expectStatus(result, 'complete');
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([
		{ model: undefined, effort: undefined, permissions: undefined },
	]);
});

test('plan grade: no deliverable on disk fails before any agent is spawned', async () => {
	const cwd = setupConsumerRepo();
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('the gap-check must not be invoked when the plan cannot be resolved');
		},
	};
	const result = await runPlanGrade({ cwd, driver: failIfCalled, name: 'ghost' });

	expectStatus(result, 'failed');
	// the resolve error propagates, got: ${result.error}
	expect('error' in result && /no plan found for 'ghost'/.test(result.error ?? '')).toBeTruthy();
});

test('plan grade: a rate-limited gap-check parks the run and writes no verdict', async () => {
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'parked', body: cleanPlan() });
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: '', exitCode: 1, rateLimited: true };
		},
	};
	const result = await runPlanGrade({ cwd, driver, name: 'parked' });

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
	writePlan({ cwd, name: 'malformed', body: cleanPlan() });
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: 'the plan looks fine to me', exitCode: 0 };
		},
	};
	const result = await runPlanGrade({ cwd, driver, name: 'malformed' });

	expectStatus(result, 'failed');
	// the rejected report bought exactly one re-emit retry
	expect(calls).toBe(2);
	// the failure names the plan file it was checking, got: ${result.error}
	expect('error' in result && (result.error ?? '').includes('gap-check failed for plan.md')).toBeTruthy();
	// no verdict is written for a failed gap-check
	expect(existsSync(join(cwd, '.lightsout', 'plans', 'malformed', 'grade.json'))).toBeFalsy();
});

test('plan grade: a planned symbol still colliding with an existing export is narrated, never gated', async () => {
	const cwd = setupConsumerRepo();

	// The plan creates `src/new-thing.ts`; an existing `thingNew` export is its
	// word-order twin — the same tier-0 name key, and not a mere casing pair —
	// so the detector still sees prior art.
	writeFileSync(join(cwd, 'src', 'thingNew.ts'), 'export const thingNew = 1;\n');

	writePlan({ cwd, name: 'colliding', body: cleanPlan() });
	const messages: string[] = [];
	const result = await runPlanGrade({ cwd, driver: gapDriver([]), name: 'colliding', onProgress: (message) => messages.push(message) });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	// a raw name collision is advisory — the Dedup Review phase enforces, not
	// grade
	expect(result.grade.grade).toBe('A');
	// the advisory points at the dedup command, got: ${messages.join(' | ')}
	expect(messages.some((message) => message.includes('lightsout plan dedup --name colliding'))).toBeTruthy();
});
