import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { planGradeCommand } from '#src/cli/plan/index.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { Effort, GapArea, Permissions } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

/** The command's own output, with the progress printer's timestamped narration dropped. */
const printedLines = ({ logged }: { logged: string[] }) => logged.filter((line) => !/^\[\+\d+:\d\d\]/.test(line));

/** The ruling the shared stub's judges return, so the decision the command prints is the judge's own. */
const judgedDecision = 'what the plan should do here';

// A real consumer repo with a real committed deliverable: the structural half of
// the grade is the deterministic lint, and only the gap half is stubbed.
const setupGrade = ({ body, gaps = [], verdict, git = false }: { body?: string; gaps?: unknown[]; verdict?: unknown; git?: boolean } = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git });

	if (body !== undefined) {
		writePlanDeliverable({ cwd, name: 'demo', body });
	}

	return { cwd, name: 'demo', driver: createGapCheckDriver({ gaps, verdict }), ...captured };
};

// The harness settings a config carries reach the agent call through the shared
// option bundle, so the arrangement records what the harness was handed rather
// than what it printed.
const setupHarnessSettings = ({ config }: { config?: LightsoutConfig } = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });
	const invocations: DriverInvocation[] = [];

	writePlanDeliverable({ cwd, name: 'demo', body: cleanPlanBody() });

	return { cwd, name: 'demo', config, driver: createGapCheckDriver({ invocations }), invocations, ...captured };
};

/** A structurally clean overview — the overview variant's own required section set, fronting the two phases below. */
const cleanOverview = () => `# Demo — Overview

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

- Phase 2 follows phase 1.
`;

// A phased deliverable — an overview plus two clean phase files — so the gaps
// the fan-out stamps carry two different plan files to group under.
const setupPhasedGrade = ({ gaps }: { gaps: unknown[] }) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });
	const dir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'overview.md'), cleanOverview());
	writeFileSync(join(dir, 'phase1-core.md'), cleanPlanBody({ title: 'Phase 1' }));
	writeFileSync(
		join(dir, 'phase2-extra.md'),
		cleanPlanBody({ title: 'Phase 2' })
			.replace(/new-thing/g, 'other-thing')
			.replace(/newThing/g, 'otherThing'),
	);

	return { cwd, name: 'demo', driver: createGapCheckDriver({ gaps }), ...captured };
};

