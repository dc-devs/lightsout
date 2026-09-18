import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readJsonlRecords } from '#src/common/utils/readJsonlRecords.ts';
import { GradeReport } from '#src/contracts/index.ts';
import { gradeHistoryPath } from '#src/plan/gradeHistoryPath.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// The ledger a grading pass leaves behind: one line per completed pass, kept
// beside the single latest report `grade.json` holds.

/** One decision-level gap, as a checker reports it. */
const omittedDecisionGap = { area: 'omitted-decision', gap: 'no error handling decided', decision: 'what to return on failure', options: ['throw', 'null'] };

/** A consumer repo with one graded plan on disk and the checker stub reading it. */
const setup = ({ name, gaps = [] }: { name: string; gaps?: unknown[] }) => {
	const cwd = setupConsumerRepo();
	const dir = writePlanDeliverable({ cwd, name, body: cleanPlanBody({ title: 'Graded Plan' }) });

	return { cwd, name, gradePath: join(dir, 'grade.json'), driver: createGapCheckDriver({ gaps }) };
};

test("plan grade: a completed pass is appended to the plan's grade history", async () => {
	const { cwd, name, driver } = setup({ name: 'recorded' });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');

	const history = await readJsonlRecords({ path: await gradeHistoryPath({ cwd, name }), schema: GradeReport });

	expect(history.length).toBe(1);
	// the ledger line is the pass itself, not a summary of it
	expect(history[0]?.grade).toBe(result.grade.grade);
	expect(history[0]?.gradedAt).toBe(result.grade.gradedAt);
});

test('plan grade: a second pass leaves two history lines and one latest grade', async () => {
	// A finding the first pass leaves unanswered, so that pass does not record a
	// passing full review: the second pass then measures the plan again rather
	// than reporting the recorded one as still current, which is the case this
	// covers.
	const { cwd, name, driver, gradePath } = setup({ name: 're-graded', gaps: [omittedDecisionGap] });

	await runPlanGrade({ cwd, driver, name });
	const second = await runPlanGrade({ cwd, driver, name });

	expectStatus(second, 'complete');

	const history = await readJsonlRecords({ path: await gradeHistoryPath({ cwd, name }), schema: GradeReport });

	// re-grading a plan no longer throws the earlier pass away
	expect(history.length).toBe(2);
	// and grade.json still holds exactly one report — the latest pass
	const latest = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	expect(latest.gradedAt).toBe(second.grade.gradedAt);
	expect(latest.grade).toBe(second.grade.grade);
});
