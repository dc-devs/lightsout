import { expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningAnswer, PlanningVocabulary } from '#src/contracts/index.ts';
import { answerPlanningQuestion, capturePlanningInput, commitPlanningSnapshot, readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';
import { planningQuestionAnswer, planningQuestionScenario } from '#tests/helpers/planningWorkflowQuestionScenario.ts';
import { planningWorkflowFinding } from '#tests/helpers/planningWorkflowScenarios.ts';

const setup = async ({ variant = 'current' }: { variant?: string } = {}) => {
	const fixture = await planningQuestionScenario();
	await fixture.capture();
	const result = await runPlanning({ runtime: fixture.runtime });
	if (result.status !== PlanningVocabulary.Status.AwaitingUser) throw new Error('Expected actual user checkpoint');
	const answer = planningQuestionAnswer({ result, delegation: fixture.scope });
	if (variant === 'question') answer.questionId = 'different-question';
	if (variant === 'revision') answer.checkpointRevision++;
	if (variant === 'digest') answer.questionDigest = 'a'.repeat(64);
	if (variant === 'message') answer.confirmation.messageText = 'Delete uploads';
	if (variant === 'hash') answer.confirmation.approvedDigest = 'a'.repeat(64);
	if (variant === 'old-id') answer.confirmation.id = fixture.record.confirmations[0].id;
	if (variant === 'old-message') answer.confirmation.messageId = fixture.record.confirmations[0].messageId;
	if (variant === 'unknown-option' || variant === 'selected') {
		delete answer.freeText;
		answer.selectedOption = variant === 'selected' ? 'Retain uploads' : 'Invented option';
		answer.confirmation.messageText = answer.selectedOption;
		answer.confirmation.approvedDigest = sha256({ content: answer.selectedOption });
	}
	const before = await readPlanningSnapshot(fixture);
	return { ...fixture, result, answer, before };
};

test.each(['question', 'revision', 'digest', 'message', 'hash', 'old-id', 'old-message', 'unknown-option'])(
	'rejects a stale or unauthenticated foreground answer: %s',
	async (variant) => {
		const fixture = await setup({ variant });

		await expect(answerPlanningQuestion({ runtime: fixture.runtime, answer: fixture.answer })).rejects.toThrow(
			/checkpoint|confirmation|approval|digest|message/i,
		);

		expect((await readPlanningSnapshot(fixture))?.digest).toBe(fixture.before?.digest);
	},
);

test('accepts a listed option using its exact approved bytes and retains the original question', async () => {
	const fixture = await setup({ variant: 'selected' });

	const result = await answerPlanningQuestion({ runtime: fixture.runtime, answer: fixture.answer });
	const snapshot = await readPlanningSnapshot(fixture);

	expect(result.status).toBe('complete');
	expect(snapshot?.record.claims.find((claim) => claim.id === fixture.result.questionId)).toEqual(
		expect.objectContaining({ state: 'superseded', question: expect.objectContaining({ answerId: expect.any(String) }) }),
	);
	expect(snapshot?.record.claims.find((claim) => claim.confirmationId === fixture.answer.confirmation.id)).toEqual(
		expect.objectContaining({ text: 'Retain uploads', owner: 'user', state: 'settled', origin: expect.objectContaining({ text: 'Retain uploads' }) }),
	);
});

const setupFallback = async ({ finding = false, recommendation = true }: { finding?: boolean; recommendation?: boolean } = {}) => {
	const fixture = await planningWorkflowFixture({
		respond: async () => ({ text: 'Provider quota unavailable after recording the answer', exitCode: 1, rateLimited: true }),
	});
	const first = await fixture.capture();
	if (finding) {
		const record = structuredClone(first.record);
		const conflict = planningWorkflowFinding({ id: 'user-conflict', scope: fixture.scope });
		conflict.owner = PlanningVocabulary.Owner.User;
		if (recommendation) conflict.proposedResolution = 'Retain uploaded data until explicit removal.';
		record.findings.push(conflict);
		record.revision++;
		record.parentDigest = first.digest;
		const committed = await commitPlanningSnapshot({
			...fixture,
			record,
			artifacts: first.artifacts,
			expectedRevision: first.record.revision,
			parentDigest: first.digest,
		});
		if (!committed.committed) throw new Error('Conflict fixture lost');
	} else {
		const { confirmationId: _approval, ...original } = fixture.record.claims[0];
		await capturePlanningInput({
			runtime: fixture.runtime,
			input: {
				stage: fixture.runtime.stage,
				sources: [],
				confirmations: [],
				claims: [{ ...original, id: 'unresolved-requirement', state: PlanningVocabulary.ClaimState.Unresolved }],
			},
		});
	}
	const pending = await runPlanning({ runtime: fixture.runtime });
	if (pending.status !== PlanningVocabulary.Status.AwaitingUser) throw new Error('Expected a current user obligation');
	const answer = planningQuestionAnswer({ result: pending, delegation: fixture.scope });
	return { ...fixture, pending, answer };
};

test.each([false, true])('persists a full-context checkpoint for a user obligation without a question record: finding=%s', async (finding) => {
	const fixture = await setupFallback({ finding });

	const again = await runPlanning({ runtime: fixture.runtime });

	expect(again).toStrictEqual(fixture.pending);
	expect(fixture.pending.question.context).toContain(finding ? 'Retry after user-conflict loses the completed upload' : 'Preserve completed uploads');
	expect(fixture.pending.question.recommendation).toBe(finding ? 'Retain uploaded data until explicit removal.' : 'Preserve completed uploads');
	expect(fixture.calls).toHaveLength(0);
});

test('records a foreground finding answer without treating it as verified repair', async () => {
	const fixture = await setupFallback({ finding: true });

	const result = await answerPlanningQuestion({ runtime: fixture.runtime, answer: fixture.answer });
	const snapshot = await readPlanningSnapshot(fixture);

	expect(result.status).toBe('externally-blocked');
	expect(snapshot?.record.findings.find((finding) => finding.id === 'user-conflict')).toEqual(
		expect.objectContaining({ owner: 'planner', state: 'open', proposedResolution: 'Retain completed uploads on every retry.', verificationReceiptIds: [] }),
	);
	expect(snapshot?.record.confirmations).toContainEqual(fixture.answer.confirmation);
	expect(snapshot?.record.claims.find((claim) => claim.confirmationId === fixture.answer.confirmation.id)).toEqual(
		expect.objectContaining({ text: 'Retain completed uploads on every retry.', owner: 'user' }),
	);
});

test('rejects an answer when no canonical planning question has ever existed', async () => {
	const fixture = await planningWorkflowFixture();
	const text = 'Retain uploads';
	const answer: PlanningAnswer = {
		questionId: 'absent',
		checkpointRevision: 0,
		questionDigest: 'a'.repeat(64),
		freeText: text,
		confirmation: {
			id: 'approval',
			channel: PlanningVocabulary.ConfirmationChannel.Foreground,
			messageId: 'message',
			messageText: text,
			approvedDigest: sha256({ content: text }),
			delegation: fixture.scope,
		},
	};

	await expect(answerPlanningQuestion({ runtime: fixture.runtime, answer })).rejects.toThrow('No planning question exists');

	expect(fixture.calls).toHaveLength(0);
});

test('answers a fallback requirement with a confirmed successor without inventing question metadata', async () => {
	const fixture = await setupFallback();
	const result = await answerPlanningQuestion({ runtime: fixture.runtime, answer: fixture.answer });
	const snapshot = await readPlanningSnapshot(fixture);
	expect(result.status).toBe('externally-blocked');
	const original = snapshot?.record.claims.find((claim) => claim.id === 'unresolved-requirement');
	expect(original).toEqual(expect.objectContaining({ kind: 'requirement', state: 'superseded' }));
	expect(original).not.toHaveProperty('question');
	expect(snapshot?.record.claims.find((claim) => claim.supersedes === original?.id)).toEqual(
		expect.objectContaining({
			text: fixture.answer.freeText,
			owner: 'user',
			confirmationId: fixture.answer.confirmation.id,
		}),
	);
});

test('rejects an answer when an unrelated commit wins while its approval is being published', async () => {
	const fixture = await setup();
	let raced = false;
	fixture.runtime.storeIO = {
		checkpoint: async ({ operation }) => {
			if (operation !== 'candidate' || raced) return;
			raced = true;
			const current = await readPlanningSnapshot(fixture);
			if (!current) throw new Error('Expected current snapshot');
			const record = structuredClone(current.record);
			record.revision++;
			record.parentDigest = current.digest;
			const work = record.work.find((work) => work.status === 'pending');
			if (!work) throw new Error('Expected deferred work');
			work.assignment += ' Preserve the concurrently recorded technical constraint.';
			const winner = await commitPlanningSnapshot({
				...fixture,
				record,
				artifacts: current.artifacts,
				expectedRevision: current.record.revision,
				parentDigest: current.digest,
			});
			if (!winner.committed) throw new Error('Expected concurrent winner');
		},
	};
	await expect(answerPlanningQuestion({ runtime: fixture.runtime, answer: fixture.answer })).rejects.toThrow(
		'Planning changed before this answer could be accepted',
	);
	const after = await readPlanningSnapshot(fixture);
	expect(raced).toBe(true);
	expect(after?.record.confirmations).toStrictEqual(fixture.before?.record.confirmations);
	expect(after?.record.claims).toStrictEqual(fixture.before?.record.claims);
	expect(after?.record.work.some((work) => work.assignment.includes('concurrently recorded technical constraint'))).toBe(true);
});

test('reuses captured answer bytes while recording a distinct foreground approval', async () => {
	const fixture = await setupFallback({ finding: true });
	const text = fixture.answer.freeText;
	if (!text) throw new Error('Expected explicit answer text');
	await capturePlanningInput({
		runtime: fixture.runtime,
		input: {
			stage: fixture.runtime.stage,
			claims: [],
			confirmations: [],
			sources: [{ artifact: 'prior-context.txt', locator: 'Context only', text, sha256: sha256({ content: text }) }],
		},
	});
	const pending = await runPlanning({ runtime: fixture.runtime });
	if (pending.status !== 'awaiting-user') throw new Error('Expected refreshed source-bound checkpoint');
	const answer = planningQuestionAnswer({ result: pending, delegation: fixture.scope });
	const result = await answerPlanningQuestion({ runtime: fixture.runtime, answer });
	const after = await readPlanningSnapshot(fixture);
	expect(result.status).toBe('externally-blocked');
	expect(after?.record.artifacts.filter((artifact) => artifact.path === `planning-originals/${sha256({ content: text })}.txt`)).toHaveLength(1);
	expect(after?.record.confirmations).toContainEqual(answer.confirmation);
	expect(after?.record.sources.filter((source) => source.text === text)).toHaveLength(2);
	expect(after?.record.findings.find((finding) => finding.id === 'user-conflict')?.state).toBe('open');
});

test('presents the full unresolved finding without inventing a technical recommendation', async () => {
	const fixture = await setupFallback({ finding: true, recommendation: false });
	expect(fixture.pending.question.recommendation).toBe('Resolve the conflicting user-owned behavior before continuing.');
	expect(fixture.pending.question.context).toContain('Retry after user-conflict loses the completed upload');
	expect(fixture.pending.question.context).toContain('The user must upload completed content again');
	expect(fixture.pending.question.context).toContain('Preserve retry identity for user-conflict');
	expect(fixture.calls).toHaveLength(0);
});

test('redirects an active technical dependency to the confirmed answer while retaining unrelated dependencies', async () => {
	const fixture = await setup();
	const current = await readPlanningSnapshot(fixture);
	if (!current) throw new Error('Expected pending checkpoint');
	const record = structuredClone(current.record);
	const original = record.claims[0];
	const { confirmationId: _approval, ...base } = original;
	record.claims.push({ ...base, id: 'technical-consumer', owner: PlanningVocabulary.Owner.Planner, dependencies: [fixture.result.questionId, 'required'] });
	record.revision++;
	record.parentDigest = current.digest;
	const committed = await commitPlanningSnapshot({
		...fixture,
		record,
		artifacts: current.artifacts,
		expectedRevision: current.record.revision,
		parentDigest: current.digest,
	});
	if (!committed.committed) throw new Error('Expected technical dependency publication');
	fixture.runtime.driver = {
		...fixture.runtime.driver,
		invoke: async () => ({ text: 'Capacity unavailable after explicit answer', exitCode: 1, rateLimited: true }),
	};
	const result = await answerPlanningQuestion({ runtime: fixture.runtime, answer: fixture.answer });
	const after = await readPlanningSnapshot(fixture);
	const answer = after?.record.claims.find((claim) => claim.confirmationId === fixture.answer.confirmation.id);
	expect(result.status).toBe('externally-blocked');
	expect(answer?.supersedes).toBe(fixture.result.questionId);
	expect(after?.record.claims.find((claim) => claim.id === 'technical-consumer')?.dependencies).toStrictEqual([answer?.id, 'required']);
	expect(after?.record.claims.find((claim) => claim.id === 'required')).toStrictEqual(original);
});
