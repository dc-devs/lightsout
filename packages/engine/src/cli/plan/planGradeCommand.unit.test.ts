import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { planGradeCommand } from '#src/cli/plan/index.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { Effort, GapArea, Permissions } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

/** The command's own output, with the progress printer's timestamped narration dropped. */
const printedLines = ({ logged }: { logged: string[] }) => logged.filter((line) => !/^\[\+\d+:\d\d\]/.test(line));

/** A gap-check stub returning a fixed gap set for every plan file it is handed. */
const gapDriver = ({ gaps }: { gaps: unknown[] }): Driver => ({
	name: 'stub',
	invoke: async () => ({ text: JSON.stringify({ gaps }), exitCode: 0 }),
});

// A real consumer repo with a real committed deliverable: the structural half of
// the grade is the deterministic lint, and only the gap half is stubbed.
const setupGrade = ({ body }: { body?: string } = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });

	if (body !== undefined) {
		writePlanDeliverable({ cwd, name: 'demo', body });
	}

	return { cwd, name: 'demo', ...captured };
};

// The harness settings a config carries reach the agent call through the shared
// option bundle, so the arrangement records what the harness was handed rather
// than what it printed.
const setupHarnessSettings = ({ config }: { config?: LightsoutConfig } = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });
	const invocations: DriverInvocation[] = [];

	writePlanDeliverable({ cwd, name: 'demo', body: cleanPlanBody() });

	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return { text: JSON.stringify({ gaps: [] }), exitCode: 0 };
		},
	};

	return { cwd, name: 'demo', config, driver, invocations, ...captured };
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
const setupPhasedGrade = () => {
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

	return { cwd, name: 'demo', ...captured };
};

test('planGradeCommand: a clean plan with no gaps grades A, reports both counts and the grade path, and exits 0', async () => {
	const { cwd, name, logged, errors, exitCodes } = setupGrade({ body: cleanPlanBody() });

	await expect(planGradeCommand({ cwd, driver: gapDriver({ gaps: [] }), name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — A \(graded \d{4}-\d\d-\d\dT/);
	expect(printed[1]).toBe('  structural: 0 · gaps: 0');
	// the coverage statement says which files it can speak for, and with how many
	// briefs — `N phase file(s)`, never `all plan files`
	expect(printed[2]).toBe('  checked: 1 phase file(s) × 3 lens(es): plan.md');
	expect(printed[3]).toBe(`\ngrade: ${join(cwd, '.lightsout', 'plans', 'demo', 'grade.json')}`);
	// an A grade prints no finding lines, got: ${JSON.stringify(printed)}
	expect(printed.length).toBe(4);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: a gap drops the grade below A and prints the decision with the options to choose among', async () => {
	const { cwd, name, logged, exitCodes } = setupGrade({ body: cleanPlanBody() });
	const gaps = [{ area: GapArea.OmittedDecision, gap: 'no storage choice', decision: 'pick a store', options: ['sqlite', 'postgres'] }];

	await expect(planGradeCommand({ cwd, driver: gapDriver({ gaps }), name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — below-A \(graded \d{4}-\d\d-\d\dT/);
	// the stub answers every lens, so one planted gap comes back three times — the
	// union, each copy labelled with the brief that found it
	expect(printed[1]).toBe('  structural: 0 · gaps: 3');
	expect(printed[2]).toBe('  checked: 1 phase file(s) × 3 lens(es): plan.md');
	// gaps print grouped under the plan file they were found in
	expect(printed[3]).toBe('plan.md');
	expect(printed[4]).toBe('? [omitted-decision] no storage choice (surface)');
	expect(printed[5]).toBe('   decide: pick a store — options: sqlite / postgres');
	expect(printed[6]).toBe('? [omitted-decision] no storage choice (wiring)');
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: a structurally dirty plan prints the lint finding, and an optionless gap prints the decision alone', async () => {
	const { cwd, name, logged, exitCodes } = setupGrade({
		body: cleanPlanBody().replace('A new module exporting', 'TBD — a new module exporting'),
	});
	const gaps = [{ area: GapArea.InsufficientDetail, gap: 'no error handling named', decision: 'say what a failure does', options: [] }];

	await expect(planGradeCommand({ cwd, driver: gapDriver({ gaps }), name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

	const printed = printedLines({ logged });

	expect(printed[0] ?? '').toMatch(/^\nplan grade demo — below-A /);
	expect(printed[1]).toBe('  structural: 1 · gaps: 3');
	expect(printed[2]).toBe('  checked: 1 phase file(s) × 3 lens(es): plan.md');
	expect(printed[3] ?? '').toMatch(/^⚠ plan\.md \[no-placeholders\] plan\.md:\d+ — unresolved placeholder 'TBD' present$/);
	expect(printed[4] ?? '').toMatch(/^ {3}fix: resolve 'TBD'/);
	expect(printed[5]).toBe('plan.md');
	expect(printed[6]).toBe('? [insufficient-detail] no error handling named (surface)');
	// an optionless gap prints the decision alone
	expect(printed[7]).toBe('   decide: say what a failure does');
	expect(exitCodes).toStrictEqual([0]);
});

test('planGradeCommand: a narrowed pass says so above the verdict and exits 1, because a subset is not a pass', async () => {
	const { cwd, name, logged, exitCodes } = setupGrade({ body: cleanPlanBody() });

	await expect(planGradeCommand({ cwd, driver: gapDriver({ gaps: [] }), name, standards: undefined, config: undefined, phases: ['plan.md'] })).rejects.toThrow(
		/process\.exit/,
	);

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
	const { cwd, name, logged, errors, exitCodes } = setupGrade();

	await expect(planGradeCommand({ cwd, driver: gapDriver({ gaps: [] }), name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

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
	const { cwd, name, logged, exitCodes } = setupPhasedGrade();
	const gaps = [{ area: GapArea.UnwiredDependency, gap: 'the hand-off names no export', decision: 'name the export', options: [] }];

	await expect(planGradeCommand({ cwd, driver: gapDriver({ gaps }), name, standards: undefined, config: undefined })).rejects.toThrow(/process\.exit/);

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
