import { readFile } from 'node:fs/promises';
import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { capturePlanningInput } from '#src/plan/index.ts';
import { runPlanningGrade } from '#src/plan/workflow/review/index.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

const setup = async () => {
	const fixture = await planningReviewFixture();
	expect((await fixture.run()).status).toBe(PlanningVocabulary.Status.Complete);
	return fixture;
};

test('writes actual current grade provenance and refuses to reuse A after new original obligations', async () => {
	const fixture = await setup();
	const calls = fixture.calls.length;
	const initial = await runPlanningGrade({ runtime: fixture.runtime });
	expect(initial.grade).toEqual(expect.objectContaining({ passed: true, complete: true, lenses: [], weights: [], phasesLight: [] }));
	expect(initial.grade.workflow).toEqual(
		expect.objectContaining({ format: 'planning-grade-v1', generation: (await fixture.current()).digest, integrationReceiptId: expect.any(String) }),
	);
	expect(JSON.parse(await readFile(initial.gradePath, 'utf8'))).toStrictEqual(initial.grade);
	const text = 'Also preserve the original credential scope on every retry.';
	await capturePlanningInput({
		runtime: fixture.runtime,
		input: {
			stage: fixture.runtime.stage,
			sources: [{ artifact: 'followup.md', locator: 'Original followup', text, sha256: sha256({ content: text }) }],
			claims: [],
			confirmations: [],
		},
	});
	const current = await runPlanningGrade({ runtime: fixture.runtime });
	expect(current.grade).toEqual(expect.objectContaining({ passed: false, complete: false }));
	expect(current.grade.workflow?.generation).not.toBe(initial.grade.workflow?.generation);
	expect(JSON.parse(await readFile(current.gradePath, 'utf8'))).toStrictEqual(current.grade);
	expect(fixture.calls).toHaveLength(calls);
}, 60_000);

test('refuses grading before canonical input exists or for the brainstorm alignment stage', async () => {
	const fixture = await planningReviewFixture();
	await expect(runPlanningGrade({ runtime: fixture.runtime })).rejects.toThrow('Canonical planning input is unavailable');
	await fixture.capture();
	await expect(runPlanningGrade({ runtime: { ...fixture.runtime, stage: PlanningVocabulary.Stage.Brainstorm } })).rejects.toThrow(
		'Implementation grading requires the implementation stage',
	);
	expect(fixture.calls).toHaveLength(0);
});
