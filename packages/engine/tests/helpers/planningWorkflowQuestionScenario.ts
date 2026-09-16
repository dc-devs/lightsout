import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningAnswer, type PlanningRunResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

export const planningQuestionScenario = async () => {
	const fixture = await planningWorkflowFixture({
		respond: async ({ response, snapshot }) => {
			if (response.role !== PlanningVocabulary.Role.Architect || !('claims' in response)) return response;
			const source = snapshot.record.sources[0];
			const claim = snapshot.record.claims[0];
			if (!source || !claim) throw new Error('Question scenario requires captured intent');
			return {
				...response,
				claims: [
					...response.claims,
					{
						id: 'retention-question',
						kind: PlanningVocabulary.ClaimKind.Question,
						text: 'May a retry delete a completed upload?',
						explanation: 'The ticket suggests deletion, contradicting the confirmed preservation requirement.',
						contentRevision: 1,
						origin: source,
						owner: PlanningVocabulary.Owner.User,
						state: PlanningVocabulary.ClaimState.Unresolved,
						dependencies: ['required'],
						scope: claim.scope,
						question: {
							context: 'Completed uploads are currently preserved. The ticket suggests deleting them on retry, which would lose user work.',
							question: 'Should completed uploads be retained on retry?',
							options: [
								{ label: 'Retain uploads', description: 'Keep the approved preservation behavior.' },
								{ label: 'Delete uploads', description: 'Replace the approved behavior and require re-uploading.' },
							],
							recommendation: 'Retain uploads',
						},
					},
				],
			};
		},
	});
	return fixture;
};

export const planningQuestionAnswer = ({
	result,
	delegation,
	alignment = false,
}: {
	result: Extract<PlanningRunResult, { status: 'awaiting-user' }>;
	delegation: PlanningAnswer['confirmation']['delegation'];
	alignment?: boolean;
}): PlanningAnswer => {
	const messageText = alignment ? result.question.options[0]?.label : 'Retain completed uploads on every retry.';
	if (!messageText) throw new Error('An alignment checkpoint must offer an explicit approval option');
	return {
		questionId: result.questionId,
		checkpointRevision: result.checkpointRevision,
		questionDigest: result.questionDigest,
		...(alignment ? { selectedOption: messageText } : { freeText: messageText }),
		confirmation: {
			id: alignment ? 'foreground-design-approval' : 'foreground-retention-approval',
			channel: PlanningVocabulary.ConfirmationChannel.Foreground,
			messageId: alignment ? 'user-message-design' : 'user-message-retention',
			messageText,
			approvedDigest: sha256({ content: messageText }),
			delegation,
		},
	};
};
