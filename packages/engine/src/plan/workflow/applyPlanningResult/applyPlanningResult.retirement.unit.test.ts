import { expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { applyPlanningResult, claimPlanningAttempt, invokePlanningRole, readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';

const setup = async ({ review = false } = {}) => {
	const fixture = await planningRoleProposalFixture({
		role: PlanningVocabulary.Role.Repair,
		arrange: ({ record, work }) => {
			record.work.push({ ...work, id: 'historical-diagnosis', role: PlanningVocabulary.Role.Diagnose, prerequisiteIds: [] });
		},
	});
	const pending = fixture.before.record.work.find((work) => work.id === (review ? 'initial:design-review' : 'historical-diagnosis'));
	if (!pending) throw new Error('Expected independent pending work');
	const claim = await claimPlanningAttempt({ runtime: fixture.runtime, workId: pending.id, expectedInputDigest: pending.inputDigest });
	if (!claim.claimed) throw new Error('Expected independently claimed work');
	const work = claim.snapshot.record.work.find((work) => work.id === pending.id);
	if (!work) throw new Error('Expected claimed work');
	const result = await invokePlanningRole({ runtime: fixture.runtime, snapshot: claim.snapshot, work });
	const accepted = await applyPlanningResult({ runtime: fixture.runtime, result });
	if (!accepted.accepted) throw new Error('Expected actual accepted historical result');
	const completed = accepted.snapshot.record.work.find((item) => item.id === work.id);
	if (!completed) throw new Error('Expected completed work');
	const author = accepted.snapshot.record.work.find((work) => work.role === PlanningVocabulary.Role.Architect);
	if (!author) throw new Error('Expected completed architect');
	return { ...fixture, completed, author, accepted };
};

test('retires the selected review receipt during repair acceptance while preserving immutable review history', async () => {
	const fixture = await setup({ review: true });
	const receipt = fixture.accepted.snapshot.record.reviewReceipts.find((receipt) => receipt.workId === fixture.completed.id);
	if (!receipt) throw new Error('Expected accepted independent review');
	fixture.runtime.services.invalidate = () => ({ workIds: [], receiptIds: [receipt.id], reason: 'Repair changes reviewed artifact' });
	const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
	expect(result.accepted).toBe(true);
	expect(result.snapshot.record.reviewReceipts).toContainEqual(receipt);
	expect(result.snapshot.record.work.find((work) => work.id === fixture.completed.id)).toEqual(expect.objectContaining({ status: 'pending' }));
	expect(result.snapshot.record.work.find((work) => work.id === fixture.completed.id)?.resultReceiptId).toBeUndefined();
	expect(result.snapshot.record.work.find((work) => work.id === fixture.author.id)).toStrictEqual(fixture.author);
});

test('retires an ordinary producer during acceptance but retains an actual historical diagnosis', async () => {
	const fixture = await setup();
	fixture.runtime.services.invalidate = () => ({
		workIds: [fixture.author.id, fixture.completed.id],
		receiptIds: [],
		reason: 'Selected implementation dependency changed',
	});
	const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
	expect(result.accepted).toBe(true);
	expect(result.snapshot.record.work.find((work) => work.id === fixture.completed.id)).toStrictEqual(fixture.completed);
	expect(result.snapshot.record.work.find((work) => work.id === fixture.author.id)).toEqual(expect.objectContaining({ status: 'pending' }));
	expect(result.snapshot.record.work.find((work) => work.id === fixture.author.id)?.resultReceiptId).toBeUndefined();
});

test('retains historical diagnosis on refresh while resuming the affected ordinary producer', async () => {
	const fixture = await setup();
	let first = true;
	fixture.runtime.services.invalidate = () => {
		if (!first) return { workIds: [], receiptIds: [], reason: 'No further changes' };
		first = false;
		return { workIds: [fixture.author.id, fixture.completed.id], receiptIds: [], reason: 'Source dependency changed' };
	};
	const calls: string[] = [];
	fixture.runtime.driver = {
		...fixture.runtime.driver,
		invoke: async (invocation) => {
			calls.push(invocation.prompt);
			return { text: 'Provider capacity unavailable after refresh', exitCode: 1, rateLimited: true };
		},
	};
	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);
	expect(result.status).toBe('externally-blocked');
	expect(snapshot?.record.work.find((work) => work.id === fixture.completed.id)).toStrictEqual(fixture.completed);
	expect(calls).toHaveLength(1);
	expect(JSON.parse(calls[0]).identity.workId).toBe(fixture.author.id);
	expect(snapshot?.record.work.find((work) => work.id === fixture.author.id)?.resultReceiptId).toBeUndefined();
});
