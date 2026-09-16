import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import { claimPlanningAttempt, commitPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { planningCompletedFixture, planningCompletionCandidate } from '#tests/helpers/planningCompletedFixture.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

test('retiring current verification requires a fresh review while preserving the completed repair and receipt history', async () => {
	const fixture = await planningCompletedFixture();
	try {
		await commitPlanningSnapshot({ cwd: fixture.cwd, name: fixture.name, ...fixture.candidate });
		const retired = await updatePlanningSnapshot({
			runtime: fixture.runtime,
			propose: async (current) => {
				const record = structuredClone(current.record);
				const work = record.work.find((item) => item.id === 'reviewer');
				expectDefined(work);
				work.status = PlanningVocabulary.WorkState.Pending;
				work.currentAttemptId = undefined;
				work.resultReceiptId = undefined;
				return { record, artifacts: current.artifacts };
			},
		});
		const pendingFinding = retired.record.findings.find((item) => item.id === 'finding');
		expectDefined(pendingFinding);
		const claim = await claimPlanningAttempt({ runtime: fixture.runtime, workId: 'reviewer', expectedInputDigest: fixture.origin.sha256 });
		if (!claim.claimed) throw new Error('Independent recheck was not claimable');
		const record = structuredClone(claim.snapshot.record);
		const oldReview = record.reviewReceipts.find((receipt) => receipt.id === 'review');
		expectDefined(oldReview);
		const receiptId = `review:${claim.attemptId}`;
		record.reviewReceipts.push({ ...oldReview, id: receiptId, attemptId: claim.attemptId, issuer: { agent: 'independent', invocationId: claim.attemptId } });
		const finding = record.findings.find((item) => item.id === 'finding');
		expectDefined(finding);
		finding.state = PlanningVocabulary.FindingState.Verified;
		finding.verificationReceiptIds.push(receiptId);
		const candidate = planningCompletionCandidate({
			snapshot: claim.snapshot,
			record,
			workId: 'reviewer',
			effects: { claimIds: [], evidenceIds: [], findingIds: ['finding'], reviewReceiptIds: [receiptId], artifacts: [] },
		});
		const completed = await commitPlanningSnapshot({ cwd: fixture.cwd, name: fixture.name, ...candidate });
		if (!completed.committed) throw new Error('Independent recheck commit lost');

		expect(pendingFinding.state).toBe(PlanningVocabulary.FindingState.Repairing);
		expect(pendingFinding.verificationReceiptIds).toEqual(['review']);
		expect(pendingFinding.resolutionArtifacts).toEqual(['plan.md']);
		expect(pendingFinding.resolutionClaimIds).toEqual(['technical']);
		expect(completed.snapshot.record.findings.find((item) => item.id === 'finding')).toEqual(
			expect.objectContaining({ state: PlanningVocabulary.FindingState.Verified, verificationReceiptIds: ['review', receiptId] }),
		);
		expect(completed.snapshot.record.reviewReceipts.find((receipt) => receipt.id === 'review')).toEqual(oldReview);
		expect(completed.snapshot.record.work.some((work) => work.role === PlanningVocabulary.Role.Repair)).toBe(false);
	} finally {
		await rm(fixture.cwd, { recursive: true, force: true });
	}
});

test.each([false, true])('does not return stale authority after a concurrent no-op transaction, candidate: %s', async (candidate) => {
	const fixture = await planningWorkflowFixture();
	const original = await fixture.capture();
	const first = await updatePlanningSnapshot({
		runtime: fixture.runtime,
		propose: async (current) => ({ record: current.record, artifacts: current.artifacts }),
	});
	const latest = await commitPlanningSnapshot({
		...fixture,
		expectedRevision: first.record.revision,
		parentDigest: first.digest,
		record: { ...first.record, revision: first.record.revision + 1, parentDigest: first.digest },
		artifacts: first.artifacts,
	});
	if (!latest.committed) throw new Error('Fixture lost transaction');
	const result = await updatePlanningSnapshot({
		runtime: fixture.runtime,
		snapshot: candidate ? first : original,
		propose: async (current) => (candidate ? { record: current.record, artifacts: current.artifacts } : undefined),
	});
	expect(result.digest).toBe(latest.snapshot.digest);
});

test.each([false, true])('refuses a disappeared generation during a transaction, candidate: %s', async (candidate) => {
	const fixture = await planningWorkflowFixture();
	await fixture.capture();
	const snapshot = await updatePlanningSnapshot({
		runtime: fixture.runtime,
		propose: async (current) => ({ record: current.record, artifacts: current.artifacts }),
	});
	await expect(
		updatePlanningSnapshot({
			runtime: fixture.runtime,
			snapshot,
			propose: async (current) => {
				await rm(join(fixture.root, '.planning'), { recursive: true });
				return candidate ? { record: current.record, artifacts: current.artifacts } : undefined;
			},
		}),
	).rejects.toThrow('disappeared during a transaction');
});
