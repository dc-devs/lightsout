import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { applyPlanningResult, readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { planningArchitectEvidenceFixture } from '#tests/helpers/planningArchitectEvidenceFixture.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';
import { planningEvidenceContinuationScenario } from '#tests/helpers/planningWorkflowEvidenceScenario.ts';

const setup = async ({ variant }: { variant: string }) => {
	const fixture = await planningRoleProposalFixture({ role: PlanningVocabulary.Role.DesignReview });
	const accepted = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });
	if (!accepted.accepted) throw new Error('Expected a real completed review');
	const receipt = accepted.snapshot.record.reviewReceipts.find((receipt) => receipt.workId === fixture.work.id);
	const author = accepted.snapshot.record.work.find((work) => work.role === PlanningVocabulary.Role.Architect);
	if (!receipt || !author) throw new Error('Actual author and review receipts are required');
	let requested = false;
	fixture.runtime.services.invalidate = () => {
		if (requested) return { workIds: [], receiptIds: [], reason: 'No further changes' };
		requested = true;
		const additional: PlanningWork = {
			...fixture.work,
			id: 'extra-investigation',
			role: PlanningVocabulary.Role.Investigate,
			status: PlanningVocabulary.WorkState.Pending,
			attemptSequence: 0,
			currentAttemptId: undefined,
			resultReceiptId: undefined,
			prerequisiteIds: [],
		};
		if (variant === 'duplicate') additional.id = fixture.work.id;
		if (variant === 'started') additional.status = PlanningVocabulary.WorkState.Running;
		if (variant === 'sequence') additional.attemptSequence = 1;
		return {
			workIds: variant === 'producer' ? [author.id] : variant === 'unknown' ? ['missing-work'] : [],
			receiptIds: variant === 'review' ? [receipt.id] : [],
			reason: 'Targeted consumer dependency changed',
			...(['new', 'duplicate', 'started', 'sequence'].includes(variant) ? { work: [additional] } : {}),
		};
	};
	const dispatches: string[] = [];
	fixture.runtime.driver = {
		...fixture.runtime.driver,
		invoke: async (invocation) => {
			dispatches.push(invocation.prompt);
			return { text: 'Provider unavailable after deterministic invalidation', exitCode: 1, rateLimited: true };
		},
	};
	return { ...fixture, accepted, receipt, author, dispatches };
};

test.each(['review', 'producer', 'new'])('invalidates the selected obligation while retaining original evidence history: %s', async (variant) => {
	const fixture = await setup({ variant });

	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);

	expect(result.status).toBe('externally-blocked');
	expect(snapshot?.record.reviewReceipts).toContainEqual(fixture.receipt);
	const id = variant === 'review' ? fixture.work.id : variant === 'producer' ? fixture.author.id : 'extra-investigation';
	expect(snapshot?.record.work.find((work) => work.id === id)?.resultReceiptId).toBeUndefined();
	expect(snapshot?.record.work.find((work) => work.id === 'initial:investigate')?.resultReceiptId).toBe(
		fixture.accepted.snapshot.record.work.find((work) => work.id === 'initial:investigate')?.resultReceiptId,
	);
	if (variant === 'review') expect(snapshot?.record.work.find((work) => work.id === fixture.author.id)).toStrictEqual(fixture.author);
	if (variant === 'new') expect(snapshot?.record.work.find((work) => work.id === id)?.status).toBe('interrupted');
});

test.each(['unknown', 'duplicate', 'started', 'sequence'])('reports invalid invalidation policy output before any provider dispatch: %s', async (variant) => {
	const fixture = await setup({ variant });
	const calls = fixture.calls.length;
	expect(fixture.dispatches).toHaveLength(0);

	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);

	expect(result).toEqual(
		expect.objectContaining({
			status: 'externally-blocked',
			cause: expect.stringMatching(/Invalidation references unknown work|Invalidation work must be a new unstarted obligation/),
		}),
	);
	expect(snapshot?.record.work.find((work) => work.id === fixture.work.id)?.resultReceiptId).toBe(
		fixture.accepted.snapshot.record.work.find((work) => work.id === fixture.work.id)?.resultReceiptId,
	);
	expect(fixture.calls).toHaveLength(calls);
	expect(fixture.dispatches).toHaveLength(0);
});

