import { expect, test } from '@jest/globals';
import { validatePlanningArtifactBodies } from '#src/plan/workflow/store/common/validation/validatePlanningArtifactBodies.ts';
import { importPlanningWorkspace } from '#src/plan/workflow/store/index.ts';
import { planningCompletedFixture } from '#tests/helpers/planningCompletedFixture.ts';
import { planningLegacyFixture } from '#tests/helpers/planningStoreFixture.ts';

test.each(['missing', 'changed', 'wrong-row', 'out-of-range'])('refuses broken historical decision authority: %s', async (defect) => {
	const fixture = await planningLegacyFixture();
	const snapshot = await importPlanningWorkspace(fixture);
	const record = structuredClone(snapshot.record);
	const artifacts = new Map(snapshot.artifacts);
	const legacy = record.legacySettlements?.[0];
	if (!legacy) throw new Error('Missing imported settlement');
	if (defect === 'missing') artifacts.delete(legacy.artifact);
	if (defect === 'changed') artifacts.set(legacy.artifact, 'changed');
	if (defect === 'wrong-row') legacy.rowText = '{}';
	if (defect === 'out-of-range') legacy.rowIndex = 999;
	expect(() => validatePlanningArtifactBodies({ record, artifacts })).toThrow(
		defect === 'missing' || defect === 'changed' ? 'Historical source bytes' : 'original source row',
	);
});

test('refuses a completed work item pointing to an absent accepted result', async () => {
	const fixture = await planningCompletedFixture();
	const record = structuredClone(fixture.candidate.record);
	record.work[0].resultReceiptId = 'result:absent';
	expect(() => validatePlanningArtifactBodies({ record, artifacts: fixture.candidate.artifacts })).toThrow('Missing accepted planning result');
});
