import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readJsonlRecords } from '#src/common/utils/readJsonlRecords.ts';
import { GradeReport } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import { gradeHistoryPath } from '#src/plan/gradeHistoryPath.ts';
import { gradeMemoryPath } from '#src/plan/index.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { advisoryPlanBody, plantAdvisoryTouchedFiles } from '#tests/helpers/advisoryPlan.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// The structural preflight: what a blocking structural finding costs a grade
// pass, what it still writes, and what it leaves alone.

/**
 * The clean skeleton with an unresolved placeholder planted in it — one blocking
 * structural finding, and nothing else wrong with the plan.
 */
const blockingPlanBody = () => cleanPlanBody({ title: 'Graded Plan' }).replace('A new module', 'TBD — a new module');

/** A finding memory already on disk, holding one unresolved question. */
const memoryFixture = ({ name }: { name: string }) =>
	`${JSON.stringify(
		{
			planName: name,
			findings: [
				{
					id: 'f1',
					phase: 'plan.md',
					lens: 'decisions',
					area: 'omitted-decision',
					gap: 'no error handling decided',
					decision: 'what to return on failure',
					options: ['throw', 'null'],
					firstSeen: '2026-01-01T00:00:00.000Z',
					lastSeen: '2026-01-01T00:00:00.000Z',
					status: 'open',
					disposition: 'needs-a-human',
					humanDecision: 'what the plan should do here',
					reopened: [],
				},
			],
			nextFindingNumber: 2,
			updatedAt: '2026-01-01T00:00:00.000Z',
		},
		null,
		2,
	)}\n`;

/** A consumer repo with one plan on disk, the checker stub reading it, and the collector the act writes into. */
const setup = ({ name, body, memory = false }: { name: string; body: string; memory?: boolean }) => {
	const cwd = setupConsumerRepo();
	const dir = writePlanDeliverable({ cwd, name, body });
	const invocations: DriverInvocation[] = [];
	const memoryText = memoryFixture({ name });

	if (memory) {
		writeFileSync(gradeMemoryPath({ cwd, name }), memoryText);
	}

	return { cwd, name, invocations, memoryText, gradePath: join(dir, 'grade.json'), driver: createGapCheckDriver({ invocations }) };
};

/** The same repo, planning a mostly-mechanical edit across 50 planted modules — the advisory size note and nothing blocking. */
const setupAdvisory = ({ name }: { name: string }) => {
	const seeded = setup({ name, body: advisoryPlanBody({ title: 'Graded Plan' }) });

	plantAdvisoryTouchedFiles({ cwd: seeded.cwd });

	return seeded;
};

test('plan grade: a blocking structural finding spawns no agent at all', async () => {
	const { cwd, name, driver, invocations } = setup({ name: 'preflight-stopped', body: blockingPlanBody() });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	// the premise: the lint found something that gates
	expect(result.grade.structural.map(({ severity }) => severity)).toStrictEqual(['blocking']);
	// and nothing was spawned on top of it — no reader, no judge, no documentation
	// checker, because a plan that fails the mechanical check cannot be worth the
	// semantic fan-out
	expect(invocations).toStrictEqual([]);
});

test('plan grade: a preflight stop is written as an incomplete pass, not a missing one', async () => {
	const { cwd, name, driver, gradePath } = setup({ name: 'preflight-recorded', body: blockingPlanBody() });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');

	const persisted = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	// a semantic stage that did not run is unchecked rather than passed: the
	// verdict is below A, the gap list is empty because nobody looked, and the
	// report says so on its face
	expect(persisted).toEqual(expect.objectContaining({ grade: 'below-A', passed: false, complete: false, gaps: [], phasesChecked: [] }));
	expect(persisted.incompleteReason).toEqual(expect.stringContaining('structural'));

	const history = await readJsonlRecords({ path: gradeHistoryPath({ cwd, name }), schema: GradeReport });

	// and the stop is a pass in the ledger like any other
	expect(history.length).toBe(1);
});

test('plan grade: a preflight stop does not touch the finding memory', async () => {
	const { cwd, name, driver, memoryText } = setup({ name: 'preflight-remembered', body: blockingPlanBody(), memory: true });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	// nothing was judged, so nothing about the settled record set changed — a stop
	// that rewrote the memory would move a plan's decisions on evidence it never
	// gathered
	expect(readFileSync(gradeMemoryPath({ cwd, name }), 'utf8')).toBe(memoryText);
});

test('plan grade: an advisory structural finding still runs the semantic pass', async () => {
	const { cwd, name, driver, invocations } = setupAdvisory({ name: 'preflight-advisory' });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	// only a blocking finding stops the pass: an advisory note is legible work,
	// so the three readers run and the plan still reaches A
	expect(result.grade.structural.map(({ severity }) => severity)).toStrictEqual(['advisory']);
	expect(invocations.length).toBe(3);
	expect(result.grade.grade).toBe('A');
});