test('planGradeCommand: a clean plan with no gaps grades A, reports both counts and the grade path, and exits 0', async () => {
	const { cwd, driver, name, logged, errors, exitCodes } = setupGrade({ body: cleanPlanBody() });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — A \(graded \d{4}-\d\d-\d\dT/);
	expect(printed[1]).toBe('  structural: 0 · gaps: 0 (0 blocking, 0 unjudged)');
	// the coverage statement says which files it can speak for, and with how many
	// briefs — `N phase file(s)`, never `all plan files`
	expect(printed[2]).toBe('  checked: 1 phase file(s) × 3 lens(es): plan.md');
	expect(printed[3]).toBe(`\ngrade: ${join(cwd, '.lightsout', 'plans', 'demo', 'grade.json')}`);
	// an A grade prints no finding lines, got: ${JSON.stringify(printed)}
	expect(printed.length).toBe(4);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: a grade taken outside a git worktree says so rather than leaving the verdict undated in code', async () => {
	const { cwd, driver, name, logged, exitCodes } = setupGrade({ body: cleanPlanBody() });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	// gradedAt alone cannot tell a stale verdict from a current one
	expect(printedLines({ logged })[0] ?? '').toMatch(/^\nplan grade demo — A \(graded \S+, outside a git worktree\)$/);
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: a grade taken on a committed tree carries the short commit it was measured against', async () => {
	const { cwd, driver, name, logged, exitCodes } = setupGrade({ body: cleanPlanBody(), git: true });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	// twelve characters is the short sha a human compares against `git log`; the
	// full sha stays in grade.json
	expect(printedLines({ logged })[0] ?? '').toMatch(/^\nplan grade demo — A \(graded \S+, at [0-9a-f]{12}\)$/);
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: uncommitted work at grade time is said out loud, so the sha reads as a floor', async () => {
	const { cwd, driver, name, logged, exitCodes } = setupGrade({ body: cleanPlanBody(), git: true });

	// grading while the author has uncommitted work is the normal case, not an
	// edge one — which is why the commit is still recorded rather than withheld
	writeFileSync(join(cwd, 'src', 'scratch.js'), 'export const two = 2;\n');

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	expect(printedLines({ logged })[0] ?? '').toMatch(/^\nplan grade demo — A \(graded \S+, at [0-9a-f]{12} plus uncommitted changes\)$/);
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: a gap drops the grade below A and prints the decision with the options to choose among', async () => {
	const gaps = [{ area: GapArea.OmittedDecision, gap: 'no storage choice', decision: 'pick a store', options: ['sqlite', 'postgres'] }];
	const { cwd, driver, name, logged, exitCodes } = setupGrade({ body: cleanPlanBody(), gaps });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — below-A \(graded \d{4}-\d\d-\d\dT/);
	// the stub answers every lens, so one planted gap comes back three times — the
	// union, each copy labelled with the brief that found it, and every copy judged
	expect(printed[1]).toBe('  structural: 0 · gaps: 3 (3 blocking, 0 unjudged)');
	expect(printed[2]).toBe('  checked: 1 phase file(s) × 3 lens(es): plan.md');
	// gaps print grouped under the plan file they were found in
	expect(printed[3]).toBe('plan.md');
	expect(printed[4]).toBe('? [omitted-decision] no storage choice (surface)');
	// the decision printed is the judge's, and the options are the reader's
	expect(printed[5]).toBe(`   decide: ${judgedDecision} — options: sqlite / postgres`);
	expect(printed[6]).toBe('? [omitted-decision] no storage choice (wiring)');
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: findings the judges cleared are counted but never printed, and the plan still grades A', async () => {
	const gaps = [{ area: GapArea.OmittedDecision, gap: 'no storage choice', decision: 'pick a store', options: ['sqlite', 'postgres'] }];
	const { cwd, driver, name, logged, exitCodes } = setupGrade({
		body: cleanPlanBody(),
		gaps,
		verdict: { outcome: 'agent-can-decide', agentDecision: 'use sqlite', safeBecause: 'every sibling in this repo already does' },
	});

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — A \(graded \d{4}-\d\d-\d\dT/);
	// the counts state what the pass found; the verdict states what a human has to answer
	expect(printed[1]).toBe('  structural: 0 · gaps: 3 (0 blocking, 0 unjudged)');
	expect(printed[2]).toBe('  checked: 1 phase file(s) × 3 lens(es): plan.md');
	// not being interrupted by findings nobody needs to act on is the point — the
	// full record is in grade.json, got: ${JSON.stringify(printed)}
	expect(printed.length).toBe(4);
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: findings nobody weighed are counted apart from the ones a human must settle, and say so when printed', async () => {
	const gaps = [{ area: GapArea.OmittedDecision, gap: 'no storage choice', decision: 'pick a store', options: [] }];
	const { cwd, driver, name, logged, exitCodes } = setupGrade({ body: cleanPlanBody(), gaps, verdict: { outcome: 'already-answered' } });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — below-A /);
	// a spike in judge failures must not read as a plan getting worse
	expect(printed[1]).toBe('  structural: 0 · gaps: 3 (3 blocking, 3 unjudged)');
	expect(printed[3]).toBe('plan.md');
	expect(printed[4]).toBe('? [omitted-decision] no storage choice (surface)');
	// a dismissal with no citation is a rubber stamp, and the line says the finding
	// blocks because nobody weighed it rather than because the plan is thin
	expect(printed[5]).toBe('   unjudged, so it blocks: the judge answered already-answered without the evidence that outcome demands');
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: a structurally dirty plan prints the lint finding, and an optionless gap prints the decision alone', async () => {
	const gaps = [{ area: GapArea.InsufficientDetail, gap: 'no error handling named', decision: 'say what a failure does', options: [] }];
	const { cwd, driver, name, logged, exitCodes } = setupGrade({
		body: cleanPlanBody().replace('A new module exporting', 'TBD — a new module exporting'),
		gaps,
	});

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — below-A /);
	expect(printed[1]).toBe('  structural: 1 · gaps: 3 (3 blocking, 0 unjudged)');
	expect(printed[2]).toBe('  checked: 1 phase file(s) × 3 lens(es): plan.md');
	expect(printed[3] ?? '').toMatch(/^⚠ plan\.md \[no-placeholders\] plan\.md:\d+ — unresolved placeholder 'TBD' present$/);
	expect(printed[4] ?? '').toMatch(/^ {3}fix: resolve 'TBD'/);
	expect(printed[5]).toBe('plan.md');
	expect(printed[6]).toBe('? [insufficient-detail] no error handling named (surface)');
	// an optionless gap prints the decision alone
	expect(printed[7]).toBe(`   decide: ${judgedDecision}`);
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: a narrowed pass says so above the verdict and exits 1, because a subset is not a pass', async () => {
	const { cwd, driver, name, logged, exitCodes } = setupGrade({ body: cleanPlanBody() });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined, phases: ['plan.md'] })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nincomplete grade — graded a subset on request: plan\.md/);
	expect(printed[1] ?? '').toMatch(/^\nplan grade demo — below-A /);
	// a script must be able to tell a partial pass from a clean one
	expect(exitCodes).toStrictEqual([1]);
});

