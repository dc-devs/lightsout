import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { Effort, GapCheckLens, GradeReport, Permissions } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { advisoryPlanBody, plantAdvisoryTouchedFiles } from '#tests/helpers/advisoryPlan.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

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

/** The lens brief a checker's system prompt was built with — how a spawn is told apart from its two siblings. */
const lensOf = ({ systemPrompt }: DriverInvocation) => Object.values(GapCheckLens).find((lens) => (systemPrompt ?? '').includes(`# Your brief: ${lens}`));

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
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'gappy', body: cleanPlan() });
	const gap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: ['throw', 'null'] };
	const result = await runPlanGrade({ cwd, driver: gapDriver([gap]), name: 'gappy' });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	expect(result.grade.passed).toBe(false);
	expect(result.grade.grade).toBe('below-A');
	// one gap per lens: three checkers read the same plan, and every one of them
	// reported it
	expect(result.grade.gaps.length).toBe(3);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(join(cwd, '.lightsout', 'plans', 'gappy', 'grade.json'), 'utf8')));

	expect(recorded.gaps[0]?.area).toBe('omitted-decision');
});

test('plan grade: every lens that finds the same gap contributes it, and the engine stamps each with the phase and lens that found it', async () => {
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'union', body: cleanPlan() });
	const gap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: [] };
	const result = await runPlanGrade({ cwd, driver: gapDriver([gap]), name: 'union' });

	expectStatus(result, 'complete');
	// the union, not a vote: three lenses agreeing reads as three labelled gaps
	// rather than as one, because merging them needs a similarity judgment the
	// engine is not allowed to make silently
	expect(result.grade.gaps.map(({ phase, lens }) => `${phase}/${lens}`)).toStrictEqual(['plan.md/surface', 'plan.md/wiring', 'plan.md/decisions']);
});

