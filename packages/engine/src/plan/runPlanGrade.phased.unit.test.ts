import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { GradeReport } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { cleanOverviewBody } from '#tests/helpers/cleanOverviewBody.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { gapCheckLensOf } from '#tests/helpers/gapCheckLensOf.ts';
import { overviewMarker } from '#tests/helpers/overviewMarker.ts';
import { secondPhaseBody } from '#tests/helpers/secondPhaseBody.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePhasedPlanDeliverable } from '#tests/helpers/writePhasedPlanDeliverable.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// The fan-out over a phased deliverable — every phase times every lens, the
// overview as context rather than as a graded file — and how `--phase` narrows it.

/** The two-phase deliverable every case here grades, unless it asks for other phase files. */
const defaultPhaseFiles = () => ({
	'overview.md': cleanOverviewBody(),
	'phase1-core.md': cleanPlanBody({ title: 'Graded Plan' }),
	'phase2-extra.md': secondPhaseBody(),
});

/** A consumer repo holding a phased plan, the checker stub reading it, and the collector the act writes into. */
const setup = ({ name, files = defaultPhaseFiles() }: { name: string; files?: Record<string, string> }) => {
	const cwd = setupConsumerRepo();
	const dir = writePhasedPlanDeliverable({ cwd, name, files });
	const invocations: DriverInvocation[] = [];

	return { cwd, name, invocations, gradePath: join(dir, 'grade.json'), driver: createGapCheckDriver({ invocations }) };
};

test('plan grade: a phased plan fans three differently-briefed checkers out over every phase, with the overview as context rather than as a graded file', async () => {
	const { cwd, name, driver, invocations } = setup({ name: 'phased' });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');

	const phaseOf = ({ prompt }: DriverInvocation) => (prompt.includes('src/other-thing.ts') ? 'phase2-extra.md' : 'phase1-core.md');
	const spawned = invocations.map((invocation) => `${phaseOf(invocation)}/${gapCheckLensOf(invocation)}`);

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
	const { cwd, name, driver, gradePath } = setup({ name: 'phased-verdict' });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	expect('gradePath' in result).toBeTruthy();
	// the verdict lands beside the plan text it graded — one folder per plan
	expect(result.gradePath).toBe(gradePath);

	const recorded = GradeReport.parse(JSON.parse(readFileSync(result.gradePath, 'utf8')));

	// a clean phased deliverable grades A, the overview linted alongside its phases
	expect(recorded.grade).toBe('A');
	expect(recorded.structural).toStrictEqual([]);
});

test('plan grade: --phase narrows the gap-check to the named phases and records that the pass is a subset', async () => {
	const { cwd, name, driver, invocations } = setup({ name: 'narrowed' });

	const result = await runPlanGrade({ cwd, driver, name, phases: ['2'] });

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
	const { cwd, name, driver, invocations } = setup({ name: 'by-name' });

	const result = await runPlanGrade({ cwd, driver, name, phases: ['phase2-extra.md', 'phase1-core.md'] });

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
	const { cwd, name, gradePath } = setup({ name: 'typo' });
	const driver = createUncalledDriver({ reason: 'a typo must never reach the harness' });

	const result = await runPlanGrade({ cwd, driver, name, phases: ['phase2-extra'] });

	expectStatus(result, 'failed');
	// the failure lists what was available, and nothing is written
	expect('error' in result && (result.error ?? '')).toMatch(/--phase phase2-extra matches 0 plan file\(s\) — available: phase1-core\.md, phase2-extra\.md/);
	expect(existsSync(gradePath)).toBeFalsy();
});

test('plan grade: --phase 1 selects phase1 numerically, never also a phase10 sharing its prefix', async () => {
	const { cwd, name, driver, invocations } = setup({
		name: 'ten',
		files: { 'overview.md': cleanOverviewBody(), 'phase1-core.md': cleanPlanBody({ title: 'Graded Plan' }), 'phase10-extra.md': secondPhaseBody() },
	});

	const result = await runPlanGrade({ cwd, driver, name, phases: ['1'] });

	expectStatus(result, 'complete');
	expect(result.grade.phasesChecked).toStrictEqual(['phase1-core.md']);
	// a string-prefix match would have taken phase10 too
	expect(invocations.some(({ prompt }) => prompt.includes('src/other-thing.ts'))).toBeFalsy();
});

test('plan grade: a --phase request that names nothing at all is refused rather than silently widened', async () => {
	const cwd = setupConsumerRepo();
	const name = 'empty-request';
	const driver = createUncalledDriver({ reason: 'an empty request must never grade the whole plan' });

	writePlanDeliverable({ cwd, name, body: cleanPlanBody({ title: 'Graded Plan' }) });

	const result = await runPlanGrade({ cwd, driver, name, phases: [] });

	expectStatus(result, 'failed');
	expect('error' in result && (result.error ?? '')).toMatch(/--phase named no phase file — available: plan\.md/);
});