test('planGradeCommand: a rate-limited checker prints the error AND the partial report it left on disk', async () => {
	const { cwd, name, logged, errors, exitCodes } = setupGrade({ body: cleanPlanBody() });
	const rateLimited: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 1, rateLimited: true }) };

	await expect(planGradeCommand({ cwd, driver: rateLimited, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(errors[0] ?? '').toMatch(/rate limited or overloaded — re-run: lightsout plan grade --name demo$/);
	// the persisted partial pass is worth reading, so the command prints it rather
	// than exiting on the error alone
	expect(printed[0] ?? '').toMatch(/^\nincomplete grade — plan\.md\/surface: rate limited or overloaded/);
	expect(printed).toContain('  checked: 0 phase file(s) × 3 lens(es)');
	expect(exitCodes).toStrictEqual([1]);
});

test('planGradeCommand: an unresolvable deliverable reports the error on stderr and exits 1', async () => {
	const { cwd, driver, name, logged, errors, exitCodes } = setupGrade();

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	expect(printedLines({ logged })).toStrictEqual([]);
	expect(errors[0] ?? '').toMatch(/no plan found for 'demo'/);
	expect(exitCodes).toStrictEqual([1]);
});

test("planGradeCommand: the config's model, effort and permissions are handed to the harness with the plan's own repo as the working directory", async () => {
	const { cwd, name, config, driver, invocations } = setupHarnessSettings({
		config: {
			model: 'claude-opus-5',
			effort: Effort.High,
			permissions: Permissions.FullAccess,
			gates: { check: 'true', test: 'true', 'test-coverage': false },
		},
	});

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config })).rejects.toThrow(/process\.exit/);

	expect(invocations[0]).toEqual(expect.objectContaining({ cwd, model: 'claude-opus-5', effort: 'high', permissions: 'full-access' }));
	// every checker in the fan-out, not merely the first
	expect(invocations.length).toBe(3);
});

test('planGradeCommand: with no config the harness call carries no model, effort or permissions — nothing is invented for the harness to honor', async () => {
	const { cwd, name, config, driver, invocations } = setupHarnessSettings();

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config })).rejects.toThrow(/process\.exit/);

	expect(invocations[0]).toEqual(expect.objectContaining({ model: undefined, effort: undefined, permissions: undefined }));
});

test('planGradeCommand: a phased plan prints its gaps under one heading per plan file, and states the coverage as both files', async () => {
	const gaps = [{ area: GapArea.UnwiredDependency, gap: 'the hand-off names no export', decision: 'name the export', options: [] }];
	const { cwd, driver, name, logged, exitCodes } = setupPhasedGrade({ gaps });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	// one heading per plan file rather than one per gap, in the phase-then-lens
	// order the runner stamped them in
	expect(printed.filter((line) => /^phase\d/.test(line))).toStrictEqual(['phase1-core.md', 'phase2-extra.md']);
	expect(printed.filter((line) => line.startsWith('? '))).toStrictEqual([
		'? [unwired-dependency] the hand-off names no export (surface)',
		'? [unwired-dependency] the hand-off names no export (wiring)',
		'? [unwired-dependency] the hand-off names no export (decisions)',
		'? [unwired-dependency] the hand-off names no export (surface)',
		'? [unwired-dependency] the hand-off names no export (wiring)',
		'? [unwired-dependency] the hand-off names no export (decisions)',
	]);
	// the coverage line names every file the verdict can speak for, and the
	// overview is not among them — it is context, never gap-checked
	expect(printed).toContain('  checked: 2 phase file(s) × 3 lens(es): phase1-core.md, phase2-extra.md');
	expect(exitCodes).toStrictEqual([0]);
});