test('marks changed observed source evidence stale and reacquires it before resuming the affected producer', async () => {
	const fixture = await planningEvidenceContinuationScenario();
	fixture.makeAvailable();
	await fixture.capture();
	const initial = await runPlanning({ runtime: fixture.runtime });
	if (initial.status !== 'complete') throw new Error('Expected initial planning completion');
	const before = await readPlanningSnapshot(fixture);
	if (!before) throw new Error('Missing completed planning record');
	await writeFile(join(fixture.cwd, 'handler.ts'), 'export const retryUpload = () => "retain-original-upload";\n');
	const prompts: string[] = [];
	fixture.runtime.driver = {
		...fixture.runtime.driver,
		invoke: async (invocation) => {
			prompts.push(invocation.prompt);
			return { text: 'Provider unavailable after fresh source acquisition', exitCode: 1, rateLimited: true };
		},
	};

	const result = await runPlanning({ runtime: fixture.runtime });
	const after = await readPlanningSnapshot(fixture);

	expect(result.status).toBe('externally-blocked');
	expect(prompts).toHaveLength(1);
	expect(prompts[0]).toContain('retain-original-upload');
	expect(after?.record.work.find((work) => work.id === 'initial:investigate')?.currentAttemptId).not.toBe(
		before.record.work.find((work) => work.id === 'initial:investigate')?.currentAttemptId,
	);
	expect(after?.record.evidence.some((evidence) => evidence.assignmentId === 'initial:investigate' && !evidence.complete)).toBe(true);
	expect(after?.record.reviewReceipts).toStrictEqual(before.record.reviewReceipts);
});

test('accepts freshly reacquired observations after a source change and retains the retired evidence history', async () => {
	const fixture = await planningEvidenceContinuationScenario();
	fixture.makeAvailable();
	await fixture.capture();
	const initial = await runPlanning({ runtime: fixture.runtime });
	if (initial.status !== 'complete') throw new Error('Expected initial planning completion');
	const before = await readPlanningSnapshot(fixture);
	if (!before) throw new Error('Expected original snapshot');
	const prior = before.record.evidence.find((evidence) => evidence.assignmentId === 'initial:investigate');
	if (!prior) throw new Error('Expected acquired source evidence');
	const text = 'export const retryUpload = () => "retain-completed-with-metadata";\n';
	await writeFile(join(fixture.cwd, 'handler.ts'), text);

	const result = await runPlanning({ runtime: fixture.runtime });
	const after = await readPlanningSnapshot(fixture);
	expect(result.status).toBe('complete');
	expect(after?.record.work.find((work) => work.id === 'initial:investigate')?.currentAttemptId).not.toBe(
		before.record.work.find((work) => work.id === 'initial:investigate')?.currentAttemptId,
	);
	expect(after?.record.evidence.find((evidence) => evidence.id === prior.id)).toEqual(expect.objectContaining({ complete: true }));
	expect(after?.record.evidence.some((evidence) => !evidence.complete)).toBe(false);
	expect(fixture.calls.some((call) => call.prompt.includes('retain-completed-with-metadata'))).toBe(true);
	const historical = await readPlanningSnapshot({ ...fixture, generation: before.digest });
	expect(historical?.record.evidence).toStrictEqual(before.record.evidence);
	expect(historical?.record.work).toStrictEqual(before.record.work);
}, 60_000);

test('directly refreshes an architect-owned conclusion after its source changes without replaying the author or diagnosing missing work', async () => {
	const fixture = await planningArchitectEvidenceFixture();
	const { sourcePath } = fixture;
	const initial = await fixture.run();
	expect(initial.status).toBe(PlanningVocabulary.Status.Complete);
	const before = await fixture.current();
	const author = before.record.work.find((work) => work.role === PlanningVocabulary.Role.Architect);
	const conclusion = before.record.evidence.find((item) => item.conclusion.startsWith('Observed retention contract:'));
	if (!author || !conclusion) throw new Error('Expected the actual architectural conclusion and accepted author');
	await writeFile(sourcePath, 'export const retention = "completed uploads and metadata";');
	const result = await runPlanning({ runtime: fixture.runtime });
	const after = await fixture.current();
	expect(result.status).toBe(PlanningVocabulary.Status.Complete);
	expect(after.record.work.find((work) => work.id === author.id)).toStrictEqual(author);
	const investigations = after.record.work.filter((work) => work.id.startsWith('reinvestigate:'));
	expect(investigations).toHaveLength(1);
	expect(investigations[0].status).toBe(PlanningVocabulary.WorkState.Complete);
	expect(after.record.work.some((work) => work.role === PlanningVocabulary.Role.Diagnose)).toBe(false);
	expect(after.record.evidence.find((item) => item.id === conclusion.id)).toEqual(
		expect.objectContaining({ complete: true, assignmentId: investigations[0].id, conclusion: expect.stringContaining('completed uploads and metadata') }),
	);
	expect((await readPlanningSnapshot({ ...fixture, generation: before.digest }))?.record.evidence).toStrictEqual(before.record.evidence);
}, 60_000);
