import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { PlanningPortableGeneration } from '#src/plan/workflow/common/types/transport/PlanningPortableGeneration.ts';
import { planningDataArtifact } from '#src/plan/workflow/store/index.ts';
import { validatePlanningPortableCitations } from '#src/plan/workflow/store/portable/common/validation/validatePlanningPortableCitations.ts';
import { planningPortableFixture } from '#tests/helpers/planningPortableFixture.ts';

const setup = async () => {
	const fixture = await planningPortableFixture({ complete: true });
	const portable = PlanningPortableGeneration.parse(JSON.parse(fixture.text));
	const snapshot = {
		...fixture.snapshot,
		record: structuredClone(fixture.snapshot.record),
		artifacts: new Map(fixture.snapshot.artifacts),
		omittedObservations: portable.omittedObservations,
	};
	const citation = {
		artifact: fixture.observationPath,
		sha256: sha256({ content: snapshot.artifacts.get(fixture.observationPath) ?? '' }),
		quote: 'local only',
	};
	return { snapshot, citation };
};

test.each(['planning-settlements/missing.json', 'planning-adjudication-requests/missing.json'])(
	'refuses a missing portable citation record: %s',
	async (path) => {
		const { snapshot } = await setup();
		snapshot.record.artifacts.push(planningDataArtifact({ path, content: '{}' }));
		expect(() => validatePlanningPortableCitations({ snapshot })).toThrow('missing or corrupt');
	},
);

test('does not omit observation authority referenced by an accepted withdrawal', async () => {
	const { snapshot, citation } = await setup();
	attachPlanningData({
		record: snapshot.record,
		artifacts: snapshot.artifacts,
		path: 'planning-settlements/withdrawal.json',
		value: {
			format: 'planning-settlement-v1',
			findingId: 'mistaken-report',
			workId: 'adjudicate',
			attemptId: 'attempt',
			resultReceiptId: 'result:attempt',
			invocationId: 'invocation',
			reason: 'The original observation disproves the report',
			citations: [citation],
			dependencies: [],
		},
	});
	expect(() => validatePlanningPortableCitations({ snapshot })).toThrow('omit required citation authority');
});

test('does not omit observations cited by independent verification', async () => {
	const { snapshot, citation } = await setup();
	snapshot.record.reviewReceipts[0].verifiedFindings.push({ findingId: 'verified', citations: [citation] });
	expect(() => validatePlanningPortableCitations({ snapshot })).toThrow('omit required citation authority');
});
