import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { planGradeCommand } from '#src/cli/plan/index.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { Effort, GapArea, Permissions } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { advisoryPlanBody, plantAdvisoryTouchedFiles } from '#tests/helpers/advisoryPlan.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { cleanOverviewBody } from '#tests/helpers/cleanOverviewBody.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeEmptyDecisions } from '#tests/helpers/writeEmptyDecisions.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

/** The command's own output, with the progress printer's timestamped narration dropped. */
const printedLines = ({ logged }: { logged: string[] }) => logged.filter((line) => !/^\[\+\d+:\d\d\]/.test(line));

/** The ruling the shared stub's judges return, so the decision the command prints is the judge's own. */
const judgedDecision = 'what the plan should do here';

// A real consumer repo with a real committed deliverable: the structural half of
// the grade is the deterministic lint, and only the gap half is stubbed.
const setupGrade = ({ body, gaps = [], verdict, git = false }: { body?: string; gaps?: unknown[]; verdict?: Record<string, unknown>; git?: boolean } = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git });

	if (body !== undefined) {
		writePlanDeliverable({ cwd, name: 'demo', body });
	}

	return { cwd, name: 'demo', driver: createGapCheckDriver({ gaps, verdict }), ...captured };
};

// A clean single-file plan graded with every harness invocation collected, so an
// act can state what the harness was handed rather than what the command
// printed. `git` commits the repo, which is what lets a second pass measure the
// very inputs the first one recorded — a recorded full review is reusable only
// when the tree under it has not moved.
const setupRecordedGrade = ({ config, git = false }: { config?: LightsoutConfig; git?: boolean } = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git });
	const invocations: DriverInvocation[] = [];

	writePlanDeliverable({ cwd, name: 'demo', body: cleanPlanBody() });

	return { cwd, name: 'demo', config, driver: createGapCheckDriver({ invocations }), invocations, ...captured };
};

// A phased deliverable — an overview plus two clean phase files — so the gaps
// the fan-out stamps carry two different plan files to group under.
const setupPhasedGrade = ({ gaps }: { gaps: unknown[] }) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });
	const dir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'overview.md'), cleanOverviewBody());
	writeFileSync(join(dir, 'phase1-core.md'), cleanPlanBody({ title: 'Phase 1', reference: true }));
	writeFileSync(
		join(dir, 'phase2-extra.md'),
		cleanPlanBody({ title: 'Phase 2', reference: true })
			.replace(/new-thing/g, 'other-thing')
			.replace(/newThing/g, 'otherThing'),
	);
	writeEmptyDecisions({ dir, name: 'demo' });

	return { cwd, name: 'demo', driver: createGapCheckDriver({ gaps }), ...captured };
};

