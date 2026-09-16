import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { attachPlanningData } from '#src/plan/index.ts';
import { getCurrentPlanningReviews } from '#src/plan/workflow/common/review/getCurrentPlanningReviews.ts';
import { PlanningBaseline } from '#src/plan/workflow/common/types/invocation/PlanningBaseline.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

test.each(['missing-result', 'revision', 'policy'])('does not credit a review with mismatched accepted authority: %s', async (defect) => {
	const fixture = await planningReviewFixture();
	expect((await fixture.run()).status).toBe('complete');
	const original = await fixture.current();
	const snapshot = { ...original, record: structuredClone(original.record), artifacts: new Map(original.artifacts) };
	const review = getCurrentPlanningReviews({ snapshot })[0];
	if (!review) throw new Error('Missing independently accepted review');
	const work = snapshot.record.work.find((item) => item.id === review.workId);
	if (!work?.resultReceiptId) throw new Error('Missing completed review work');
	const path = `planning-baselines/${sha256({ content: work.resultReceiptId })}.json`;
	const baseline = PlanningBaseline.parse(JSON.parse(snapshot.artifacts.get(path) ?? 'null'));
	if (defect === 'missing-result') work.resultReceiptId = undefined;
	else {
		if (defect === 'revision') baseline.acceptedRevision++;
		if (defect === 'policy') baseline.invocationPolicyDigest = 'a'.repeat(64);
		attachPlanningData({ record: snapshot.record, artifacts: snapshot.artifacts, path, value: baseline });
	}
	expect(getCurrentPlanningReviews({ snapshot }).map((item) => item.id)).not.toContain(review.id);
});