test('plan grade: an advisory structural finding is persisted with the rest but never decides the verdict', async () => {
	const cwd = setupConsumerRepo();

	plantAdvisoryTouchedFiles({ cwd });
	writePlan({ cwd, name: 'noted', body: advisoryPlanBody({ title: 'Graded Plan' }) });

	const result = await runPlanGrade({ cwd, driver: gapDriver([]), name: 'noted' });

	expectStatus(result, 'complete');
	expect('grade' in result).toBeTruthy();
	// a mostly-mechanical plan is legal work: the note belongs in grade.json, and
	// nowhere near the verdict
	expect(result.grade.grade).toBe('A');
	expect(result.grade.passed).toBe(true);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(join(cwd, '.lightsout', 'plans', 'noted', 'grade.json'), 'utf8')));

	expect(recorded.structural.map(({ check, severity }) => ({ check, severity }))).toStrictEqual([{ check: 'scope-within-guardrail', severity: 'advisory' }]);
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

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
| 1 | \`phase1-core.md\` | the core | 1 | 1 |
| 2 | \`phase2-extra.md\` | the rest | 1 | 1 |

## Phase Declarations

### Phase 1 — \`phase1-core.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none

### Phase 2 — \`phase2-extra.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none

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

test('plan grade: a phased plan fans three differently-briefed checkers out over every phase, with the overview as context rather than as a graded file', async () => {
	const cwd = setupConsumerRepo();
	writePhasedPlan({
		cwd,
		name: 'phased',
		files: { 'overview.md': cleanOverview(), 'phase1-core.md': cleanPlan(), 'phase2-extra.md': secondPhasePlan() },
	});
	const invocations: DriverInvocation[] = [];
	const result = await runPlanGrade({ cwd, driver: gapDriver([], (invocation) => invocations.push(invocation)), name: 'phased' });

	expectStatus(result, 'complete');

	const phaseOf = ({ prompt }: DriverInvocation) => (prompt.includes('src/other-thing.ts') ? 'phase2-extra.md' : 'phase1-core.md');
	const spawned = invocations.map((invocation) => `${phaseOf(invocation)}/${lensOf(invocation)}`);

	// every phase times every lens, and the overview is never checked standalone
	expect(spawned.sort()).toStrictEqual([
		'phase1-core.md/decisions',
		'phase1-core.md/surface',
		'phase1-core.md/wiring',
		'phase2-extra.md/decisions',
		'phase2-extra.md/surface',
		'phase2-extra.md/wiring',
	]);
	// the overview rides every system prompt as context, got: ${invocations.length} invocation(s)
	expect(invocations.every(({ systemPrompt }) => (systemPrompt ?? '').includes(overviewMarker))).toBeTruthy();
	// and never appears as the text under check
	expect(invocations.some(({ prompt }) => prompt.includes(overviewMarker))).toBeFalsy();
	// the record states what it can speak for: both phases, all three lenses
	expect(result.grade.phasesChecked).toStrictEqual(['phase1-core.md', 'phase2-extra.md']);
	expect(result.grade.lenses).toStrictEqual(['surface', 'wiring', 'decisions']);
	expect(result.grade.complete).toBe(true);
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

test('plan grade: --phase narrows the gap-check to the named phases and records that the pass is a subset', async () => {
	const cwd = setupConsumerRepo();
	writePhasedPlan({
		cwd,
		name: 'narrowed',
		files: { 'overview.md': cleanOverview(), 'phase1-core.md': cleanPlan(), 'phase2-extra.md': secondPhasePlan() },
	});
	const invocations: DriverInvocation[] = [];
	const result = await runPlanGrade({ cwd, driver: gapDriver([], (invocation) => invocations.push(invocation)), name: 'narrowed', phases: ['2'] });

	expectStatus(result, 'complete');
	// three checkers, all on the requested phase
	expect(invocations.length).toBe(3);
	expect(invocations.every(({ prompt }) => prompt.includes('src/other-thing.ts'))).toBeTruthy();
	// the record says on its face that it is not a full grade
	expect(result.grade.phasesChecked).toStrictEqual(['phase2-extra.md']);
	expect(result.grade.complete).toBe(false);
	expect(result.grade.passed).toBe(false);
	expect(result.grade.incompleteReason ?? '').toMatch(/graded a subset on request: 2/);
	// the deterministic half still covers the whole plan — the lint is cross-phase,
	// so narrowing it would manufacture findings about the phases withheld
	expect(result.grade.structural).toStrictEqual([]);
});

test("plan grade: --phase accepts a full basename, and a request typed out of order still grades in the deliverable's own order", async () => {
	const cwd = setupConsumerRepo();
	writePhasedPlan({
		cwd,
		name: 'by-name',
		files: { 'overview.md': cleanOverview(), 'phase1-core.md': cleanPlan(), 'phase2-extra.md': secondPhasePlan() },
	});
	const invocations: DriverInvocation[] = [];
	const result = await runPlanGrade({
		cwd,
		driver: gapDriver([], (invocation) => invocations.push(invocation)),
		name: 'by-name',
		phases: ['phase2-extra.md', 'phase1-core.md'],
	});

	expectStatus(result, 'complete');
	// the basename is the one spelling accepted beside the bare index — it is what
	// every finding and the coverage list already print
	expect(invocations.length).toBe(6);
	// and the coverage reads as one ordered pass over the plan rather than as the
	// order a human happened to type
	expect(result.grade.phasesChecked).toStrictEqual(['phase1-core.md', 'phase2-extra.md']);
	// naming every phase is still a narrowing on its face: a subset request is
	// never upgraded to a full grade just because it happened to cover everything
	expect(result.grade.complete).toBe(false);
	expect(result.grade.incompleteReason ?? '').toMatch(/graded a subset on request: phase2-extra\.md, phase1-core\.md/);
});

test('plan grade: a --phase value matching no plan file fails outright rather than grading nothing', async () => {
	const cwd = setupConsumerRepo();
	writePhasedPlan({
		cwd,
		name: 'typo',
		files: { 'overview.md': cleanOverview(), 'phase1-core.md': cleanPlan(), 'phase2-extra.md': secondPhasePlan() },
	});
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('a typo must never reach the harness');
		},
	};
	const result = await runPlanGrade({ cwd, driver: failIfCalled, name: 'typo', phases: ['phase2-extra'] });

	expectStatus(result, 'failed');
	// the failure lists what was available, and nothing is written
	expect('error' in result && (result.error ?? '')).toMatch(/--phase phase2-extra matches 0 plan file\(s\) — available: phase1-core\.md, phase2-extra\.md/);
	expect(existsSync(join(cwd, '.lightsout', 'plans', 'typo', 'grade.json'))).toBeFalsy();
});

test('plan grade: --phase 1 selects phase1 numerically, never also a phase10 sharing its prefix', async () => {
	const cwd = setupConsumerRepo();
	writePhasedPlan({
		cwd,
		name: 'ten',
		files: { 'overview.md': cleanOverview(), 'phase1-core.md': cleanPlan(), 'phase10-extra.md': secondPhasePlan() },
	});
	const invocations: DriverInvocation[] = [];
	const result = await runPlanGrade({ cwd, driver: gapDriver([], (invocation) => invocations.push(invocation)), name: 'ten', phases: ['1'] });

	expectStatus(result, 'complete');
	expect(result.grade.phasesChecked).toStrictEqual(['phase1-core.md']);
	// a string-prefix match would have taken phase10 too
	expect(invocations.some(({ prompt }) => prompt.includes('src/other-thing.ts'))).toBeFalsy();
});

test('plan grade: a --phase request that names nothing at all is refused rather than silently widened', async () => {
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'empty-request', body: cleanPlan() });
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('an empty request must never grade the whole plan');
		},
	};
	const result = await runPlanGrade({ cwd, driver: failIfCalled, name: 'empty-request', phases: [] });

	expectStatus(result, 'failed');
	expect('error' in result && (result.error ?? '')).toMatch(/--phase named no phase file — available: plan\.md/);
});

test('plan grade: a phase whose one lens failed is not claimed as checked, though its other lenses keep their gaps', async () => {
	const cwd = setupConsumerRepo();
	writePhasedPlan({
		cwd,
		name: 'partial',
		files: { 'overview.md': cleanOverview(), 'phase1-core.md': cleanPlan(), 'phase2-extra.md': secondPhasePlan() },
	});
	const gap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: [] };
	// Only phase 1's wiring checker fails; every other checker returns the gap.
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			const failing = lensOf(invocation) === 'wiring' && !invocation.prompt.includes('src/other-thing.ts');

			return failing ? { text: 'looks fine to me', exitCode: 0 } : { text: JSON.stringify({ gaps: [gap] }), exitCode: 0 };
		},
	};
	const result = await runPlanGrade({ cwd, driver, name: 'partial' });

	expectStatus(result, 'failed');

	const recorded = GradeReport.parse(JSON.parse(readFileSync(join(cwd, '.lightsout', 'plans', 'partial', 'grade.json'), 'utf8')));

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
	// every checker in the fan-out is spawned with the same resolved settings
	expect(invocations.map(({ model, effort, permissions }) => ({ model, effort, permissions }))).toStrictEqual([
		{ model: 'gpt-5.2', effort: 'high', permissions: 'full-access' },
		{ model: 'gpt-5.2', effort: 'high', permissions: 'full-access' },
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
		{ model: undefined, effort: undefined, permissions: undefined },
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

test('plan grade: a failed resolve still hands back a plan workspace that exists on disk', async () => {
	const cwd = setupConsumerRepo();
	const failIfCalled: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('the gap-check must not be invoked when the plan cannot be resolved');
		},
	};

	const result = await runPlanGrade({ cwd, driver: failIfCalled, name: 'ghost-workspace' });

	expectStatus(result, 'failed');
	// the workspace is created before the deliverable is resolved, so a failure
	// names a folder a human can really go and look in
	expect(result.workspaceDir).toBe(join(cwd, '.lightsout', 'plans', 'ghost-workspace'));
	expect(existsSync(result.workspaceDir)).toBe(true);
});

test('plan grade: a rate-limited gap-check parks the run and writes an incomplete verdict rather than discarding the pass', async () => {
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
	// a rate limit buys no re-emit retry, one call per lens
	expect(calls).toBe(3);
	// the error carries the re-run command, got: ${result.error}
	expect('error' in result && (result.error ?? '').includes('lightsout plan grade --name parked')).toBeTruthy();

	const gradePath = join(cwd, '.lightsout', 'plans', 'parked', 'grade.json');

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

/** Five phase files — fifteen checkers against a twelve-slot ceiling, so the tail cannot all start at once. */
const fivePhaseFiles = () => ({
	'overview.md': cleanOverview(),
	'phase1-core.md': cleanPlan(),
	'phase2-extra.md': secondPhasePlan(),
	'phase3-more.md': cleanPlan(),
	'phase4-yet.md': cleanPlan(),
	'phase5-last.md': cleanPlan(),
});

test('plan grade: a rate-limited checker stops new checkers launching, and the phases never started are absent rather than reported clean', async () => {
	const cwd = setupConsumerRepo();
	writePhasedPlan({ cwd, name: 'walled', files: fivePhaseFiles() });
	let calls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			calls += 1;

			return { text: '', exitCode: 1, rateLimited: true };
		},
	};
	const result = await runPlanGrade({ cwd, driver, name: 'walled' });

	expectStatus(result, 'paused-rate-limit');
	// fifteen checkers were queued and the twelve that filled the slots ran: a
	// five-hour budget wall does not clear in two minutes, so meeting it by
	// launching the last three spawns into it only spends the re-run's budget
	expect(calls).toBe(12);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(join(cwd, '.lightsout', 'plans', 'walled', 'grade.json'), 'utf8')));

	// nothing finished all three lenses, so nothing is claimed
	expect(recorded.phasesChecked).toStrictEqual([]);
	expect(recorded.complete).toBe(false);
	// the phase whose checkers never started is named nowhere — not as a failure,
	// and above all not as checked and clean
	expect(recorded.incompleteReason ?? '').not.toMatch(/phase5-last\.md/);
	expect(recorded.incompleteReason ?? '').toMatch(/phase1-core\.md\/surface: rate limited or overloaded/);
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
	// each of the three checkers bought exactly one re-emit retry
	expect(calls).toBe(6);
	// the failure names the plan file and the lens it was checking with, got: ${result.error}
	expect('error' in result && (result.error ?? '').includes('gap-check failed for plan.md/surface')).toBeTruthy();

	const gradePath = join(cwd, '.lightsout', 'plans', 'malformed', 'grade.json');

	// a verdict IS written — marked incomplete, so the failure cannot read as a
	// plan with nothing wrong
	expect(existsSync(gradePath)).toBeTruthy();

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	expect(recorded.complete).toBe(false);
	expect(recorded.phasesChecked).toStrictEqual([]);
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
	// the run also narrates what it gap-checked and the verdict it reached, so a
	// clean pass is legible without opening grade.json
	expect(messages).toEqual(
		expect.arrayContaining([
			expect.stringMatching(/0 structural finding\(s\), gap-checking 1 of 1 plan file\(s\) × 3 lens\(es\)/),
			expect.stringMatching(/A \(0 structural, 0 gap\(s\)\)/),
		]),
	);
});

test('plan grade: an explicit timeoutMs reaches the gap-check driver', async () => {
	const cwd = setupConsumerRepo();
	writePlan({ cwd, name: 'bounded', body: cleanPlan() });
	const invocations: DriverInvocation[] = [];
	const driver = gapDriver([], (invocation) => invocations.push(invocation));
	const result = await runPlanGrade({ cwd, driver, name: 'bounded', timeoutMs: 90_000 });

	expectStatus(result, 'complete');
	// the caller's ceiling is what kills a hung gap-check, not this role's own
	expect(invocations.map(({ timeoutMs }) => timeoutMs)).toStrictEqual([90_000, 90_000, 90_000]);
});