test('planGradeCommand: a clean plan with no gaps grades A, reports both counts, the grade path and the history path, and exits 0', async () => {
	const { cwd, driver, name, logged, errors, exitCodes } = setupGrade({ body: cleanPlanBody() });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — A \(graded \d{4}-\d\d-\d\dT/);
	// how far this pass reached, and which rule chose that far
	expect(printed[1] ?? '').toMatch(/^ {2}scope: full — /);
	expect(printed[2]).toBe('  structural: 0 · gaps: 0 (0 blocking, 0 unjudged)');
	// the coverage statement says which files it can speak for, and with how many
	// briefs — `N phase file(s)`, never `all plan files`
	expect(printed[3]).toBe('  checked: 1 phase file(s) × 3 lens(es): plan.md');
	// three paths, not one: the grade path names the latest pass, the history path
	// names every pass this plan has ever had, and the memory path names what is
	// still open and what was settled
	expect(printed[4]).toBe(`\ngrade: ${join(cwd, '.lightsout', 'plans', 'demo', 'grade.json')}`);
	expect(printed[5]).toBe(`history: ${join(cwd, '.lightsout', 'plans', 'demo', 'grade-history.jsonl')}`);
	expect(printed[6]).toBe(`memory: ${join(cwd, '.lightsout', 'plans', 'demo', 'grade-memory.json')}`);
	// an A grade prints no finding lines, got: ${JSON.stringify(printed)}
	expect(printed.length).toBe(7);
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
	expect(printed[2]).toBe('  structural: 0 · gaps: 3 (3 blocking, 0 unjudged)');
	expect(printed[3]).toBe('  checked: 1 phase file(s) × 3 lens(es): plan.md');
	// gaps print grouped under the plan file they were found in
	expect(printed[4]).toBe('plan.md');
	// each carries the id of the memory record it was folded into, so a human can
	// name it when talking about what is on record
	expect(printed[5]).toBe('f1 ? [omitted-decision] no storage choice (surface)');
	// the decision printed is the judge's, and the options are the reader's
	expect(printed[6]).toBe(`   decide: ${judgedDecision} — options: sqlite / postgres`);
	expect(printed[7]).toBe('f2 ? [omitted-decision] no storage choice (wiring)');
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
	expect(printed[2]).toBe('  structural: 0 · gaps: 3 (0 blocking, 0 unjudged)');
	expect(printed[3]).toBe('  checked: 1 phase file(s) × 3 lens(es): plan.md');
	// not being interrupted by findings nobody needs to act on is the point — the
	// full record is in grade.json, got: ${JSON.stringify(printed)}
	expect(printed.length).toBe(7);
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: findings nobody weighed are counted apart from the ones a human must settle, and say so when printed', async () => {
	const gaps = [{ area: GapArea.OmittedDecision, gap: 'no storage choice', decision: 'pick a store', options: [] }];
	const { cwd, driver, name, logged, exitCodes } = setupGrade({ body: cleanPlanBody(), gaps, verdict: { outcome: 'already-answered' } });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — below-A /);
	// a spike in judge failures must not read as a plan getting worse; the three
	// lenses' identical unjudged wording is one pending record, so it is one blocker
	expect(printed[2]).toBe('  structural: 0 · gaps: 1 (1 blocking, 1 unjudged)');
	expect(printed[4]).toBe('plan.md');
	// an unjudged finding is kept on record as pending, so it carries the id a
	// human names it by
	expect(printed[5]).toBe('f1 ? [omitted-decision] no storage choice (surface)');
	// a dismissal with no citation is a rubber stamp, and the line says the finding
	// blocks because nobody weighed it rather than because the plan is thin
	expect(printed[6]).toBe('   unjudged, so it blocks: the judge answered already-answered without the evidence that outcome demands');
	// and the one blocker still carries every lens that reported it
	const recorded = JSON.parse(readFileSync(join(cwd, '.lightsout', 'plans', 'demo', 'grade.json'), 'utf8')) as {
		gaps: Array<{ observations: Array<{ lens: string }> }>;
	};
	expect(recorded.gaps.map(({ observations }) => observations.map(({ lens }) => lens))).toStrictEqual([['surface', 'wiring', 'decisions']]);
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: a structurally dirty plan prints the lint finding, and an optionless gap prints the decision alone', async () => {
	const gaps = [{ area: GapArea.InsufficientDetail, gap: 'no error handling named', decision: 'say what a failure does', options: [] }];
	// An ADVISORY lint finding rather than a blocking one: a blocking finding now
	// stops the pass before a checker is spawned, so the plan that prints a lint
	// finding beside its gaps is one the lint only has a note about.
	const { cwd, driver, name, logged, exitCodes } = setupGrade({ body: advisoryPlanBody(), gaps });

	plantAdvisoryTouchedFiles({ cwd });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — below-A /);
	expect(printed[2]).toBe('  structural: 1 · gaps: 3 (3 blocking, 0 unjudged)');
	expect(printed[3]).toBe('  checked: 1 phase file(s) × 3 lens(es): plan.md');
	expect(printed[4] ?? '').toMatch(/^note plan\.md \[scope-within-guardrail\] plan\.md — plan touches 51 source files/);
	expect(printed[5] ?? '').toMatch(/^ {3}fix: legal, but the implementing agent stops at 50 files/);
	expect(printed[6]).toBe('plan.md');
	expect(printed[7]).toBe('f1 ? [insufficient-detail] no error handling named (surface)');
	// an optionless gap prints the decision alone
	expect(printed[8]).toBe(`   decide: ${judgedDecision}`);
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
	// a pass that did not finish is recorded like any other, so the command names
	// the history whenever it names the grade — never one path without the other
	expect(printed.slice(-3)).toStrictEqual([
		`\ngrade: ${join(cwd, '.lightsout', 'plans', 'demo', 'grade.json')}`,
		`history: ${join(cwd, '.lightsout', 'plans', 'demo', 'grade-history.jsonl')}`,
		`memory: ${join(cwd, '.lightsout', 'plans', 'demo', 'grade-memory.json')}`,
	]);
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
	const { cwd, name, config, driver, invocations } = setupRecordedGrade({
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
	const { cwd, name, config, driver, invocations } = setupRecordedGrade();

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
	// each gap leads with the id of the record it was folded into, assigned in the
	// order the readers returned them
	expect(printed.filter((line) => / \? /.test(line))).toStrictEqual([
		'f1 ? [unwired-dependency] the hand-off names no export (surface)',
		'f2 ? [unwired-dependency] the hand-off names no export (wiring)',
		'f3 ? [unwired-dependency] the hand-off names no export (decisions)',
		'f4 ? [unwired-dependency] the hand-off names no export (surface)',
		'f5 ? [unwired-dependency] the hand-off names no export (wiring)',
		'f6 ? [unwired-dependency] the hand-off names no export (decisions)',
	]);
	// the coverage line names every file the verdict can speak for, and the
	// overview is not among them — it is context, never gap-checked
	expect(printed).toContain('  checked: 2 phase file(s) × 3 lens(es): phase1-core.md, phase2-extra.md');
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: a contract repository prints one weight line per plan file, with the thresholds it crossed', async () => {
	const captured = captureCommandOutput();
	const driver = createGapCheckDriver();
	const cwd = setupConsumerRepo({ git: false, config: { plan: { contract: true } } });
	const body = `${cleanPlanBody().replace('## Patterns to Mirror\n\n- `src/index.js` — mirror its single-export shape.\n', '')}
## Acceptance Tests

| Criterion | Test file | Test name | Gate |
|---|---|---|---|
| newThing is re-exported | \`src/newThing.unit.test.ts\` | re-exports newThing | test |
`;

	writePlanDeliverable({ cwd, name: 'demo', body });

	await expect(planGradeCommand({ cwd, driver, name: 'demo', standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	// the reason is what makes the routing arguable rather than mysterious
	expect(printedLines({ logged: captured.logged })).toContain('  weight: plan.md — heavy (names no pattern to mirror)');
});

test('planGradeCommand: a grade that weighed nothing prints no weight line at all', async () => {
	const { cwd, driver, name, logged } = setupGrade({ body: cleanPlanBody() });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	expect(printedLines({ logged }).some((line) => line.startsWith('  weight:'))).toBe(false);
});

test('plan grade prints the scope, the reuse line and the memory path', async () => {
	const { cwd, driver, name, invocations, logged, exitCodes } = setupRecordedGrade({ git: true });
	const planDir = join(cwd, '.lightsout', 'plans', 'demo');

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	// what the first pass left behind, read before the second pass runs, so
	// "nothing was re-run" is a comparison rather than a claim
	const firstPassLines = logged.length;
	const firstPassSpawns = invocations.length;
	const gradeAfterFirstPass = readFileSync(join(planDir, 'grade.json'), 'utf8');
	const historyAfterFirstPass = readFileSync(join(planDir, 'grade-history.jsonl'), 'utf8');
	const firstReport = JSON.parse(gradeAfterFirstPass) as { scope: string; scopeReason: string };

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printedByFirstPass = logged.slice(0, firstPassLines);
	const printedByReuse = logged.slice(firstPassLines);
	const memoryPath = join(planDir, 'grade-memory.json');
	// the one line that carries the reason the pass reached as far as it did
	const scopeLine = printedByFirstPass.find((line) => line.includes(firstReport.scopeReason)) ?? '';

	// a pass over every plan file, and a line saying which rule chose that far —
	// a history line nobody can explain is not a reason
	expect(firstReport.scope).toBe('full');
	expect(firstReport.scopeReason).toEqual(expect.stringMatching(/\S/));
	expect(scopeLine).toContain('full');
	// the memory file is named beside the grade and the history, on both passes,
	// because it is the third file a human opens after a grade
	expect(printedByFirstPass).toContainEqual(expect.stringContaining(memoryPath));
	expect(printedByReuse).toContainEqual(expect.stringContaining(memoryPath));
	// the recorded full review still covers these inputs, so the second pass
	// spawned nothing, appended nothing, and left the verdict where it was
	expect(firstPassSpawns).toBeGreaterThan(0);
	expect(invocations.length).toBe(firstPassSpawns);
	expect(readFileSync(join(planDir, 'grade-history.jsonl'), 'utf8')).toBe(historyAfterFirstPass);
	expect(readFileSync(join(planDir, 'grade.json'), 'utf8')).toBe(gradeAfterFirstPass);
	// and the terminal says so, naming the file to delete to force a new baseline
	expect(printedByReuse).toContainEqual(expect.stringMatching(/full review/i));
	expect(printedByReuse).toContainEqual(expect.stringContaining('grade-memory.json'));
	expect(exitCodes).toStrictEqual([0, 0]);
});

test('records the grade step as passed when a complete grade exits 0, whatever its letter', async () => {
	const gaps = [{ area: GapArea.OmittedDecision, gap: 'no storage choice', decision: 'pick a store', options: ['sqlite', 'postgres'] }];
	const { cwd, driver, name, logged, exitCodes } = setupGrade({ body: cleanPlanBody(), gaps });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const recorded = readFileSync(join(cwd, '.lightsout', 'plans', 'demo', 'planning-progress.json'), 'utf8');
	const record = JSON.parse(recorded) as { steps: unknown[] };

	// the letter is the plan's verdict, not the step's outcome: a complete pass
	// that exits 0 is a grade step that passed, even below A
	expect(printedLines({ logged })[0] ?? '').toMatch(/^\nplan grade demo — below-A /);
	expect(record.steps).toEqual([expect.objectContaining({ step: 'grade', status: 'passed', attempts: 1, pid: process.pid })]);
	expect(exitCodes).toStrictEqual([0]);
});

const rateLimitedChecker: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 1, rateLimited: true }) };

test.each([
	{ outcome: 'a rate-limited pass', driver: rateLimitedChecker, phases: undefined, status: 'paused-rate-limit' },
	{ outcome: 'a pass narrowed to a subset', driver: createGapCheckDriver(), phases: ['plan.md'], status: 'failed' },
])('records the grade step as $status when $outcome exits 1', async ({ driver, phases, status }) => {
	const { cwd, name, exitCodes } = setupGrade({ body: cleanPlanBody() });

	await expect(planGradeCommand({ cwd, driver, name, standards: undefined, config: undefined, phases })).rejects.toThrow(/process\.exit/);

	const record = JSON.parse(readFileSync(join(cwd, '.lightsout', 'plans', 'demo', 'planning-progress.json'), 'utf8')) as { steps: unknown[] };

	// both leave a grade on disk, and neither is the complete pass that exits 0
	expect(record.steps).toEqual([expect.objectContaining({ step: 'grade', status, attempts: 1 })]);
	expect(exitCodes).toStrictEqual([1]);
});
