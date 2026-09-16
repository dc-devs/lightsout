import { describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningAnswer, type PlanningRunResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { answerPlanningQuestion, createPlanningRuntime } from '#src/plan/workflow/index.ts';
import { hasPlanningProposalApproval } from '#src/plan/workflow/proposal/hasPlanningProposalApproval.ts';
import { commitPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

const setup = async ({ before, insufficient = false }: { before: boolean; insufficient?: boolean }) => {
	let challenges = 0;
	const fixture = await planningReviewFixture({
		respond: ({ response }) => {
			if (response.role === PlanningVocabulary.Role.DesignReview && 'coverage' in response) {
				challenges += 1;
				if (insufficient && challenges === 1)
					return {
						...response,
						coverage: { ...response.coverage, outcome: PlanningVocabulary.Review.Insufficient, adequacy: 'The failure branch still needs investigation.' },
					};
			}
			return response;
		},
	});
	const runtime = await createPlanningRuntime({
		...fixture,
		driver: fixture.runtime.driver,
		config: { ...fixture.runtime.config, 'auto-plan': { 'propose-before-draft': before } },
		mode: fixture.runtime.mode,
		stage: fixture.runtime.stage,
	});
	Object.assign(fixture.runtime, runtime);
	const pending = await fixture.run();
	if (pending.status !== PlanningVocabulary.Status.AwaitingUser) throw new Error('Expected configured proposal approval');
	return { ...fixture, pending, challenges };
};

const answerFor = ({
	pending,
	confirmation,
	selectedOption = 'Approve proposal',
}: {
	pending: Extract<PlanningRunResult, { status: 'awaiting-user' }>;
	confirmation: PlanningAnswer['confirmation'];
	selectedOption?: string;
}): PlanningAnswer => ({
	questionId: pending.questionId,
	questionDigest: pending.questionDigest,
	checkpointRevision: pending.checkpointRevision,
	selectedOption,
	confirmation: {
		...confirmation,
		id: 'proposal-approval',
		messageId: 'new-foreground-message',
		messageText: selectedOption,
		approvedDigest: sha256({ content: selectedOption }),
	},
});

describe('pendingPlanningProposal', () => {
	test.each([true, false])('honors proposal timing and accepts once without creating semantic decisions (beforeDraft=%s)', async (before) => {
		const fixture = await setup({ before });
		const original = await fixture.current();
		expect(hasPlanningProposalApproval({ snapshot: original, config: fixture.runtime.config })).toBe(false);
		const drafted = original.record.work.some((work) => work.role === PlanningVocabulary.Role.Draft && work.status === PlanningVocabulary.WorkState.Complete);
		expect(drafted).toBe(!before);
		const answer = answerFor({ pending: fixture.pending, confirmation: fixture.input.confirmations[0] });

		const result = await answerPlanningQuestion({ runtime: fixture.runtime, answer });

		expect(result.status).toBe('complete');
		const completed = await fixture.current();
		expect(hasPlanningProposalApproval({ snapshot: completed, config: fixture.runtime.config })).toBe(true);
		expect(completed.record.sources).toEqual(original.record.sources);
		expect(completed.record.claims).toEqual(original.record.claims);
		expect(completed.record.confirmations).toEqual(original.record.confirmations);
		expect([...completed.artifacts.keys()].filter((path) => path.startsWith('planning-proposal-approvals/'))).toHaveLength(1);
	});

	test('requires actual revision text instead of treating the revision option as approval', async () => {
		const fixture = await setup({ before: true });
		const answer = answerFor({ pending: fixture.pending, confirmation: fixture.input.confirmations[0], selectedOption: 'Revise proposal' });

		const revise = answerPlanningQuestion({ runtime: fixture.runtime, answer });

		await expect(revise).rejects.toThrow('proposal revision requires its actual requested change');
		expect([...(await fixture.current()).artifacts.keys()].some((path) => path.startsWith('planning-proposal-approvals/'))).toBe(false);
	});

	test('rejects an answer for a different proposal checkpoint', async () => {
		const fixture = await setup({ before: false });
		const answer = answerFor({ pending: fixture.pending, confirmation: fixture.input.confirmations[0] });

		const stale = answerPlanningQuestion({ runtime: fixture.runtime, answer: { ...answer, questionDigest: '0'.repeat(64) } });

		await expect(stale).rejects.toThrow('does not match the current checkpoint');
	});
});

test('changing proposal timing after drafting does not silently bypass approval', async () => {
	const fixture = await setup({ before: false });
	fixture.runtime.config['auto-plan'] = { 'propose-before-draft': true };

	const resumed = await fixture.run();

	expect(resumed.status).toBe('awaiting-user');
	if (resumed.status !== 'awaiting-user') throw new Error('Expected a proposal checkpoint');
	expect(resumed.questionId).toBe('proposal:after-ready');
});

test('finishes inadequate design coverage before requesting the before-draft proposal', async () => {
	const fixture = await setup({ before: true, insufficient: true });

	expect(fixture.pending.questionId).toBe('proposal:before-draft');
	expect(fixture.challenges).toBeGreaterThanOrEqual(2);
	const snapshot = await fixture.current();
	expect(snapshot.record.work.some((work) => work.role === 'draft' && work.status === 'complete')).toBe(false);
});

test.each(['missing-checkpoint', 'wrong-revision', 'revision-option', 'wrong-hash', 'reused-message'])(
	'rejects invalid proposal receipt binding: %s',
	async (defect) => {
		const fixture = await setup({ before: true });
		const before = await fixture.current();
		const record = structuredClone(before.record);
		const artifacts = new Map(before.artifacts);
		const answer = answerFor({ pending: fixture.pending, confirmation: fixture.input.confirmations[0] });
		const approval = {
			format: 'planning-proposal-approval-v1',
			questionId: answer.questionId,
			questionDigest: answer.questionDigest,
			checkpointRevision: answer.checkpointRevision,
			acceptedRevision: before.record.revision + 1,
			confirmation: answer.confirmation,
		};
		if (defect === 'missing-checkpoint') {
			const path = `planning-questions/${sha256({ content: `${answer.questionId}:${answer.questionDigest}` })}.json`;
			record.artifacts = record.artifacts.filter((item) => item.path !== path);
			artifacts.delete(path);
		}
		if (defect === 'wrong-revision') approval.checkpointRevision += 1;
		if (defect === 'revision-option') {
			approval.confirmation.messageText = 'Revise proposal';
			approval.confirmation.approvedDigest = sha256({ content: 'Revise proposal' });
		}
		if (defect === 'wrong-hash') approval.confirmation.approvedDigest = '0'.repeat(64);
		if (defect === 'reused-message') approval.confirmation.messageId = fixture.input.confirmations[0].messageId;
		attachPlanningData({ record, artifacts, path: `planning-proposal-approvals/${answer.questionDigest}.json`, value: approval });

		const commit = commitPlanningSnapshot({
			cwd: fixture.cwd,
			name: fixture.name,
			expectedRevision: before.record.revision,
			parentDigest: before.digest,
			record: { ...record, revision: before.record.revision + 1, parentDigest: before.digest },
			artifacts,
		});

		await expect(commit).rejects.toThrow(/checkpoint|confirmation|reuse foreground/);
		expect((await fixture.current()).digest).toBe(before.digest);
	},
);
