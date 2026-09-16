import { expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { selectPlanningWork } from '#src/plan/workflow/selectPlanningWork.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

const setup = async () => {
	const fixture = await planningWorkflowFixture();
	const snapshot = await fixture.capture();
	const investigation = snapshot.record.work.find((work) => work.role === PlanningVocabulary.Role.Investigate);
	if (!investigation) throw new Error('Missing investigation fixture');
	return { ...fixture, snapshot, investigation };
};

test('selects independent ready work when another investigation is interrupted and its dependent remains blocked', async () => {
	const fixture = await setup();
	fixture.investigation.status = PlanningVocabulary.WorkState.Interrupted;
	fixture.snapshot.record.work.push({
		...fixture.investigation,
		id: 'independent-investigation',
		status: PlanningVocabulary.WorkState.Pending,
		prerequisiteIds: [],
		scope: { kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: [], packageRoots: ['packages/other'] },
	});

	const result = selectPlanningWork({ snapshot: fixture.snapshot, stage: fixture.runtime.stage });

	expect(result.work.map((work) => work.id)).toStrictEqual(['independent-investigation']);
	expect(result.work.some((work) => work.role === PlanningVocabulary.Role.Architect)).toBe(false);
});

test('requires the current stage and completed prerequisites before selecting work', async () => {
	const fixture = await setup();
	fixture.investigation.stage = PlanningVocabulary.Stage.Brainstorm;

	const result = selectPlanningWork({ snapshot: fixture.snapshot, stage: PlanningVocabulary.Stage.Implementation });

	expect(result.work).toStrictEqual([]);
	expect(result.reason).toMatch(/No current prerequisite-ready obligation/);
});

test('prioritizes a ready diagnostic obligation over ordinary investigation', async () => {
	const fixture = await setup();
	fixture.snapshot.record.work.push({ ...fixture.investigation, id: 'diagnose-obstacle', role: PlanningVocabulary.Role.Diagnose });

	const result = selectPlanningWork({ snapshot: fixture.snapshot, stage: fixture.runtime.stage });

	expect(result.work.map((work) => work.id)).toStrictEqual(['diagnose-obstacle']);
});

test('does not select drafting merely because its ordinary prerequisites were removed', async () => {
	const fixture = await setup();
	const draft = fixture.snapshot.record.work.find((work) => work.role === PlanningVocabulary.Role.Draft);
	if (!draft) throw new Error('Missing draft fixture');
	fixture.snapshot.record.work = [{ ...draft, prerequisiteIds: [] }];

	const result = selectPlanningWork({ snapshot: fixture.snapshot, stage: fixture.runtime.stage });

	expect(result.work).toStrictEqual([]);
	expect(fixture.snapshot.record.reviewReceipts).toStrictEqual([]);
});
