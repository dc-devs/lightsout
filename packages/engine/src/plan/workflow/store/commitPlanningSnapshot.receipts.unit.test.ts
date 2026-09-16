import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, test } from '@jest/globals';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { claimPlanningAttempt, commitPlanningSnapshot, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningCompletedFixture } from '#tests/helpers/planningCompletedFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async ({ mutation }: { mutation: string } = { mutation: 'valid' }) => {
	const context = await planningCompletedFixture();
	directories.push(context.cwd);
	const { candidate } = context;
	if (mutation === 'missing-effects') candidate.receipt.effects.evidenceIds = ['not-persisted'];
	if (mutation === 'attempt') candidate.receipt.attemptId = 'other-attempt';
	if (mutation === 'input') candidate.receipt.inputDigest = 'a'.repeat(64);
	if (mutation === 'role') candidate.receipt.role = PlanningVocabulary.Role.Draft;
	if (mutation === 'transition') candidate.receipt.acceptedFromDigest = 'a'.repeat(64);
	if (mutation === 'revision') candidate.receipt.acceptedRevision++;
	if (mutation === 'output') candidate.receipt.effects.artifacts[0].sha256 = 'b'.repeat(64);
	if (mutation === 'membership') candidate.receipt.effects.reviewReceiptIds = [];
	if (mutation === 'stage-switch') candidate.record.work[1].stage = PlanningVocabulary.Stage.Brainstorm;
	if (mutation === 'role-switch') {
		candidate.record.work[1].role = PlanningVocabulary.Role.DesignReview;
		candidate.receipt.role = PlanningVocabulary.Role.DesignReview;
		candidate.record.reviewReceipts[0].role = PlanningVocabulary.Role.DesignReview;
	}
	const text = canonicalJson({ value: candidate.receipt });
	candidate.artifacts.set(candidate.path, text);
	const descriptor = candidate.record.artifacts.find((item) => item.path === candidate.path);
	if (descriptor === undefined) throw new Error('Missing result descriptor');
	descriptor.sha256 = sha256({ content: text });
	return context;
};

describe('commitPlanningSnapshot accepted receipts', () => {
	test('commits actual investigation effects and independently verified review effects', async () => {
		const { cwd, name, candidate } = await setup();

		const result = await commitPlanningSnapshot({ cwd, name, ...candidate });

		expect(result.committed).toBe(true);
		if (result.committed) {
			expect(await readPlanningSnapshot({ cwd, name })).toStrictEqual(result.snapshot);
			expect(result.snapshot.record.findings[0]).toStrictEqual(candidate.record.findings[0]);
			expect(result.snapshot.record.reviewReceipts).toStrictEqual(candidate.record.reviewReceipts);
		}
	});
	test.each([
		['missing-effects', 'Accepted planning result refers to missing effects'],
		['attempt', 'Accepted planning result is not bound to the current completed attempt'],
		['input', 'Accepted planning result is not bound to the current completed attempt'],
		['role', 'Accepted planning result is not bound to the current completed attempt'],
		['transition', 'Result receipt does not bind the accepted generation transition'],
		['revision', 'Accepted planning result has an invalid acceptance revision'],
		['output', 'Accepted result artifact effects do not match their committed bytes'],
		['membership', 'Independent review requires its accepted reviewing attempt'],
		['stage-switch', 'Only the current running attempt may publish its completion'],
		['role-switch', 'Only the current running attempt may publish its completion'],
	])('rejects unsupported accepted-result provenance: %s', async (mutation, message) => {
		const { cwd, name, candidate, reviewing } = await setup({ mutation });

		await expect(commitPlanningSnapshot({ cwd, name, ...candidate })).rejects.toThrow(message);

		expect(await readPlanningSnapshot({ cwd, name })).toStrictEqual(reviewing);
	});
	test('retains historical independent review after invalidation and a new claim', async () => {
		const { cwd, name, runtime, candidate, origin } = await setup();
		const completed = await commitPlanningSnapshot({ cwd, name, ...candidate });
		if (!completed.committed) throw new Error('Fixture completion lost');
		const snapshot = completed.snapshot;
		const record = structuredClone(snapshot.record);
		record.revision++;
		record.parentDigest = snapshot.digest;
		record.work[1] = { ...record.work[1], status: PlanningVocabulary.WorkState.Pending, currentAttemptId: undefined, resultReceiptId: undefined };
		await commitPlanningSnapshot({
			cwd,
			name,
			record,
			artifacts: snapshot.artifacts,
			expectedRevision: snapshot.record.revision,
			parentDigest: snapshot.digest,
		});

		const result = await claimPlanningAttempt({ runtime, workId: 'reviewer', expectedInputDigest: origin.sha256 });

		expect(result.claimed).toBe(true);
		expect(result.snapshot.record.reviewReceipts).toStrictEqual(snapshot.record.reviewReceipts);
		expect(result.snapshot.record.work[1].attemptSequence).toBe(2);
	});
});

const setupForgedReview = async ({ orphan }: { orphan: boolean }) => {
	const context = await setup();
	if (orphan) {
		context.candidate.record.work[1] = { ...context.reviewing.record.work[1] };
	} else {
		context.candidate.record.artifacts = context.candidate.record.artifacts.filter((item) => item.path !== context.candidate.path);
		context.candidate.artifacts.delete(context.candidate.path);
		context.candidate.record.work[1] = { ...context.reviewing.record.work[1], status: PlanningVocabulary.WorkState.Pending, currentAttemptId: undefined };
	}
	return context;
};
test.each([false, true])('refuses review approval without an accepted completion (orphan result: %s)', async (orphan) => {
	const { cwd, name, candidate, reviewing } = await setupForgedReview({ orphan });

	await expect(commitPlanningSnapshot({ cwd, name, ...candidate })).rejects.toThrow(
		orphan ? 'New accepted results must belong to a current completion' : 'Independent review requires its accepted reviewing attempt',
	);

	expect(await readPlanningSnapshot({ cwd, name })).toStrictEqual(reviewing);
});

const setupHistoricalMutation = async ({ lateReview }: { lateReview: boolean }) => {
	const context = await setup();
	const result = await commitPlanningSnapshot({ cwd: context.cwd, name: context.name, ...context.candidate });
	if (!result.committed) throw new Error('Fixture writer lost');
	const snapshot = result.snapshot;
	const record = structuredClone(snapshot.record);
	record.revision++;
	record.parentDigest = snapshot.digest;
	if (lateReview) record.reviewReceipts.push({ ...record.reviewReceipts[0], id: 'late-review' });
	else record.reviewReceipts[0].coverage.adequacy = 'Rewrite original review';
	return { ...context, snapshot, record };
};
test.each([false, true])('refuses retroactive review history (new receipt: %s)', async (lateReview) => {
	const { cwd, name, snapshot, record } = await setupHistoricalMutation({ lateReview });

	await expect(
		commitPlanningSnapshot({ cwd, name, record, artifacts: snapshot.artifacts, expectedRevision: snapshot.record.revision, parentDigest: snapshot.digest }),
	).rejects.toThrow(lateReview ? 'Independent review requires its accepted reviewing attempt' : 'Accepted review receipt cannot be changed or deleted');
});
