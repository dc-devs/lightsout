// Dependencies
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { recordPlanningRelayAnswer } from '#src/queue/workers/recordPlanningRelayAnswer.ts';

const setup = async ({ text }: { text: string }) => {
	const ticketRunDir = await mkdtemp(join(tmpdir(), 'planning-relay-answer-'));
	const checkpoint: NonNullable<WorkerOutcome['planningQuestion']> = {
		name: 'lo-144-plan',
		generation: 'a'.repeat(64),
		status: PlanningVocabulary.Status.AwaitingUser,
		questionId: 'proposal:1',
		questionDigest: 'b'.repeat(64),
		checkpointRevision: 12,
		question: {
			context: 'The design has been challenged.',
			question: 'Approve?',
			recommendation: 'Approve',
			options: [{ label: 'Approve', description: 'Continue planning.' }],
		},
	};
	return { checkpoint, text, ticketRunDir, coordinatorRunId: 'queue-1' };
};

describe('recordPlanningRelayAnswer', () => {
	test('durably records exact bytes and the current checkpoint before returning an approval', async () => {
		const params = await setup({ text: 'Approve' });

		const answer = await recordPlanningRelayAnswer(params);

		const files = await readdir(join(params.ticketRunDir, 'planning-answers'));
		expect(JSON.parse(await readFile(join(params.ticketRunDir, 'planning-answers', files[0]), 'utf8'))).toEqual(answer);
		expect(answer).toMatchObject({
			selectedOption: 'Approve',
			questionDigest: params.checkpoint.questionDigest,
			checkpointRevision: 12,
			confirmation: { channel: 'relay', messageText: 'Approve' },
		});
	});

	test('preserves numeric text without converting it into implicit approval', async () => {
		const params = await setup({ text: '1' });

		const answer = await recordPlanningRelayAnswer(params);

		expect(answer.selectedOption).toBeUndefined();
		expect(answer.freeText).toBe('1');
		expect(answer.confirmation.messageText).toBe('1');
	});

	test('rejects empty answers without creating an approval record', async () => {
		const params = await setup({ text: '  ' });

		await expect(recordPlanningRelayAnswer(params)).rejects.toThrow('explicit nonempty');

		expect(await readdir(params.ticketRunDir)).toEqual([]);
	});
});
